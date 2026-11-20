"""Regras do perfil do próprio usuário (``/v1/me`` e ``/v1/me/profile``)."""

from typing import Annotated, Protocol

import psycopg
from fastapi import Depends, Request

from app.auth.dependencies import get_database
from app.auth.jwt import AuthenticatedUser
from app.db import BaseDatabase
from app.errors import ApiError, forbidden, not_found
from app.repositories.onboarding import OnboardingRepository
from app.repositories.profiles import ProfileRepository, ProfileRow
from app.schemas.me import (
    MeResponse,
    OnboardingState,
    ProfileUpdate,
    StudentOnboarding,
    TeacherOnboarding,
    avatar_host_allowed,
)


class ProfileService(Protocol):
    def get_me(self, user: AuthenticatedUser) -> MeResponse: ...

    def update_profile(self, user: AuthenticatedUser, data: ProfileUpdate) -> MeResponse: ...


def profile_not_found() -> ApiError:
    return not_found("profile_not_found", "Perfil não encontrado para esta conta.")


def account_suspended() -> ApiError:
    return forbidden("account_suspended", "Sua conta está suspensa.")


def load_profile(conn: psycopg.Connection, user: AuthenticatedUser) -> ProfileRow:
    profile = ProfileRepository(conn).get_profile(user.id)
    if profile is None:
        raise profile_not_found()
    return profile


def build_me(
    conn: psycopg.Connection, user: AuthenticatedUser, profile: ProfileRow | None = None
) -> MeResponse:
    """Monta o MeResponse dentro da transação do usuário (RLS ativo)."""
    profile = profile or load_profile(conn, user)
    roles = ProfileRepository(conn).list_roles(user.id)
    state = OnboardingRepository(conn).onboarding_state(user.id)
    onboarding = OnboardingState(
        student=(
            StudentOnboarding(status="completed" if state["student"] else "pending")
            if "student" in roles
            else None
        ),
        teacher=(
            TeacherOnboarding(
                status="completed" if state["teacher_verification"] else "pending",
                verification_status=state["teacher_verification"],
                is_published=bool(state["teacher_published"]),
            )
            if "teacher" in roles
            else None
        ),
    )
    return MeResponse(
        id=profile.id,
        email=user.email,
        display_name=profile.display_name,
        avatar_url=profile.avatar_url,
        status=profile.status,  # type: ignore[arg-type]
        roles=roles,  # type: ignore[arg-type]
        onboarding=onboarding,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


class DbProfileService:
    def __init__(self, database: BaseDatabase, avatar_host_suffixes: list[str]) -> None:
        self._db = database
        self._avatar_hosts = avatar_host_suffixes

    def get_me(self, user: AuthenticatedUser) -> MeResponse:
        with self._db.user_transaction(user) as conn:
            return build_me(conn, user)

    def update_profile(self, user: AuthenticatedUser, data: ProfileUpdate) -> MeResponse:
        avatar = data.avatar_url
        if avatar is not None and not avatar_host_allowed(avatar, self._avatar_hosts):
            raise ApiError(422, "avatar_host_not_allowed", "Origem da foto não permitida.")

        with self._db.user_transaction(user) as conn:
            current = load_profile(conn, user)
            if current.status == "suspended":
                raise account_suspended()
            updated = ProfileRepository(conn).update_profile(
                user.id, display_name=data.display_name, avatar_url=data.avatar_url
            )
            if updated is None:
                raise profile_not_found()
            return build_me(conn, user, updated)


def get_profile_service(
    request: Request, database: Annotated[BaseDatabase, Depends(get_database)]
) -> ProfileService:
    return DbProfileService(database, request.app.state.settings.avatar_host_suffix_list)
