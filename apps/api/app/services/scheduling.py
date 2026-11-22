"""Agenda (Fase 3A): conexão com o Google Agenda, disponibilidade e aulas de TESTE com Meet.

Ordem das operações numa reserva:
1. Transação do aluno (RLS): valida e grava a aula. Conflitos e duplicidade são barrados pelo
   banco (EXCLUDE e chave de idempotência). A transação TERMINA antes de chamar o Google.
2. Fora de transação: renova o access token do professor e cria o evento com Meet (ID do evento
   = ID da aula: repetir nunca duplica).
3. Nova transação: grava ``synced`` + link do Meet, ou ``failed``/``not_connected``.
Falha no Google nunca desfaz a aula; o professor pode tentar sincronizar de novo.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Protocol
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import Depends, Request

from app.auth.dependencies import get_database
from app.auth.jwt import AuthenticatedUser
from app.config import Settings
from app.crypto import DecryptionError, TokenCipher
from app.db import BaseDatabase, as_connection_role
from app.errors import ApiError, forbidden, not_found, service_unavailable
from app.google_calendar import (
    CALENDAR_SCOPE,
    CredentialRevokedError,
    GoogleCalendarClient,
    GoogleRequestError,
    GoogleUnavailableError,
    pkce_pair,
)
from app.repositories.catalog import CatalogRepository
from app.repositories.profiles import ProfileRepository
from app.repositories.scheduling import LessonRejectedError, SchedulingRepository, SlotTakenError
from app.scheduling import (
    InvalidWindowsError,
    Window,
    available_slots,
    booking_problem,
    hhmm,
    minutes_from_hhmm,
    normalize_windows,
)
from app.schemas.scheduling import (
    AuthorizationStart,
    AvailabilityIn,
    AvailabilityOut,
    AvailabilityWindow,
    BookableTeacher,
    CalendarConnection,
    CatalogFilters,
    LessonCreate,
    LessonOut,
    LessonParty,
    SchedulingStatus,
    SlotsOut,
    TeacherPublicProfile,
)
from app.services.profiles import account_suspended, load_profile

logger = logging.getLogger("edusearch.api.scheduling")

# Com "só com horário livre", no máximo estes candidatos são avaliados (piloto: poucos professores).
CATALOG_SCAN_CAP = 200


def scheduling_disabled() -> ApiError:
    return forbidden("scheduling_disabled", "A agenda ainda não está disponível nesta fase.")


def calendar_not_configured() -> ApiError:
    return service_unavailable(
        "calendar_not_configured", "A integração com o Google Agenda não está configurada."
    )


def _role_required(role: str) -> ApiError:
    label = "professor" if role == "teacher" else "aluno"
    return forbidden("role_required", f"Disponível apenas para contas de {label}.")


class SchedulingService(Protocol):
    def status(self) -> SchedulingStatus: ...
    def calendar(self, user: AuthenticatedUser) -> CalendarConnection: ...
    def start_authorization(self, user: AuthenticatedUser) -> AuthorizationStart: ...
    def complete_authorization(
        self, user: AuthenticatedUser, code: str, state: str
    ) -> CalendarConnection: ...
    def disconnect(self, user: AuthenticatedUser) -> CalendarConnection: ...
    def get_availability(self, user: AuthenticatedUser) -> AvailabilityOut: ...
    def put_availability(
        self, user: AuthenticatedUser, data: AvailabilityIn
    ) -> AvailabilityOut: ...
    def teachers(
        self, user: AuthenticatedUser, filters: CatalogFilters | None = None
    ) -> list[BookableTeacher]: ...
    def teacher_profile(
        self, user: AuthenticatedUser, teacher_id: UUID
    ) -> TeacherPublicProfile: ...
    def slots(
        self, user: AuthenticatedUser, teacher_id: UUID, duration: int, days: int
    ) -> SlotsOut: ...
    def book(self, user: AuthenticatedUser, data: LessonCreate) -> tuple[LessonOut, bool]: ...
    def lessons(self, user: AuthenticatedUser) -> list[LessonOut]: ...
    def cancel(self, user: AuthenticatedUser, lesson_id: UUID) -> LessonOut: ...
    def resync(self, user: AuthenticatedUser, lesson_id: UUID) -> LessonOut: ...


class DbSchedulingService:
    def __init__(
        self,
        database: BaseDatabase,
        settings: Settings,
        *,
        google: GoogleCalendarClient | None,
        cipher: TokenCipher | None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._db = database
        self._settings = settings
        self._google = google
        self._cipher = cipher
        self._now = clock

    # ------------------------------------------------------------------ guardas

    def _enabled(self) -> None:
        if self._settings.scheduling_stage == "off":
            raise scheduling_disabled()

    def _calendar_ready(self) -> tuple[GoogleCalendarClient, TokenCipher]:
        self._enabled()
        if self._google is None or self._cipher is None:
            raise calendar_not_configured()
        return self._google, self._cipher

    def _guard(self, conn: Any, user: AuthenticatedUser, role: str, *, write: bool = False) -> None:
        profile = load_profile(conn, user)
        if role not in ProfileRepository(conn).list_roles(user.id):
            raise _role_required(role)
        if write and profile.status == "suspended":
            raise account_suspended()

    # ------------------------------------------------------------------ estado

    def status(self) -> SchedulingStatus:
        return SchedulingStatus(
            stage=self._settings.scheduling_stage,  # type: ignore[arg-type]
            calendar_configured=self._google is not None and self._cipher is not None,
        )

    # ------------------------------------------------------------------ Google Agenda

    @staticmethod
    def _connection(row: dict[str, Any] | None) -> CalendarConnection:
        if row is None:
            return CalendarConnection(status="not_connected")
        return CalendarConnection(
            status=row["status"], connected_at=row["connected_at"], revoked_at=row["revoked_at"]
        )

    def calendar(self, user: AuthenticatedUser) -> CalendarConnection:
        self._enabled()
        if self._google is None or self._cipher is None:
            return CalendarConnection(status="not_configured")
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "teacher")
            with as_connection_role(conn):
                row = SchedulingRepository(conn).get_credentials(user.id)
            return self._connection(row)

    def start_authorization(self, user: AuthenticatedUser) -> AuthorizationStart:
        google, cipher = self._calendar_ready()
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "teacher", write=True)
        verifier, challenge = pkce_pair()
        state = cipher.seal_state({"sub": str(user.id), "cv": verifier})
        return AuthorizationStart(
            authorization_url=google.authorization_url(state=state, code_challenge=challenge)
        )

    def complete_authorization(
        self, user: AuthenticatedUser, code: str, state: str
    ) -> CalendarConnection:
        google, cipher = self._calendar_ready()
        try:
            payload = cipher.open_state(state)
        except DecryptionError as exc:
            raise ApiError(
                400, "invalid_state", "A autorização expirou ou é inválida. Tente conectar de novo."
            ) from exc
        # O state carrega QUEM iniciou: um link de autorização de outra conta não conecta esta.
        if payload.get("sub") != str(user.id):
            raise forbidden("state_mismatch", "Esta autorização foi iniciada por outra conta.")
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "teacher", write=True)
        try:
            grant = google.exchange_code(code=code, code_verifier=str(payload.get("cv", "")))
        except GoogleRequestError as exc:
            raise ApiError(
                400, "authorization_failed", "O Google não confirmou a autorização. Tente de novo."
            ) from exc
        except GoogleUnavailableError as exc:
            raise service_unavailable(
                "google_unavailable", "O Google não respondeu agora. Tente de novo."
            ) from exc
        if CALENDAR_SCOPE not in grant.scopes:
            # Consentimento granular: o professor pode desmarcar a permissão da agenda.
            if grant.refresh_token:
                google.revoke(grant.refresh_token)
            raise ApiError(
                422,
                "calendar_scope_denied",
                "Para criar as aulas na sua agenda, permita o acesso aos eventos do Google Agenda.",
            )
        if not grant.refresh_token:
            raise ApiError(
                422,
                "refresh_token_missing",
                "O Google não liberou o acesso contínuo. Tente de novo.",
            )
        blob = cipher.encrypt_token(grant.refresh_token, owner=user.id)
        with self._db.user_transaction(user) as conn:
            repo = SchedulingRepository(conn)
            with as_connection_role(conn):
                repo.save_credentials(
                    user.id,
                    ciphertext=blob,
                    key_version=cipher.key_version,
                    scopes=[CALENDAR_SCOPE],
                )
                row = repo.get_credentials(user.id)
        return self._connection(row)

    def disconnect(self, user: AuthenticatedUser) -> CalendarConnection:
        google, cipher = self._calendar_ready()
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "teacher")
            repo = SchedulingRepository(conn)
            with as_connection_role(conn):
                row = repo.get_credentials(user.id)
                repo.delete_credentials(user.id)
        if row and row["refresh_token_ciphertext"]:
            try:
                token = cipher.decrypt_token(
                    bytes(row["refresh_token_ciphertext"]),
                    owner=user.id,
                    key_version=row["key_version"],
                )
                google.revoke(token)
            except DecryptionError:
                logger.warning("credencial ilegível ao desconectar (removida mesmo assim)")
        return CalendarConnection(status="not_connected")

    # ------------------------------------------------------------------ disponibilidade

    @staticmethod
    def _windows_out(windows: list[Window]) -> AvailabilityOut:
        return AvailabilityOut(
            windows=[
                AvailabilityWindow(
                    weekday=w.weekday, start=hhmm(w.start_minute), end=hhmm(w.end_minute)
                )  # type: ignore[arg-type]
                for w in normalize_windows(windows)
            ]
        )

    def get_availability(self, user: AuthenticatedUser) -> AvailabilityOut:
        self._enabled()
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "teacher")
            return self._windows_out(SchedulingRepository(conn).list_windows(user.id))

    def put_availability(self, user: AuthenticatedUser, data: AvailabilityIn) -> AvailabilityOut:
        self._enabled()
        try:
            windows = normalize_windows(
                [
                    Window(w.weekday, minutes_from_hhmm(w.start), minutes_from_hhmm(w.end))
                    for w in data.windows
                ]
            )
        except (InvalidWindowsError, ValueError) as exc:
            raise ApiError(
                422, "invalid_availability", f"Disponibilidade inválida: {exc}."
            ) from exc
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "teacher", write=True)
            repo = SchedulingRepository(conn)
            if not repo.has_teacher_profile(user.id):
                raise ApiError(
                    409, "teacher_profile_required", "Salve o cadastro de professor antes."
                )
            repo.replace_windows(user.id, windows)
            return self._windows_out(repo.list_windows(user.id))

    # ------------------------------------------------------------------ professores e horários

    def teachers(
        self, user: AuthenticatedUser, filters: CatalogFilters | None = None
    ) -> list[BookableTeacher]:
        """Catálogo: professores PUBLICADOS, filtros reais e paginação por limit/offset.

        ``next_slot`` (primeiro horário livre em 14 dias) é calculado só para a página devolvida;
        com ``available_only`` os candidatos (no máximo ``CATALOG_SCAN_CAP``) são avaliados antes
        de paginar. Suficiente para o piloto; um índice materializado substitui isto em escala.
        """
        self._enabled()
        f = filters or CatalogFilters()
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "student")
            repo = CatalogRepository(conn)
            common = dict(
                exclude=user.id, q=f.q, subject=f.subject, modality=f.modality, period=f.period
            )
            if f.available_only:
                rows = repo.search(**common, limit=CATALOG_SCAN_CAP, offset=0)
                rows = [r | {"next_slot": self._next_slot(conn, user, r)} for r in rows]
                rows = [r for r in rows if r["next_slot"] is not None]
                page = rows[f.offset : f.offset + f.limit]
            else:
                page = repo.search(**common, limit=f.limit, offset=f.offset)
                page = [r | {"next_slot": self._next_slot(conn, user, r)} for r in page]
        return [BookableTeacher(**r) for r in page]

    def _next_slot(
        self, conn: Any, user: AuthenticatedUser, row: dict[str, Any]
    ) -> datetime | None:
        durations = row.get("lesson_durations_minutes") or []
        if not durations:
            return None
        windows = SchedulingRepository(conn).list_windows(row["id"])
        if not windows:
            return None
        busy = self._busy(conn, user, row["id"])
        slots = available_slots(windows, min(durations), busy, now=self._now(), days=14)
        return slots[0] if slots else None

    def teacher_profile(self, user: AuthenticatedUser, teacher_id: UUID) -> TeacherPublicProfile:
        """Perfil público. Aluno vê professores publicados; o professor pré-visualiza o próprio."""
        self._enabled()
        with self._db.user_transaction(user) as conn:
            own = teacher_id == user.id
            if not own:
                self._guard(conn, user, "student")
            row = CatalogRepository(conn).profile(teacher_id)
        if row is None or (not own and not row["is_published"]):
            raise not_found("teacher_not_found", "Professor não encontrado.")
        return TeacherPublicProfile(**row, is_own_profile=own)

    def _busy(self, conn: Any, user: AuthenticatedUser, teacher_id: UUID) -> list[tuple]:
        now = self._now()
        start, end = now - timedelta(days=1), now + timedelta(days=61)
        repo = SchedulingRepository(conn)
        with as_connection_role(conn):
            busy = repo.teacher_busy(teacher_id, start, end)
        return busy + repo.own_busy(user.id, start, end)

    def slots(
        self, user: AuthenticatedUser, teacher_id: UUID, duration: int, days: int
    ) -> SlotsOut:
        self._enabled()
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "student")
            repo = SchedulingRepository(conn)
            offer = repo.teacher_offer(teacher_id)
            if offer is None or teacher_id == user.id:
                raise not_found("teacher_not_found", "Professor não encontrado.")
            if duration not in offer["durations"]:
                raise ApiError(
                    422, "duration_not_offered", "Duração não oferecida por este professor."
                )
            windows = repo.list_windows(teacher_id)
            busy = self._busy(conn, user, teacher_id)
        slots = available_slots(windows, duration, busy, now=self._now(), days=days)
        return SlotsOut(duration_minutes=duration, slots=slots)

    # ------------------------------------------------------------------ aulas

    def _lesson_out(self, row: dict[str, Any], user: AuthenticatedUser) -> LessonOut:
        return LessonOut(
            id=row["id"],
            role="teacher" if row["teacher_id"] == user.id else "student",
            teacher=LessonParty(id=row["teacher_id"], display_name=row["teacher_name"]),
            student=LessonParty(id=row["student_id"], display_name=row["student_name"]),
            subject=row["subject"],
            starts_at=row["starts_at"],
            ends_at=row["ends_at"],
            status=row["status"],
            calendar_sync_status=row["calendar_sync_status"],
            meet_url=row["meet_url"] if row["status"] == "scheduled" else None,
            cancelled_at=row["cancelled_at"],
            cancelled_by_role=row["cancelled_by_role"],
            created_at=row["created_at"],
        )

    def _load(self, user: AuthenticatedUser, lesson_id: UUID) -> dict[str, Any]:
        with self._db.user_transaction(user) as conn:
            row = SchedulingRepository(conn).get_lesson(lesson_id)
        if row is None:
            raise not_found("lesson_not_found", "Aula não encontrada.")
        return row

    def book(self, user: AuthenticatedUser, data: LessonCreate) -> tuple[LessonOut, bool]:
        self._enabled()
        start = data.starts_at.astimezone(UTC)
        end = start + timedelta(minutes=data.duration_minutes)
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "student", write=True)
            repo = SchedulingRepository(conn)
            offer = repo.teacher_offer(data.teacher_id)
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
            subject_id = repo.subject_id(data.subject)
            if subject_id is None:
                raise ApiError(422, "unknown_subject", f"Disciplina inválida: {data.subject}.")

            # Repetição da MESMA reserva (clique duplo, nova tentativa após timeout): devolve a
            # aula existente. A mesma chave com outro professor/horário é recusada.
            existing = repo.lesson_by_key(user.id, data.idempotency_key)
            if existing is not None:
                if existing["teacher_id"] != data.teacher_id or existing["starts_at"] != start:
                    raise ApiError(
                        409, "idempotency_conflict", "Esta reserva já foi usada para outro horário."
                    )
                lesson_id, created = existing["id"], False
            else:
                windows = repo.list_windows(data.teacher_id)
                busy = self._busy(conn, user, data.teacher_id)
                problem = booking_problem(
                    start, data.duration_minutes, windows, busy, now=self._now()
                )
                if problem == "horário indisponível":
                    raise ApiError(409, "slot_unavailable", "Este horário já está ocupado.")
                if problem:
                    raise ApiError(422, "slot_invalid", f"Horário inválido: {problem}.")
                try:
                    lesson_id, created = repo.insert_lesson(
                        teacher_id=data.teacher_id,
                        student_id=user.id,
                        subject_id=subject_id,
                        starts_at=start,
                        ends_at=end,
                        idempotency_key=data.idempotency_key,
                    )
                except SlotTakenError as exc:
                    # Corrida: outra reserva venceu entre a validação e o INSERT (o banco barrou).
                    raise ApiError(
                        409, "slot_unavailable", "Este horário acabou de ser reservado."
                    ) from exc
                except LessonRejectedError as exc:
                    raise ApiError(
                        422, "slot_invalid", "Horário indisponível para reserva."
                    ) from exc
        row = self._load(user, lesson_id)
        if created:
            row = self._sync_create(user, row)
        return self._lesson_out(row, user), created

    def lessons(self, user: AuthenticatedUser) -> list[LessonOut]:
        self._enabled()
        with self._db.user_transaction(user) as conn:
            load_profile(conn, user)
            rows = SchedulingRepository(conn).list_lessons(user.id)
        return [self._lesson_out(r, user) for r in rows]

    def cancel(self, user: AuthenticatedUser, lesson_id: UUID) -> LessonOut:
        self._enabled()
        with self._db.user_transaction(user) as conn:
            repo = SchedulingRepository(conn)
            if repo.get_lesson(lesson_id) is None:
                raise not_found("lesson_not_found", "Aula não encontrada.")
            if not repo.cancel_lesson(lesson_id):
                raise ApiError(
                    409, "lesson_not_cancellable", "Esta aula não pode mais ser cancelada."
                )
        row = self._load(user, lesson_id)
        row = self._sync_delete(user, row)
        return self._lesson_out(row, user)

    def resync(self, user: AuthenticatedUser, lesson_id: UUID) -> LessonOut:
        self._enabled()
        row = self._load(user, lesson_id)
        if row["teacher_id"] != user.id:
            raise forbidden("teacher_only", "Só o professor da aula pode sincronizar a agenda.")
        if row["status"] == "scheduled" and row["calendar_sync_status"] in {
            "pending",
            "failed",
            "not_connected",
        }:
            row = self._sync_create(user, row)
        return self._lesson_out(row, user)

    # ------------------------------------------------------------------ sincronização com o Google

    def _access_token(self, user: AuthenticatedUser, teacher_id: UUID) -> str | None:
        """Access token novo do professor; ``None`` se nunca conectou/desconectou.

        Credencial revogada no Google ou ilegível: marca ``revoked`` (o professor vê "reconectar")
        e levanta ``CredentialRevokedError``.
        """
        if self._google is None or self._cipher is None:
            return None
        with self._db.user_transaction(user) as conn:
            with as_connection_role(conn):
                creds = SchedulingRepository(conn).get_credentials(teacher_id)
        if not creds or creds["status"] != "connected":
            return None
        try:
            refresh = self._cipher.decrypt_token(
                bytes(creds["refresh_token_ciphertext"]),
                owner=teacher_id,
                key_version=creds["key_version"],
            )
            return self._google.refresh_access_token(refresh)
        except (DecryptionError, CredentialRevokedError) as exc:
            logger.warning("credencial do Google Agenda revogada ou ilegível: reconexão necessária")
            self._mark_revoked(user, teacher_id)
            raise CredentialRevokedError("reconnect") from exc

    def _mark_revoked(self, user: AuthenticatedUser, teacher_id: UUID) -> None:
        with self._db.user_transaction(user) as conn:
            with as_connection_role(conn):
                SchedulingRepository(conn).mark_revoked(teacher_id)

    def _event_body(self, row: dict[str, Any]) -> dict[str, Any]:
        redirect = self._settings.google_oauth_redirect_uri or ""
        parts = urlsplit(redirect)
        app_url = f"{parts.scheme}://{parts.netloc}/conta/agenda" if parts.netloc else ""
        tz = "America/Sao_Paulo"
        return {
            "summary": f"Aula de teste EduSearch — {row['subject_name']}",
            "description": (
                "Aula de TESTE agendada pelo EduSearch (sem cobrança)."
                + (f"\nDetalhes no app: {app_url}" if app_url else "")
            ),
            "start": {"dateTime": row["starts_at"].isoformat(), "timeZone": tz},
            "end": {"dateTime": row["ends_at"].isoformat(), "timeZone": tz},
            "visibility": "private",
            "conferenceData": {
                "createRequest": {
                    "requestId": row["id"].hex,
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            },
        }

    def _set_calendar(
        self, user: AuthenticatedUser, lesson_id: UUID, **fields: Any
    ) -> dict[str, Any]:
        with self._db.user_transaction(user) as conn:
            repo = SchedulingRepository(conn)
            with as_connection_role(conn):
                repo.set_calendar(lesson_id, **fields)
            row = repo.get_lesson(lesson_id)
        assert row is not None  # noqa: S101
        return row

    def _sync_create(self, user: AuthenticatedUser, row: dict[str, Any]) -> dict[str, Any]:
        try:
            access = self._access_token(user, row["teacher_id"])
            if access is None:
                return self._set_calendar(user, row["id"], status="not_connected")
            assert self._google is not None  # noqa: S101
            event = self._google.create_event(
                access, event_id=row["id"].hex, body=self._event_body(row)
            )
            if event.meet_url is None:
                # O Meet pode ficar "pendente" por instantes: uma releitura costuma bastar.
                event = self._google.get_event(access, event_id=event.event_id)
            return self._set_calendar(
                user, row["id"], status="synced", event_id=event.event_id, meet_url=event.meet_url
            )
        except CredentialRevokedError:
            # Revogado no refresh (já marcado) ou recusado pela Calendar API (401/403).
            self._mark_revoked(user, row["teacher_id"])
            return self._set_calendar(user, row["id"], status="failed")
        except (GoogleUnavailableError, GoogleRequestError) as exc:
            logger.warning("falha ao criar evento no Google: %s", exc.__class__.__name__)
            return self._set_calendar(user, row["id"], status="failed")

    def _sync_delete(self, user: AuthenticatedUser, row: dict[str, Any]) -> dict[str, Any]:
        if not row["google_event_id"]:
            return self._set_calendar(user, row["id"], status="removed")
        try:
            access = self._access_token(user, row["teacher_id"])
            if access is None:
                return self._set_calendar(user, row["id"], status="failed", keep_event=True)
            assert self._google is not None  # noqa: S101
            self._google.delete_event(access, event_id=row["google_event_id"])
            return self._set_calendar(
                user, row["id"], status="removed", event_id=row["google_event_id"], meet_url=None
            )
        except (CredentialRevokedError, GoogleUnavailableError, GoogleRequestError) as exc:
            logger.warning("falha ao remover evento no Google: %s", exc.__class__.__name__)
            return self._set_calendar(user, row["id"], status="failed", keep_event=True)


def build_calendar_client(
    settings: Settings,
) -> tuple[GoogleCalendarClient | None, TokenCipher | None]:
    if not settings.calendar_configured:
        return None, None
    assert settings.google_oauth_client_secret is not None  # noqa: S101
    assert settings.token_encryption_key is not None  # noqa: S101
    cipher = TokenCipher(
        settings.token_encryption_key.get_secret_value(),
        key_version=settings.token_encryption_key_version,
    )
    google = GoogleCalendarClient(
        client_id=str(settings.google_oauth_client_id),
        client_secret=settings.google_oauth_client_secret.get_secret_value(),
        redirect_uri=str(settings.google_oauth_redirect_uri),
        timeout=settings.google_timeout_seconds,
    )
    return google, cipher


def get_scheduling_service(
    request: Request, database: Annotated[BaseDatabase, Depends(get_database)]
) -> SchedulingService:
    state = request.app.state
    return DbSchedulingService(
        database,
        state.settings,
        google=getattr(state, "google_calendar", None),
        cipher=getattr(state, "token_cipher", None),
        clock=getattr(state, "clock", lambda: datetime.now(UTC)),
    )
