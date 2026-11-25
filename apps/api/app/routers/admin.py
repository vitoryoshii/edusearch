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
