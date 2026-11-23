"""Pagamentos (Fase 5): checkout Pix na AbacatePay v2, webhook, conciliação, split e subcontas.

Fluxo de uma aula paga:
1. Transação do aluno: valida horário/oferta e chama private.payment_create_hold (aula
   awaiting_payment + cobrança interna com valor/comissão congelados). Conflito → 409 (EXCLUDE).
2. FORA da transação: cria o Pix no gateway com externalId = id da cobrança interna. Se a rede
   falhar ou demorar, o resultado é desconhecido: nada é desfeito, e a próxima consulta repete a
   criação com o MESMO externalId (o gateway devolve a cobrança pendente existente — sem duplicar).
3. Confirmação SÓ pelo servidor: webhook autenticado (segredo + HMAC) ou conciliação (consulta ao
   gateway). Nunca pelo navegador. private.payment_confirm é idempotente e trava a cobrança.
4. Depois de confirmado: evento no Google Agenda com Meet (falha do Google não desfaz o pagamento).
"""

import hashlib
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

import psycopg
from fastapi import Depends, Request

from app.abacatepay import (
    AbacatePayClient,
    GatewayAuthError,
    GatewayRejectedError,
    GatewayUnavailableError,
    InvalidGatewayResponseError,
    SplitNotEnabledError,
    verify_webhook,
    webhook_paid_amount,
)
from app.auth.dependencies import get_database
from app.auth.jwt import AuthenticatedUser
from app.config import Settings
from app.db import BaseDatabase, as_connection_role
from app.errors import ApiError, forbidden, not_found, service_unavailable, unauthorized
from app.payments_rules import COMMISSION_BPS, split_amount
from app.repositories.payments import PaymentsRepository
from app.repositories.profiles import ProfileRepository
from app.repositories.scheduling import SchedulingRepository
from app.scheduling import booking_problem
from app.schemas.payments import (
    CheckoutIn,
    CommissionProgressOut,
    FinancePeriod,
    PaymentLesson,
    PaymentOut,
    PaymentsStatus,
    PayoutAccountIn,
    PayoutAccountOut,
    PayoutBalanceOut,
    RefundOut,
    TeacherFinanceOut,
    TeacherFinanceSummary,
    WithdrawalIn,
    WithdrawalOut,
)
from app.services.profiles import account_suspended, load_profile

logger = logging.getLogger("edusearch.api.payments")

RECONCILE_MIN_SECONDS = 5  # consulta ao gateway no máximo a cada 5 s por cobrança
_DB_ERRORS = {
    "teacher_not_found": (404, "Professor não encontrado."),
    "price_not_set": (409, "Este professor ainda não definiu o valor da aula."),
    "idempotency_conflict": (409, "Esta reserva já foi usada para outro horário."),
    "withdrawal_idempotency_conflict": (409, "Esta chave já foi usada para outro valor de saque."),
    "role_required": (403, "Disponível apenas para contas de aluno."),
    "intent_not_found": (404, "Pagamento não encontrado."),
}


def payments_disabled() -> ApiError:
    return forbidden("payments_disabled", "Pagamentos ainda não estão disponíveis nesta fase.")


def _db_error(exc: psycopg.Error) -> ApiError:
    msg = (getattr(exc.diag, "message_primary", None) or "").strip()
    status, text = _DB_ERRORS.get(msg, (422, "Não foi possível concluir a reserva."))
    return ApiError(status, msg if msg in _DB_ERRORS else "payment_rejected", text)


@dataclass
class WebhookResult:
    outcome: str


