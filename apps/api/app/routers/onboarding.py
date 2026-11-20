from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.dependencies import CurrentUser
from app.schemas.common import ErrorResponse
from app.schemas.onboarding import (
    StudentProfileIn,
    StudentProfileOut,
    SubjectOut,
    TeacherProfileIn,
    TeacherProfileOut,
)
from app.services.onboarding import OnboardingService, get_onboarding_service

router = APIRouter(tags=["onboarding"])
Service = Annotated[OnboardingService, Depends(get_onboarding_service)]

_ERRORS: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "Token ausente, inválido ou expirado"},
    403: {"model": ErrorResponse, "description": "Papel não escolhido ou conta suspensa"},
    404: {"model": ErrorResponse, "description": "Cadastro ainda não salvo / perfil inexistente"},
    503: {"model": ErrorResponse, "description": "Banco ou Auth indisponível"},
}
_WRITE_ERRORS = {**_ERRORS, 422: {"model": ErrorResponse, "description": "Dados inválidos"}}

# CurrentUser vem ANTES do serviço: sem token a resposta é 401 mesmo com o banco fora do ar.


@router.get("/v1/me/student-profile", response_model=StudentProfileOut, responses=_ERRORS)
def get_student_profile(user: CurrentUser, service: Service) -> StudentProfileOut:
    """Cadastro de aluno do usuário autenticado (privado)."""
    return service.get_student(user)


@router.put("/v1/me/student-profile", response_model=StudentProfileOut, responses=_WRITE_ERRORS)
def put_student_profile(
    payload: StudentProfileIn, user: CurrentUser, service: Service
) -> StudentProfileOut:
    """Cria ou substitui o cadastro de aluno. Exige o papel student persistido."""
    return service.save_student(user, payload)


@router.get("/v1/me/teacher-profile", response_model=TeacherProfileOut, responses=_ERRORS)
def get_teacher_profile(user: CurrentUser, service: Service) -> TeacherProfileOut:
    """Cadastro profissional do usuário autenticado, com o estado de verificação."""
    return service.get_teacher(user)


@router.put("/v1/me/teacher-profile", response_model=TeacherProfileOut, responses=_WRITE_ERRORS)
def put_teacher_profile(
    payload: TeacherProfileIn, user: CurrentUser, service: Service
) -> TeacherProfileOut:
    """Cria ou substitui o cadastro profissional. Não aprova nem publica."""
    return service.save_teacher(user, payload)


@router.get(
    "/v1/subjects",
    response_model=list[SubjectOut],
    tags=["catálogo"],
    responses={503: {"model": ErrorResponse, "description": "Banco indisponível"}},
)
def list_subjects(service: Service) -> list[SubjectOut]:
    """Catálogo público de disciplinas ativas (sem autenticação)."""
    return service.list_subjects()
