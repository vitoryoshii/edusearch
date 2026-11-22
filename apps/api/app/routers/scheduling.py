from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response

from app.auth.dependencies import CurrentUser
from app.schemas.common import ErrorResponse
from app.schemas.scheduling import (
    AuthorizationComplete,
    AuthorizationStart,
    AvailabilityIn,
    AvailabilityOut,
    BookableTeacher,
    CalendarConnection,
    LessonCreate,
    LessonOut,
    SchedulingStatus,
    SlotsOut,
)
from app.services.scheduling import SchedulingService, get_scheduling_service

router = APIRouter(tags=["agenda"])
Service = Annotated[SchedulingService, Depends(get_scheduling_service)]

_ERRORS: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "Token ausente, inválido ou expirado"},
    403: {
        "model": ErrorResponse,
        "description": "Agenda desligada, papel ausente ou sem permissão",
    },
    404: {"model": ErrorResponse, "description": "Não encontrado"},
    503: {
        "model": ErrorResponse,
        "description": "Banco, Auth ou Google indisponível / não configurado",
    },
}
_WRITE = {
    **_ERRORS,
    409: {"model": ErrorResponse, "description": "Conflito"},
    422: {"model": ErrorResponse, "description": "Dados inválidos"},
}

# CurrentUser vem ANTES do serviço: sem token a resposta é 401 mesmo com o banco fora do ar.


@router.get("/v1/scheduling/status", response_model=SchedulingStatus, responses=_ERRORS)
def scheduling_status(user: CurrentUser, service: Service) -> SchedulingStatus:
    """O que está liberado nesta fase. Pagamentos e aulas comerciais: sempre desligados."""
    return service.status()


# ------------------------------------------------------------------ Google Agenda (professor)


@router.get("/v1/me/google-calendar", response_model=CalendarConnection, responses=_ERRORS)
def get_calendar(user: CurrentUser, service: Service) -> CalendarConnection:
    """Estado da conexão com o Google Agenda. Nunca devolve tokens."""
    return service.calendar(user)


@router.post(
    "/v1/me/google-calendar/authorization", response_model=AuthorizationStart, responses=_WRITE
)
def start_calendar_authorization(user: CurrentUser, service: Service) -> AuthorizationStart:
    """URL de consentimento do Google (escopo calendar.events.owned, PKCE, state cifrado)."""
    return service.start_authorization(user)


@router.post(
    "/v1/me/google-calendar/connection", response_model=CalendarConnection, responses=_WRITE
)
def complete_calendar_authorization(
    payload: AuthorizationComplete, user: CurrentUser, service: Service
) -> CalendarConnection:
    """Troca o código pelo refresh token (guardado cifrado só no servidor)."""
    return service.complete_authorization(user, payload.code, payload.state)


@router.delete("/v1/me/google-calendar", response_model=CalendarConnection, responses=_ERRORS)
def disconnect_calendar(user: CurrentUser, service: Service) -> CalendarConnection:
    """Revoga o acesso no Google e apaga a credencial."""
    return service.disconnect(user)


# ------------------------------------------------------------------ disponibilidade (professor)


@router.get("/v1/me/availability", response_model=AvailabilityOut, responses=_ERRORS)
def get_availability(user: CurrentUser, service: Service) -> AvailabilityOut:
    return service.get_availability(user)


@router.put("/v1/me/availability", response_model=AvailabilityOut, responses=_WRITE)
def put_availability(
    payload: AvailabilityIn, user: CurrentUser, service: Service
) -> AvailabilityOut:
    """Substitui as janelas semanais (horário de America/Sao_Paulo)."""
    return service.put_availability(user, payload)


# ------------------------------------------------------------------ reservas (aluno)


@router.get("/v1/teachers", response_model=list[BookableTeacher], responses=_ERRORS)
def list_teachers(user: CurrentUser, service: Service) -> list[BookableTeacher]:
    """Professores PUBLICADOS (aprovados) disponíveis para aula de teste."""
    return service.teachers(user)


@router.get("/v1/teachers/{teacher_id}/slots", response_model=SlotsOut, responses=_WRITE)
def list_slots(
    teacher_id: UUID,
    user: CurrentUser,
    service: Service,
    duration: Annotated[int, Query(ge=30, le=90)] = 60,
    days: Annotated[int, Query(ge=1, le=60)] = 14,
) -> SlotsOut:
    return service.slots(user, teacher_id, duration, days)


@router.post(
    "/v1/lessons",
    response_model=LessonOut,
    status_code=201,
    responses={**_WRITE, 200: {"model": LessonOut, "description": "Mesma reserva (idempotente)"}},
)
def book_lesson(
    payload: LessonCreate, response: Response, user: CurrentUser, service: Service
) -> LessonOut:
    """Reserva uma aula de TESTE (sem cobrança). Conflitos → 409; repetição → mesma aula (200)."""
    lesson, created = service.book(user, payload)
    response.status_code = 201 if created else 200
    return lesson


@router.get("/v1/me/lessons", response_model=list[LessonOut], responses=_ERRORS)
def my_lessons(user: CurrentUser, service: Service) -> list[LessonOut]:
    return service.lessons(user)


@router.post("/v1/lessons/{lesson_id}/cancel", response_model=LessonOut, responses=_WRITE)
def cancel_lesson(lesson_id: UUID, user: CurrentUser, service: Service) -> LessonOut:
    return service.cancel(user, lesson_id)


@router.post("/v1/lessons/{lesson_id}/calendar-sync", response_model=LessonOut, responses=_WRITE)
def resync_lesson(lesson_id: UUID, user: CurrentUser, service: Service) -> LessonOut:
    """Professor: tenta de novo criar o evento/Meet de uma aula com sincronização pendente."""
    return service.resync(user, lesson_id)
