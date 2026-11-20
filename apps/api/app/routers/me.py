from typing import Annotated

from fastapi import APIRouter, Depends, Response

from app.auth.dependencies import CurrentUser
from app.schemas.common import ErrorResponse
from app.schemas.me import MeResponse, ProfileUpdate, RoleSelection
from app.services.onboarding import OnboardingService, get_onboarding_service
from app.services.profiles import ProfileService, get_profile_service

router = APIRouter(prefix="/v1/me", tags=["me"])

_AUTH_ERRORS: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse, "description": "Token ausente, inválido ou expirado"},
    403: {"model": ErrorResponse, "description": "Acesso não autorizado"},
    404: {"model": ErrorResponse, "description": "Perfil não encontrado"},
    503: {"model": ErrorResponse, "description": "Banco ou Auth indisponível"},
}

# CurrentUser vem ANTES do serviço: sem token a resposta é 401 mesmo com o banco fora do ar.


@router.get("", response_model=MeResponse, responses=_AUTH_ERRORS)
def get_me(
    user: CurrentUser,
    service: Annotated[ProfileService, Depends(get_profile_service)],
) -> MeResponse:
    """Perfil do usuário autenticado (somente os dados dele)."""
    return service.get_me(user)


@router.put(
    "/profile",
    response_model=MeResponse,
    responses={**_AUTH_ERRORS, 422: {"model": ErrorResponse, "description": "Dados inválidos"}},
)
def put_my_profile(
    payload: ProfileUpdate,
    user: CurrentUser,
    service: Annotated[ProfileService, Depends(get_profile_service)],
) -> MeResponse:
    """Atualiza nome e foto. IDs, papéis, status e aprovação são definidos só pelo servidor."""
    return service.update_profile(user, payload)


@router.post(
    "/roles",
    response_model=MeResponse,
    status_code=201,
    responses={
        200: {"model": MeResponse, "description": "Papel já existia (idempotente)"},
        **_AUTH_ERRORS,
        422: {"model": ErrorResponse, "description": "Papel inválido"},
    },
)
def post_my_role(
    payload: RoleSelection,
    response: Response,
    user: CurrentUser,
    service: Annotated[OnboardingService, Depends(get_onboarding_service)],
) -> MeResponse:
    """Escolhe aprender (student) ou ensinar (teacher). Idempotente; nunca concede admin."""
    me, created = service.select_role(user, payload.role)
    response.status_code = 201 if created else 200
    return me
