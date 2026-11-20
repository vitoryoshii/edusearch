"""Dependências reutilizáveis de autenticação e autorização.

* :func:`get_optional_user` — usuário do token, ou ``None`` sem cabeçalho ``Authorization``.
* :func:`require_user` — exige token válido (401 se ausente/inválido).
* :func:`get_user_roles` — papéis PERSISTIDOS no banco (``account_roles``), nunca do token.
* :func:`require_role` — fábrica de dependência: 403 se o papel não estiver persistido.
* :func:`ensure_owner` — 403 se o recurso não pertence ao usuário.
"""

from collections.abc import Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.jwt import AuthenticatedUser, TokenVerifier
from app.db import BaseDatabase
from app.errors import forbidden, missing_credentials, service_unavailable, unauthorized
from app.repositories.profiles import ProfileRepository

_bearer = HTTPBearer(auto_error=False, description="Access token do Supabase Auth (JWT).")


def get_token_verifier(request: Request) -> TokenVerifier:
    verifier: TokenVerifier | None = getattr(request.app.state, "token_verifier", None)
    if verifier is None:
        raise service_unavailable(
            "auth_not_configured", "Autenticação não configurada no servidor."
        )
    return verifier


def get_database(request: Request) -> BaseDatabase:
    database: BaseDatabase | None = getattr(request.app.state, "database", None)
    if database is None:
        raise service_unavailable(
            "database_unavailable", "Serviço temporariamente indisponível. Tente novamente."
        )
    return database


def get_optional_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    request: Request,
) -> AuthenticatedUser | None:
    if credentials is None:
        if request.headers.get("authorization"):
            # Cabeçalho presente mas fora do formato "Bearer <token>".
            raise unauthorized()
        return None
    return get_token_verifier(request).verify(credentials.credentials)


def require_user(
    user: Annotated[AuthenticatedUser | None, Depends(get_optional_user)],
) -> AuthenticatedUser:
    if user is None:
        raise missing_credentials()
    return user


CurrentUser = Annotated[AuthenticatedUser, Depends(require_user)]


def get_user_roles(
    user: CurrentUser, database: Annotated[BaseDatabase, Depends(get_database)]
) -> set[str]:
    with database.user_transaction(user) as conn:
        return set(ProfileRepository(conn).list_roles(user.id))


def require_role(role: str) -> Callable[..., AuthenticatedUser]:
    def _dependency(
        user: CurrentUser, roles: Annotated[set[str], Depends(get_user_roles)]
    ) -> AuthenticatedUser:
        if role not in roles:
            raise forbidden("role_required", "Sua conta não tem permissão para esta área.")
        return user

    return _dependency


def ensure_owner(user: AuthenticatedUser, owner_id: UUID | str) -> None:
    """Garante que o recurso pertence ao usuário. 403 caso contrário (sem revelar o dono)."""
    try:
        owner = owner_id if isinstance(owner_id, UUID) else UUID(str(owner_id))
    except ValueError as exc:
        raise forbidden() from exc
    if owner != user.id:
        raise forbidden()