class PaymentsService:
    def __init__(
        self,
        database: BaseDatabase,
        settings: Settings,
        *,
        gateway: AbacatePayClient | None,
        on_paid: Callable[[AuthenticatedUser, UUID], None] | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._db = database
        self._settings = settings
        self._gateway = gateway
        self._on_paid = on_paid
        self._now = clock

    # ------------------------------------------------------------------ guardas

    @property
    def _env(self) -> str:
        return "production" if self._settings.payments_stage == "production" else "sandbox"

    def _ready(self) -> AbacatePayClient:
        if self._settings.payments_stage == "off":
            raise payments_disabled()
        if self._gateway is None or not self._settings.payments_configured:
            raise service_unavailable(
                "payments_not_configured", "Pagamentos não configurados no servidor."
            )
        return self._gateway

    def status(self) -> PaymentsStatus:
        return PaymentsStatus(
            stage=self._settings.payments_stage,  # type: ignore[arg-type]
            configured=self._gateway is not None and self._settings.payments_configured,
            commission_bps=COMMISSION_BPS,
            split_enabled=self._settings.abacatepay_split_enabled,
            hold_minutes=self._settings.payments_hold_seconds // 60,
        )

    # ------------------------------------------------------------------ saída

    def _out(self, row: dict[str, Any], user: AuthenticatedUser) -> PaymentOut:
        student = row["student_id"] == user.id
        pending = row["status"] == "pending"
        refund = (
            RefundOut(
                status=row["refund_status"],
                reason=row["refund_reason"],
                created_at=row["refund_created_at"],
            )
            if row.get("refund_status")
            else None
        )
        return PaymentOut(
            id=row["id"],
            role="student" if student else "teacher",
            status=row["status"],
            environment=row["environment"],
            amount_cents=row["amount_cents"],
            commission_policy_version=row["commission_policy_version"],
            commission_bps=row["commission_bps"],
            commission_cents=row["commission_cents"],
            teacher_share_cents=row["teacher_share_cents"],
            currency=row["currency"],
            br_code=row["br_code"] if (student and pending) else None,
            br_code_image=row["br_code_image"] if (student and pending) else None,
            expires_at=row["expires_at"],
            paid_at=row["paid_at"],
            split_status=row["split_status"],
            charge_pending=pending and row["gateway_charge_id"] is None,
            lesson=PaymentLesson(
                id=row["lesson_id"],
                subject=row["subject"],
                starts_at=row["starts_at"],
                ends_at=row["ends_at"],
                status=row["lesson_status"],
                teacher_name=row["teacher_name"],
                student_name=row["student_name"],
                meet_url=row["meet_url"] if row["lesson_status"] == "scheduled" else None,
                calendar_sync_status=row["calendar_sync_status"],
            ),
            refund=refund,
            created_at=row["created_at"],
        )

    def _load(self, user: AuthenticatedUser, intent_id: UUID) -> dict[str, Any]:
        with self._db.user_transaction(user) as conn:
            row = PaymentsRepository(conn).get(intent_id)
        if row is None:
            raise not_found("payment_not_found", "Pagamento não encontrado.")
        return row

    # ------------------------------------------------------------------ checkout

    def checkout(self, user: AuthenticatedUser, data: CheckoutIn) -> tuple[PaymentOut, bool]:
        self._ready()
        start = data.starts_at.astimezone(UTC)
        end = start + timedelta(minutes=data.duration_minutes)
        with self._db.user_transaction(user) as conn:
            profile = load_profile(conn, user)
            if profile.status == "suspended":
                raise account_suspended()
            if "student" not in ProfileRepository(conn).list_roles(user.id):
                raise forbidden("role_required", "Disponível apenas para contas de aluno.")
            sched = SchedulingRepository(conn)
            pay = PaymentsRepository(conn)
            offer = sched.teacher_offer(data.teacher_id)
            if offer is None or data.teacher_id == user.id:
                raise not_found("teacher_not_found", "Professor não encontrado.")
            if data.subject not in offer["subjects"]:
                raise ApiError(
                    422, "subject_not_offered", "Disciplina não oferecida por este professor."
                )
            if data.duration_minutes not in offer["durations"]:
                raise ApiError(
                    422, "duration_not_offered", "Duração não oferecida por este professor."
                )
            subject_id = sched.subject_id(data.subject)
            if subject_id is None:
                raise ApiError(422, "unknown_subject", f"Disciplina inválida: {data.subject}.")
            existing = sched.lesson_by_key(user.id, data.idempotency_key)
            if existing is None:
                with as_connection_role(conn):
                    pay.expire_holds()  # libera horários com Pix vencido antes de validar
                    busy = sched.teacher_busy(
                        data.teacher_id, start - timedelta(days=1), start + timedelta(days=1)
                    )
                busy += sched.own_busy(
                    user.id, start - timedelta(days=1), start + timedelta(days=1)
                )
                problem = booking_problem(
                    start,
                    data.duration_minutes,
                    sched.list_windows(data.teacher_id),
                    busy,
                    now=self._now(),
                )
                if problem == "horário indisponível":
                    raise ApiError(409, "slot_unavailable", "Este horário já está ocupado.")
                if problem:
                    raise ApiError(422, "slot_invalid", f"Horário inválido: {problem}.")
            try:
                with conn.transaction(), as_connection_role(conn):
                    intent = pay.create_hold(
                        teacher_id=data.teacher_id,
                        subject_id=subject_id,
                        starts_at=start,
                        ends_at=end,
                        key=data.idempotency_key,
                        environment=self._env,
                        hold_seconds=self._settings.payments_hold_seconds,
                    )
            except psycopg.errors.ExclusionViolation as exc:
                raise ApiError(
                    409, "slot_unavailable", "Este horário acabou de ser reservado."
                ) from exc
            except psycopg.errors.CheckViolation as exc:
                raise ApiError(422, "slot_invalid", "Horário indisponível para reserva.") from exc
            except (psycopg.errors.RaiseException, psycopg.errors.InsufficientPrivilege) as exc:
                raise _db_error(exc) from exc
        created = intent["gateway_charge_id"] is None and intent["status"] == "pending"
        if created:
            self._ensure_charge(user, intent)
        return self._out(self._load(user, intent["id"]), user), created

    def _ensure_charge(self, user: AuthenticatedUser, intent: dict[str, Any]) -> None:
        """Cria (ou recupera, pelo externalId) a cobrança Pix no gateway. Idempotente."""
        gateway = self._ready()
        remaining = int((intent["expires_at"] - self._now()).total_seconds())
        if remaining < 60:
            return  # a reserva vai expirar; não cria cobrança que não poderá ser honrada
        splits = None
        split_status = "not_applicable"
        sacc = None
        production = self._env == "production"
        if production and not self._settings.abacatepay_split_enabled:
            # Nunca cria um Pix real sem divisão automática explicitamente habilitada.
            raise service_unavailable(
                "split_required",
                "O recebimento do professor ainda não está pronto para pagamentos.",
            )
        if self._settings.abacatepay_split_enabled:
            with self._db.user_transaction(user) as conn, as_connection_role(conn):
                sacc = PaymentsRepository(conn).payout_account_of(
                    intent["teacher_id"], intent["environment"]
                )
            if sacc:
                splits = [{"subAccountId": sacc, "amount": intent["teacher_share_cents"]}]
                if production:
                    try:
                        sub = gateway.get_sub_account(sacc)
                        if (
                            sub.id != sacc
                            or sub.external_id != str(intent["teacher_id"])
                            or (sub.dev_mode is not None and sub.dev_mode != gateway.dev_mode)
                        ):
                            raise InvalidGatewayResponseError("subconta não pertence ao professor")
                    except (
                        GatewayUnavailableError,
                        GatewayAuthError,
                        GatewayRejectedError,
                        InvalidGatewayResponseError,
                    ) as exc:
                        # Não existe cobrança externa neste ponto: não há fallback sem split.
                        with self._db.user_transaction(user) as conn, as_connection_role(conn):
                            PaymentsRepository(conn).set_split(
                                intent["id"], sacc, intent["teacher_share_cents"], "failed"
                            )
                        raise service_unavailable(
                            "payout_account_not_ready",
                            "O recebimento do professor não pôde ser validado agora.",
                        ) from exc
            else:
                if production:
                    raise service_unavailable(
                        "payout_account_required",
                        "O professor ainda não está habilitado para receber este pagamento.",
                    )
                split_status = "unavailable"  # professor sem subconta: sem repasse automático
        try:
            charge = gateway.create_pix(
                amount=intent["amount_cents"],
                description="Aula EduSearch",
                expires_in=remaining,
                external_id=str(intent["id"]),
                metadata={"intent_id": str(intent["id"]), "lesson_id": str(intent["lesson_id"])},
                splits=splits,
            )
            if splits:
                split_status = "pending"
        except SplitNotEnabledError as exc:
            if production:
                # 400 conhecido: a cobrança com split foi recusada. Não tenta outra sem ``splits``.
                with self._db.user_transaction(user) as conn, as_connection_role(conn):
                    PaymentsRepository(conn).set_split(
                        intent["id"], sacc, intent["teacher_share_cents"], "failed"
                    )
                raise service_unavailable(
                    "split_required", "O split obrigatório não foi aceito pelo gateway."
                ) from exc
            # Sandbox mantém o fallback de demonstração, sem fingir repasse.
            logger.warning(
                "split indisponível na AbacatePay; cobrança sem split (intent=%s)", intent["id"]
            )
            charge = gateway.create_pix(
                amount=intent["amount_cents"],
                description="Aula EduSearch",
                expires_in=remaining,
                external_id=str(intent["id"]),
                metadata={"intent_id": str(intent["id"])},
            )
            split_status, sacc = "unavailable", None
        except (GatewayUnavailableError, InvalidGatewayResponseError):
            # Resultado desconhecido: a próxima consulta repete com o mesmo externalId.
            return
        except (GatewayRejectedError, GatewayAuthError) as exc:
            logger.error(
                "AbacatePay recusou a cobrança (intent=%s): %s",
                intent["id"],
                exc.__class__.__name__,
            )
            with self._db.user_transaction(user) as conn, as_connection_role(conn):
                PaymentsRepository(conn).mark_failed(intent["id"], "gateway recusou a criação")
            raise service_unavailable(
                "payment_gateway_error", "Não foi possível gerar o Pix agora. Tente de novo."
            ) from exc
        if charge.amount != intent["amount_cents"] or charge.dev_mode != (self._env == "sandbox"):
            # Nunca deveria acontecer: valor ou ambiente divergentes. Não exibe o Pix.
            logger.error("cobrança divergente do esperado (intent=%s)", intent["id"])
            raise service_unavailable(
                "payment_gateway_error", "Resposta inconsistente do gateway de pagamento."
            )
        with self._db.user_transaction(user) as conn, as_connection_role(conn):
            repo = PaymentsRepository(conn)
            repo.attach_charge(
                intent["id"],
                charge_id=charge.id,
                br_code=charge.br_code,
                image=charge.br_code_image,
                fee=charge.platform_fee,
                expires_at=charge.expires_at,
            )
            if self._settings.abacatepay_split_enabled:
                repo.set_split(intent["id"], sacc, intent["teacher_share_cents"], split_status)
        if charge.status == "PAID":
            self._confirm(charge.id, charge.amount, "create", user)

    # ------------------------------------------------------------------ consulta e conciliação

    def get(self, user: AuthenticatedUser, intent_id: UUID) -> PaymentOut:
        if self._settings.payments_stage == "off":
            raise payments_disabled()
        row = self._load(user, intent_id)
        if row["status"] == "pending" and self._gateway is not None:
            if row["gateway_charge_id"] is None:
                if row["student_id"] == user.id:
                    self._ensure_charge(user, row)
            else:
                last = row["last_checked_at"]
                if last is None or (self._now() - last).total_seconds() >= RECONCILE_MIN_SECONDS:
                    self._reconcile(user, row)
            row = self._load(user, intent_id)
        return self._out(row, user)

    def _reconcile(self, user: AuthenticatedUser, row: dict[str, Any]) -> None:
        """Consulta o gateway (o navegador nunca decide). PAID → confirma; vencida → fecha."""
        assert self._gateway is not None  # noqa: S101
        with self._db.user_transaction(user) as conn, as_connection_role(conn):
            PaymentsRepository(conn).touch_checked(row["id"])
        try:
            status, _ = self._gateway.check_pix(row["gateway_charge_id"])
        except (
            GatewayUnavailableError,
            InvalidGatewayResponseError,
            GatewayRejectedError,
            GatewayAuthError,
        ):
            return
        if status == "PAID":
            # check não devolve o valor pago: a cobrança foi criada por nós com o valor congelado.
            self._confirm(row["gateway_charge_id"], row["amount_cents"], "reconcile", user)
        elif status in ("EXPIRED", "CANCELLED"):
            with self._db.service_transaction() as conn:
                PaymentsRepository(conn).close_unpaid(
                    row["gateway_charge_id"], status.lower(), "reconcile"
                )

    def _confirm(
        self, charge_id: str, amount: int, source: str, _user: AuthenticatedUser | None
    ) -> str:
        with self._db.service_transaction() as conn:
            result = PaymentsRepository(conn).confirm(charge_id, amount, source)
        outcome = result["outcome"]
        if (
            outcome in ("confirmed", "confirmed_late")
            and self._on_paid is not None
            and result["student_id"]
        ):
            # Evento com Meet em nome do aluno participante (RLS de participante); falha não desfaz.
            student = AuthenticatedUser(
                id=result["student_id"],
                email=None,
                session_id=None,
                claims={
                    "sub": str(result["student_id"]),
                    "role": "authenticated",
                    "aud": "authenticated",
                },
            )
            try:
                self._on_paid(student, result["lesson_id"])
            except Exception:  # noqa: BLE001 — Google fora do ar não pode afetar o pagamento
                logger.warning(
                    "pagamento confirmado, mas a criação do evento falhou (lesson=%s)",
                    result["lesson_id"],
                )
        return outcome

    def simulate(self, user: AuthenticatedUser, intent_id: UUID) -> PaymentOut:
        """Só sandbox: pede ao gateway (Modo Teste) para simular o pagamento e concilia."""
        gateway = self._ready()
        if self._settings.payments_stage != "sandbox" or not gateway.dev_mode:
            raise forbidden("sandbox_only", "Simulação disponível apenas no ambiente de testes.")
        row = self._load(user, intent_id)
        if row["student_id"] != user.id:
            raise forbidden()
        if row["status"] != "pending" or not row["gateway_charge_id"]:
            raise ApiError(409, "payment_not_pending", "Este pagamento não está aguardando Pix.")
        try:
            gateway.simulate_payment(row["gateway_charge_id"])
        except (
            GatewayUnavailableError,
            GatewayRejectedError,
            GatewayAuthError,
            InvalidGatewayResponseError,
        ) as exc:
            raise service_unavailable(
                "payment_gateway_error", "Não foi possível simular agora."
            ) from exc
        self._reconcile(user, row)
        return self._out(self._load(user, intent_id), user)

    def history(self, user: AuthenticatedUser) -> list[PaymentOut]:
        if self._settings.payments_stage == "off":
            raise payments_disabled()
        with self._db.user_transaction(user) as conn:
            rows = PaymentsRepository(conn).list_for(user.id)
        return [self._out(r, user) for r in rows]

    def teacher_finance(self, user: AuthenticatedUser, period: FinancePeriod) -> TeacherFinanceOut:
        """Painel exclusivamente do professor, agregado no backend e protegido pelo RLS."""
        if self._settings.payments_stage == "off":
            raise payments_disabled()
        with self._db.user_transaction(user) as conn:
            if "teacher" not in ProfileRepository(conn).list_roles(user.id):
                raise forbidden("role_required", "Disponível apenas para contas de professor.")
            days = {"7d": 7, "30d": 30, "90d": 90}[period]
            since = self._now() - timedelta(days=days)
            repo = PaymentsRepository(conn)
            # O estágio do processo decide o ambiente; ele nunca vem do cliente.
            summary = repo.teacher_finance_summary(user.id, self._env, since)
            rows = repo.list_for_teacher_since(user.id, self._env, since)
        return TeacherFinanceOut(
            period=period,
            environment=self._env,  # o ambiente é decidido pelo servidor, nunca pela query.
            commission_bps=COMMISSION_BPS,
            summary=TeacherFinanceSummary(**summary),
            payout_account=self.payout_account(user),
            payments=[self._out(row, user) for row in rows],
        )

    def commission_progress(self, user: AuthenticatedUser) -> CommissionProgressOut:
        """Progressão do próprio professor; política/ambiente nunca vêm da requisição."""
        if self._settings.payments_stage == "off":
            raise payments_disabled()
        with self._db.user_transaction(user) as conn:
            if "teacher" not in ProfileRepository(conn).list_roles(user.id):
                raise forbidden("role_required", "Disponível apenas para contas de professor.")
            # A função é executável apenas pela conexão da API e ainda valida o sub das claims.
            with as_connection_role(conn):
                row = PaymentsRepository(conn).commission_progress(user.id, self._env)
        if row is None:
            raise service_unavailable(
                "commission_policy_not_configured", "Política de comissão indisponível."
            )
        next_threshold = row["next_min_eligible_paid_lessons"]
        simulation = split_amount(10_000, row["commission_bps"])
        return CommissionProgressOut(
            environment=self._env,
            policy_version=row["policy_version"],
            # A v1 contém só a faixa-base. Só será true após ativação operacional auditada.
            progression_active=next_threshold is not None,
            current_level=row["current_tier"],
            current_rate_bps=row["commission_bps"],
            next_rate_bps=row["next_commission_bps"],
            eligible_paid_lessons=row["eligible_paid_lessons"],
            next_level_paid_lessons=next_threshold,
            lessons_remaining=(
                max(0, next_threshold - row["eligible_paid_lessons"])
                if next_threshold is not None
                else None
            ),
            evaluation_days=row["evaluation_days"],
            eligibility="eligible" if next_threshold is not None else "no_next_level",
            simulation_amount_cents=simulation.amount_cents,
            simulation_commission_cents=simulation.commission_cents,
            simulation_teacher_share_cents=simulation.teacher_share_cents,
        )

    # ------------------------------------------------------------------ webhook

    def webhook(
        self, raw: bytes, headers: dict[str, str], query_secret: str | None
    ) -> WebhookResult:
        s = self._settings
        if s.payments_stage == "off" or not s.payments_configured:
            raise service_unavailable("payments_not_configured", "Pagamentos não configurados.")
        if s.abacatepay_webhook_secret is None or s.abacatepay_webhook_public_key is None:
            raise service_unavailable("payments_not_configured", "Pagamentos não configurados.")
        if not verify_webhook(
            raw,
            header_secret=headers.get("x-webhook-secret"),
            query_secret=query_secret,
            signature=headers.get("x-webhook-signature"),
            expected_secret=s.abacatepay_webhook_secret.get_secret_value(),
            public_key=s.abacatepay_webhook_public_key.get_secret_value(),
        ):
            logger.warning("webhook recusado: segredo ou assinatura inválidos")
            raise unauthorized("invalid_webhook", "Webhook não autenticado.")
        try:
            event = json.loads(raw)
        except ValueError as exc:
            raise ApiError(400, "invalid_payload", "Corpo inválido.") from exc
        event_id, event_type = event.get("id"), event.get("event")
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        transparent = data.get("transparent") if isinstance(data.get("transparent"), dict) else {}
        charge_id = transparent.get("id") if isinstance(transparent.get("id"), str) else None
        if not isinstance(event_id, str) or not isinstance(event_type, str):
            raise ApiError(400, "invalid_payload", "Evento sem id ou tipo.")
        # Ambiente: evento de teste só vale em sandbox e vice-versa.
        if bool(event.get("devMode")) != (s.payments_stage == "sandbox"):
            logger.warning("webhook de outro ambiente ignorado (%s)", event_type)
            return WebhookResult("wrong_environment")
        sha = hashlib.sha256(raw).hexdigest()
        with self._db.service_transaction() as conn:
            first = PaymentsRepository(conn).record_webhook(
                event_id, event_type, charge_id, bool(event.get("devMode")), sha
            )
        if not first:
            return WebhookResult("duplicate")  # reentrega: nada é repetido
        outcome = "ignored"
        if (
            charge_id
            and event_type == "transparent.completed"
            and transparent.get("status") == "PAID"
        ):
            paid = webhook_paid_amount(transparent)
            outcome = (
                "invalid_amount"
                if paid is None
                else self._confirm(charge_id, paid, "webhook", None)
            )
        elif charge_id and event_type == "transparent.refunded":
            with self._db.service_transaction() as conn:
                outcome = PaymentsRepository(conn).mark_after_paid(charge_id, "refunded", "webhook")
        elif charge_id and event_type == "transparent.disputed":
            with self._db.service_transaction() as conn:
                outcome = PaymentsRepository(conn).mark_after_paid(
                    charge_id, "under_dispute", "webhook"
                )
        elif event_type in {"transfer.completed", "transfer.failed"}:
            transfer = data.get("transfer") if isinstance(data.get("transfer"), dict) else {}
            transfer_id, external_id, amount = (
                transfer.get("id"),
                transfer.get("externalId"),
                transfer.get("amount"),
            )
            fee = transfer.get("platformFee")
            expected_status = "COMPLETE" if event_type == "transfer.completed" else "FAILED"
            valid = (
                isinstance(transfer_id, str)
                and isinstance(external_id, str)
                and isinstance(amount, int)
                and not isinstance(amount, bool)
                and amount >= 100
                and transfer.get("status") == expected_status
                and transfer.get("method") == "PIX"
                and (
                    fee is None or (isinstance(fee, int) and not isinstance(fee, bool) and fee >= 0)
                )
            )
            if not valid:
                outcome = "invalid_transfer"
            else:
                with self._db.service_transaction() as conn:
                    outcome = PaymentsRepository(conn).withdrawal_finish(
                        external_id,
                        transfer_id,
                        amount,
                        fee,
                        "completed" if event_type == "transfer.completed" else "failed",
                    )
        with self._db.service_transaction() as conn:
            PaymentsRepository(conn).finish_webhook(event_id, outcome)
        logger.info("webhook %s processado: %s", event_type, outcome)
        return WebhookResult(outcome)

    # ------------------------------------------------------------------ subconta do professor

    def payout_account(self, user: AuthenticatedUser) -> PayoutAccountOut:
        if self._settings.payments_stage == "off":
            raise payments_disabled()
        if not self._settings.abacatepay_split_enabled:
            return PayoutAccountOut(status="split_unavailable")
        with self._db.user_transaction(user) as conn:
            if "teacher" not in ProfileRepository(conn).list_roles(user.id):
                raise forbidden("role_required", "Disponível apenas para contas de professor.")
            row = PaymentsRepository(conn).own_payout(user.id, self._env)
        if row is None:
            return PayoutAccountOut(status="not_configured")
        return PayoutAccountOut(
            status=row["status"],
            environment=row["environment"],
            tax_id_last4=row["tax_id_last4"],
            created_at=row["created_at"],
        )

    def _validated_payout(self, user: AuthenticatedUser) -> tuple[dict[str, Any], Any]:
        gateway = self._ready()
        with self._db.user_transaction(user) as conn:
            if "teacher" not in ProfileRepository(conn).list_roles(user.id):
                raise forbidden("role_required", "Disponível apenas para contas de professor.")
            account = PaymentsRepository(conn).own_payout(user.id, self._env)
        if account is None or account["status"] != "active":
            raise ApiError(409, "payout_account_required", "Conta de recebimentos não configurada.")
        try:
            sub = gateway.get_sub_account(account["sub_account_id"])
        except (
            GatewayUnavailableError,
            GatewayAuthError,
            GatewayRejectedError,
            InvalidGatewayResponseError,
        ) as exc:
            raise service_unavailable(
                "payout_account_not_ready", "Não foi possível validar a subconta."
            ) from exc
        if sub.external_id != str(user.id) or (
            sub.dev_mode is not None and sub.dev_mode != gateway.dev_mode
        ):
            raise service_unavailable(
                "payout_account_not_ready", "A subconta não pôde ser validada."
            )
        return account, sub

    def payout_balance(self, user: AuthenticatedUser) -> PayoutBalanceOut:
        _, sub = self._validated_payout(user)
        return PayoutBalanceOut(
            environment=self._env,
            available_cents=sub.available_cents,
            blocked_cents=sub.blocked_cents,
            withdrawals_enabled=(
                self._env == "production"
                and self._settings.subaccount_withdrawals_enabled
                and self._settings.abacatepay_split_enabled
            ),
        )

    def withdrawals(self, user: AuthenticatedUser) -> list[WithdrawalOut]:
        with self._db.user_transaction(user) as conn:
            if "teacher" not in ProfileRepository(conn).list_roles(user.id):
                raise forbidden("role_required", "Disponível apenas para contas de professor.")
            rows = PaymentsRepository(conn).withdrawals(user.id, self._env)
        return [WithdrawalOut(**row) for row in rows]

    def request_withdrawal(self, user: AuthenticatedUser, data: WithdrawalIn) -> WithdrawalOut:
        if self._env != "production" or not self._settings.subaccount_withdrawals_enabled:
            raise forbidden("withdrawals_disabled", "Saques não estão autorizados neste ambiente.")
        account, sub = self._validated_payout(user)
        if data.amount_cents > sub.available_cents:
            raise ApiError(
                409, "insufficient_balance", "Saldo disponível insuficiente para este saque."
            )
        external = f"wd_{data.idempotency_key.hex}"
        try:
            with self._db.user_transaction(user) as conn, as_connection_role(conn):
                row = PaymentsRepository(conn).withdrawal_create(
                    data.amount_cents,
                    data.idempotency_key,
                    external,
                    self._env,
                    account["sub_account_id"],
                )
        except (psycopg.errors.RaiseException, psycopg.errors.InsufficientPrivilege) as exc:
            raise _db_error(exc) from exc
        # Já anexado/presente: reentrega com a mesma chave nunca chama o gateway novamente.
        if row["gateway_transfer_id"] is not None or row["status"] != "pending":
            return WithdrawalOut(**row)
        gateway = self._ready()
        try:
            transfer = gateway.withdraw_sub_account(
                sub_account_id=account["sub_account_id"],
                amount=data.amount_cents,
                external_id=external,
            )
        except GatewayUnavailableError:
            # Resultado desconhecido: mantém pending e reutiliza o mesmo externalId depois.
            return WithdrawalOut(**row)
        except (GatewayRejectedError, GatewayAuthError) as exc:
            # Recusa conhecida não pode permanecer pendente nem ser reenviada com
            # o mesmo externalId. Uma nova solicitação exige uma nova chave.
            with self._db.user_transaction(user) as conn, as_connection_role(conn):
                PaymentsRepository(conn).withdrawal_fail(row["id"])
            raise service_unavailable(
                "withdrawal_gateway_error", "Não foi possível solicitar o saque."
            ) from exc
        except InvalidGatewayResponseError as exc:
            # Uma resposta 200 fora do contrato pode ter criado a transferência;
            # conserva a ordem pendente e o mesmo externalId para conciliação/retry.
            raise service_unavailable(
                "withdrawal_gateway_unknown", "O resultado do saque precisa ser conciliado."
            ) from exc
        with self._db.user_transaction(user) as conn, as_connection_role(conn):
            PaymentsRepository(conn).withdrawal_attach(
                row["id"], transfer.id, transfer.platform_fee
            )
        row["gateway_transfer_id"], row["gateway_fee_cents"] = transfer.id, transfer.platform_fee
        return WithdrawalOut(**row)

    def save_payout_account(
        self, user: AuthenticatedUser, data: PayoutAccountIn
    ) -> PayoutAccountOut:
        gateway = self._ready()
        if not self._settings.abacatepay_split_enabled:
            raise ApiError(
                409, "split_unavailable", "O repasse automático ainda não está habilitado."
            )
        with self._db.user_transaction(user) as conn:
            if "teacher" not in ProfileRepository(conn).list_roles(user.id):
                raise forbidden("role_required", "Disponível apenas para contas de professor.")
            existing = PaymentsRepository(conn).own_payout(user.id, self._env)
        if existing is not None:
            # Evita cadastrar outro CPF/CNPJ para o mesmo professor/ambiente por repetição ou troca
            # de formulário. O identificador local continua sendo a fonte de verdade do recebedor.
            try:
                sub = gateway.get_sub_account(existing["sub_account_id"])
            except (
                GatewayUnavailableError,
                GatewayAuthError,
                GatewayRejectedError,
                InvalidGatewayResponseError,
            ) as exc:
                raise service_unavailable(
                    "payout_account_not_ready",
                    "Não foi possível validar a conta de recebimentos agora.",
                ) from exc
            if (
                sub.external_id != str(user.id)
                or sub.tax_id_last4 != existing["tax_id_last4"]
                or (sub.dev_mode is not None and sub.dev_mode != gateway.dev_mode)
            ):
                raise service_unavailable(
                    "payout_account_not_ready", "A conta de recebimentos não pôde ser validada."
                )
            return self.payout_account(user)
        try:
            sub = gateway.create_sub_account(
                name=data.legal_name, tax_id=data.tax_id, external_id=str(user.id)
            )
        except SplitNotEnabledError as exc:
            raise ApiError(
                409, "split_unavailable", "Subcontas ainda não habilitadas na conta da EduSearch."
            ) from exc
        except GatewayRejectedError as exc:
            raise ApiError(
                422, "payout_rejected", "O gateway recusou os dados. Confira nome e CPF/CNPJ."
            ) from exc
        except (GatewayUnavailableError, GatewayAuthError, InvalidGatewayResponseError) as exc:
            raise service_unavailable(
                "payment_gateway_error", "Gateway indisponível. Tente de novo."
            ) from exc
        if (
            sub.external_id != str(user.id)
            or sub.tax_id_last4 != data.tax_id[-4:]
            or (sub.dev_mode is not None and sub.dev_mode != gateway.dev_mode)
        ):
            raise ApiError(
                422,
                "payout_rejected",
                "O gateway devolveu uma subconta incompatível com o professor.",
            )
        with self._db.user_transaction(user) as conn, as_connection_role(conn):
            PaymentsRepository(conn).payout_upsert(sub.id, sub.tax_id_last4, self._env)
        return self.payout_account(user)


def build_gateway(settings: Settings) -> AbacatePayClient | None:
    if settings.payments_stage == "off" or not settings.abacatepay_api_key:
        return None
    return AbacatePayClient(
        settings.abacatepay_api_key.get_secret_value(), timeout=settings.abacatepay_timeout_seconds
    )


def get_payments_service(
    request: Request, database: Annotated[BaseDatabase, Depends(get_database)]
) -> PaymentsService:
    from app.services.scheduling import get_scheduling_service  # noqa: PLC0415 — evita ciclo

    state = request.app.state
    scheduling = get_scheduling_service(request, database)

    def on_paid(student: AuthenticatedUser, lesson_id: UUID) -> None:
        scheduling.sync_lesson_calendar(student, lesson_id)  # type: ignore[attr-defined]

    return PaymentsService(
        database,
        state.settings,
        gateway=getattr(state, "payment_gateway", None),
        on_paid=on_paid,
        clock=getattr(state, "clock", lambda: datetime.now(UTC)),
    )
