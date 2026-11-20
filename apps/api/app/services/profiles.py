"""Regras do perfil do próprio usuário (``/v1/me``)."""

from typing import Annotated, Protocol

from fastapi import Depends, Request

from app.auth.dependencies import get_database
from app.auth.jwt import AuthenticatedUser
from app.db import Database
from app.errors import ApiError, forbidden, not_found
from app.repositories.profiles import ProfileRepository, ProfileRow
from app.schemas.me import MeResponse, ProfileUpdate, avatar_host_allowed


class ProfileService(Protocol):
    def get_me(self, user: AuthenticatedUser) -> MeResponse: ...

    def update_profile(self, user: AuthenticatedUser, data: ProfileUpdate) -> MeResponse: ...


def _profile_not_found() -> ApiError:
    return not_found("profile_not_found", "Perfil não encontrado para esta conta.")


def _to_me(user: AuthenticatedUser, profile: ProfileRow, roles: list[str]) -> MeResponse:
    return MeResponse(
        id=profile.id,
        email=user.email,
        display_name=profile.display_name,
        avatar_url=profile.avatar_url,
        status=profile.status,  # type: ignore[arg-type]
        roles=roles,  # type: ignore[arg-type]
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


class DbProfileService:
    def __init__(self, database: Database, avatar_host_suffixes: list[str]) -> None:
        self._db = database
        self._avatar_hosts = avatar_host_suffixes

    def get_me(self, user: AuthenticatedUser) -> MeResponse:
        with self._db.user_transaction(user) as conn:
            repo = ProfileRepository(conn)
            profile = repo.get_profile(user.id)
            if profile is None:
                raise _profile_not_found()
            return _to_me(user, profile, repo.list_roles(user.id))

    def update_profile(self, user: AuthenticatedUser, data: ProfileUpdate) -> MeResponse:
        avatar = data.avatar_url
        if avatar is not None and not avatar_host_allowed(avatar, self._avatar_hosts):
            raise ApiError(422, "avatar_host_not_allowed", "Origem da foto não permitida.")

        with self._db.user_transaction(user) as conn:
            repo = ProfileRepository(conn)
            current = repo.get_profile(user.id)
            if current is None:
                raise _profile_not_found()
            if current.status == "suspended":
                raise forbidden("account_suspended", "Sua conta está suspensa.")
            updated = repo.update_profile(
                user.id, display_name=data.display_name, avatar_url=data.avatar_url
            )
            if updated is None:
                raise _profile_not_found()
            return _to_me(user, updated, repo.list_roles(user.id))


def get_profile_service(
    request: Request, database: Annotated[Database, Depends(get_database)]
) -> ProfileService:
    return DbProfileService(database, request.app.state.settings.avatar_host_suffix_list)
