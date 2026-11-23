"""Contratos de pagamento (Fase 5). Entradas recusam campos desconhecidos (422): o app NUNCA envia
valor, comissão, recebedor ou status. Tudo isso é calculado e decidido pelo servidor.
"""

import re
from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

_STRICT = ConfigDict(extra="forbid")

PaymentStatus = Literal[
    "pending", "paid", "expired", "cancelled", "refunded", "under_dispute", "failed"
]
SplitStatus = Literal["not_applicable", "unavailable", "pending", "credited", "failed"]


def _digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def _cpf_ok(d: str) -> bool:
    if len(d) != 11 or d == d[0] * 11:
        return False
    for n in (9, 10):
        total = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        if (total * 10 % 11) % 10 != int(d[n]):
            return False
    return True


def _cnpj_ok(d: str) -> bool:
    if len(d) != 14 or d == d[0] * 14:
        return False
    for n, weights in (
        (12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]),
        (13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]),
    ):
        rest = sum(int(d[i]) * weights[i] for i in range(n)) % 11
        if (0 if rest < 2 else 11 - rest) != int(d[n]):
            return False
    return True


def _tax_id(value: str) -> str:
    d = _digits(value)
    if not (_cpf_ok(d) or _cnpj_ok(d)):
        raise ValueError("CPF ou CNPJ inválido")
    return d


TaxId = Annotated[str, Field(min_length=11, max_length=18), AfterValidator(_tax_id)]


class PaymentsStatus(BaseModel):
    stage: Literal["off", "sandbox", "production"]
    configured: bool
    commission_bps: int
    split_enabled: bool
    hold_minutes: int


class CheckoutIn(BaseModel):
    model_config = _STRICT

    teacher_id: UUID
    subject: Annotated[str, Field(min_length=2, max_length=60, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")]
    starts_at: datetime
    duration_minutes: Literal[30, 45, 60, 90]
    idempotency_key: UUID

    @model_validator(mode="after")
    def _aware(self) -> Self:
        if self.starts_at.tzinfo is None:
            raise ValueError("starts_at precisa de fuso")
        return self


class PaymentLesson(BaseModel):
    id: UUID | None
    subject: str | None
    starts_at: datetime | None
    ends_at: datetime | None
    status: str | None
    teacher_name: str | None
    student_name: str | None
    meet_url: str | None
    calendar_sync_status: str | None


class RefundOut(BaseModel):
    status: Literal["requested", "approved", "rejected", "processing", "completed", "failed"]
    reason: str
    created_at: datetime


class PaymentOut(BaseModel):
    id: UUID
    role: Literal["student", "teacher"]
    status: PaymentStatus
    environment: Literal["sandbox", "production"]
    amount_cents: int
    commission_policy_version: str
    commission_bps: int
    commission_cents: int
    teacher_share_cents: int
    currency: Literal["BRL"]
    # Pix copia e cola e QR (data URI PNG): só para o aluno, só enquanto pendente.
    br_code: str | None
    br_code_image: str | None
    expires_at: datetime
    paid_at: datetime | None
    split_status: SplitStatus
    # true enquanto a cobrança no gateway ainda não foi criada (a próxima consulta tenta de novo).
    charge_pending: bool
    lesson: PaymentLesson
    refund: RefundOut | None
    created_at: datetime


class PayoutAccountIn(BaseModel):
    model_config = _STRICT

    legal_name: Annotated[str, Field(min_length=3, max_length=100)]
    tax_id: TaxId


class PayoutAccountOut(BaseModel):
    status: Literal["split_unavailable", "not_configured", "active", "disabled"]
    environment: Literal["sandbox", "production"] | None = None
    tax_id_last4: str | None = None
    created_at: datetime | None = None


# ----------------------------------------------------------- painel financeiro do professor


FinancePeriod = Literal["7d", "30d", "90d"]


class TeacherFinanceSummary(BaseModel):
    """Totais de leitura do professor; todos os valores são centavos inteiros.

    ``teacher_share_cents`` é atribuído pela regra da aula paga, nunca saldo disponível ou saque.
    """

    gross_cents: int
    commission_cents: int
    teacher_share_cents: int
    gateway_fee_cents: int
    paid_lessons: int
    pending_lessons: int
    cancelled_lessons: int
    refunded_lessons: int


class TeacherFinanceOut(BaseModel):
    period: FinancePeriod
    environment: Literal["sandbox", "production"]
    commission_bps: int
    summary: TeacherFinanceSummary
    payout_account: PayoutAccountOut
    payments: list[PaymentOut]


class CommissionProgressOut(BaseModel):
    """Leitura da política ativa; não é saldo, promessa de ganho nem autorização de repasse."""

    environment: Literal["sandbox", "production"]
    policy_version: str
    progression_active: bool
    current_level: int
    current_rate_bps: int
    next_rate_bps: int | None
    eligible_paid_lessons: int
    next_level_paid_lessons: int | None
    lessons_remaining: int | None
    evaluation_days: int
    eligibility: Literal["eligible", "no_next_level"]
    # Exemplo calculado pelo servidor: informação educativa, não saldo ou promessa.
    simulation_amount_cents: int
    simulation_commission_cents: int
    simulation_teacher_share_cents: int
