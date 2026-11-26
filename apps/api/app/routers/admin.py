"""API administrativa. Dados e permissões vêm exclusivamente do backend."""

from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app.auth.dependencies import CurrentUser
from app.schemas.common import ErrorResponse
from app.services.admin import AdminService, get_admin_service

router = APIRouter(prefix="/v1/admin", tags=["admin"])
Service = Annotated[AdminService, Depends(get_admin_service)]
_ERRORS = {
    401: {"model": ErrorResponse},
    403: {"model": ErrorResponse},
    404: {"model": ErrorResponse},
}


class TeacherAction(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    justification: str = Field(min_length=3, max_length=500)


@router.get("/me", responses=_ERRORS)
def me(user: CurrentUser, service: Service) -> dict:
    return service.me(user)


@router.get("/dashboard", responses=_ERRORS)
def dashboard(
    user: CurrentUser, service: Service, days: Annotated[int, Query(ge=1, le=365)] = 30
) -> dict:
    return service.dashboard(user, days)


@router.get("/teachers", responses=_ERRORS)
def teachers(
    user: CurrentUser,
    service: Service,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    status: Literal["pending", "approved", "rejected"] | None = None,
) -> dict:
    return service.teachers(user, limit, offset, status)


@router.post(
    "/teachers/{teacher_id}/{action}", responses={**_ERRORS, 422: {"model": ErrorResponse}}
)
def teacher_action(
    teacher_id: UUID,
    action: Literal["approve", "reject", "suspend", "reactivate"],
    payload: TeacherAction,
    user: CurrentUser,
    service: Service,
) -> dict:
    return service.teacher_transition(user, teacher_id, action, payload.justification)


def _list(
    kind: str, user: CurrentUser, service: Service, limit: int, offset: int, query: str | None
) -> dict:
    return service.operational_list(user, kind, limit, offset, query)


@router.get("/students", responses=_ERRORS)
def students(
    user: CurrentUser,
    service: Service,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: str | None = Query(default=None, max_length=80),
) -> dict:
    return _list("students", user, service, limit, offset, q)


@router.get("/lessons", responses=_ERRORS)
def lessons(
    user: CurrentUser,
    service: Service,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    return _list("lessons", user, service, limit, offset, None)


@router.get("/payments", responses=_ERRORS)
def payments(
    user: CurrentUser,
    service: Service,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    return _list("payments", user, service, limit, offset, None)


@router.get("/payout-accounts", responses=_ERRORS)
def payout_accounts(
    user: CurrentUser,
    service: Service,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    return _list("payout-accounts", user, service, limit, offset, None)


@router.get("/notifications", responses=_ERRORS)
def notifications(
    user: CurrentUser,
    service: Service,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    return _list("notifications", user, service, limit, offset, None)


@router.get("/audit", responses=_ERRORS)
def audit(
    user: CurrentUser,
    service: Service,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    return _list("audit", user, service, limit, offset, None)


@router.get("/administrators", responses=_ERRORS)
def administrators(
    user: CurrentUser,
    service: Service,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    return _list("administrators", user, service, limit, offset, None)


class TrustResolution(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    # Aprovar não é uma resolução humana: somente o Trust Engine aprova.
    resolution: Literal["reprocess", "request_changes", "reject", "uphold"]
    justification: str = Field(min_length=3, max_length=500)


@router.get("/trust", responses=_ERRORS)
def trust_overview(user: CurrentUser, service: Service) -> dict:
    return service.trust_overview(user)


@router.get("/trust/teachers/{teacher_id}", responses=_ERRORS)
def trust_teacher(teacher_id: UUID, user: CurrentUser, service: Service) -> dict:
    return service.trust_teacher(user, teacher_id)


@router.post(
    "/trust/contestations/{contestation_id}/resolve",
    responses={**_ERRORS, 422: {"model": ErrorResponse}},
)
def trust_resolve(
    contestation_id: UUID, payload: TrustResolution, user: CurrentUser, service: Service
) -> dict:
    return service.trust_resolve_contestation(
        user, contestation_id, payload.resolution, payload.justification
    )


@router.post(
    "/trust/teachers/{teacher_id}/reprocess",
    responses={**_ERRORS, 422: {"model": ErrorResponse}},
)
def trust_reprocess(
    teacher_id: UUID, payload: TeacherAction, user: CurrentUser, service: Service
) -> dict:
    return service.trust_reprocess(user, teacher_id, payload.justification)
