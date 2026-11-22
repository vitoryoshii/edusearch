"""Contratos da agenda (Fase 3A): conexão com o Google Agenda, disponibilidade e aulas de teste.

Entradas recusam campos desconhecidos (422). IDs de evento, links do Meet, status de sincronização
e cancelamento são definidos só pelo servidor.
"""

import re
from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.schemas.onboarding import Weekday

_STRICT = ConfigDict(extra="forbid")
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$|^24:00$")


def _hhmm(value: str) -> str:
    if not _HHMM.match(value):
        raise ValueError("use o formato HH:MM")
    return value


HHMM = Annotated[str, AfterValidator(_hhmm)]

CalendarStatus = Literal["not_configured", "not_connected", "connected", "revoked"]
SyncStatus = Literal["not_connected", "pending", "synced", "failed", "removed"]
LessonStatus = Literal["scheduled", "cancelled"]


# ------------------------------------------------------------------------------- estado


class SchedulingStatus(BaseModel):
    """O que está liberado nesta fase (o frontend esconde o que não estiver)."""

    stage: Literal["off", "testing"]
    calendar_configured: bool
    payments_enabled: Literal[False] = False
    commercial_lessons_enabled: Literal[False] = False


# ------------------------------------------------------------------------------- Google Agenda


class CalendarConnection(BaseModel):
    status: CalendarStatus
    connected_at: datetime | None = None
    revoked_at: datetime | None = None


class AuthorizationStart(BaseModel):
    authorization_url: str


class AuthorizationComplete(BaseModel):
    model_config = _STRICT

    code: Annotated[str, Field(min_length=10, max_length=2048)]
    state: Annotated[str, Field(min_length=20, max_length=2048)]


# ------------------------------------------------------------------------------- disponibilidade


class AvailabilityWindow(BaseModel):
    model_config = _STRICT

    weekday: Weekday
    start: HHMM
    end: HHMM


class AvailabilityIn(BaseModel):
    model_config = _STRICT

    windows: Annotated[list[AvailabilityWindow], Field(max_length=28)]


class AvailabilityOut(BaseModel):
    timezone: Literal["America/Sao_Paulo"] = "America/Sao_Paulo"
    windows: list[AvailabilityWindow]


# ------------------------------------------------------------------------------- professores


class BookableTeacher(BaseModel):
    id: UUID
    display_name: str
    avatar_url: str | None
    headline: str | None
    subjects: list[str]
    lesson_durations_minutes: list[int]
    modality: str | None


class SlotsOut(BaseModel):
    timezone: Literal["America/Sao_Paulo"] = "America/Sao_Paulo"
    duration_minutes: int
    slots: list[datetime]


# ------------------------------------------------------------------------------- aulas


class LessonCreate(BaseModel):
    model_config = _STRICT

    teacher_id: UUID
    subject: Annotated[str, Field(min_length=2, max_length=60, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")]
    starts_at: datetime
    duration_minutes: Literal[30, 45, 60, 90]
    # Gerada pelo app a cada intenção de reserva: reenviar (clique duplo, nova tentativa) devolve a
    # MESMA aula em vez de criar outra.
    idempotency_key: UUID

    @model_validator(mode="after")
    def _aware(self) -> Self:
        if self.starts_at.tzinfo is None:
            raise ValueError("starts_at precisa de fuso (ex.: 2026-12-01T14:00:00-03:00)")
        return self


class LessonParty(BaseModel):
    id: UUID
    display_name: str | None


class LessonOut(BaseModel):
    id: UUID
    role: Literal["teacher", "student"]
    teacher: LessonParty
    student: LessonParty
    subject: str
    starts_at: datetime
    ends_at: datetime
    status: LessonStatus
    is_test: Literal[True] = True
    calendar_sync_status: SyncStatus
    meet_url: str | None
    cancelled_at: datetime | None
    cancelled_by_role: Literal["teacher", "student"] | None
    created_at: datetime
