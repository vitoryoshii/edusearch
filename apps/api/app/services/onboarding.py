"""Regras do onboarding: papel, perfis de aluno/professor e catálogo de disciplinas."""

from typing import Annotated, Literal, Protocol

import psycopg
from fastapi import Depends

from app.auth.dependencies import get_database
from app.auth.jwt import AuthenticatedUser
from app.db import BaseDatabase, as_connection_role
from app.errors import ApiError, forbidden, not_found
from app.repositories.onboarding import OnboardingRepository, UnknownSubjectsError
from app.repositories.profiles import ProfileRepository
from app.schemas.me import MeResponse
from app.schemas.onboarding import (
    StudentProfileIn,
    StudentProfileOut,
    SubjectOut,
    TeacherProfileIn,
    TeacherProfileOut,
)
from app.services.profiles import account_suspended, build_me, load_profile

Role = Literal["student", "teacher"]


class OnboardingService(Protocol):
    def select_role(self, user: AuthenticatedUser, role: Role) -> tuple[MeResponse, bool]: ...

    # ------------------------------------------------------------------ aluno

    def get_student(self, user: AuthenticatedUser) -> StudentProfileOut: ...
    def save_student(
        self, user: AuthenticatedUser, data: StudentProfileIn
    ) -> StudentProfileOut: ...
    def get_teacher(self, user: AuthenticatedUser) -> TeacherProfileOut: ...
    def save_teacher(
        self, user: AuthenticatedUser, data: TeacherProfileIn
    ) -> TeacherProfileOut: ...
    def list_subjects(self) -> list[SubjectOut]: ...


def _role_required(role: Role) -> ApiError:
    label = "aluno" if role == "student" else "professor"
    return forbidden("role_required", f"Escolha o perfil de {label} antes de continuar.")


def _unknown_subjects(exc: UnknownSubjectsError) -> ApiError:
    return ApiError(422, "unknown_subject", f"Disciplina inválida: {', '.join(exc.slugs)}.")


class DbOnboardingService:
    def __init__(self, database: BaseDatabase) -> None:
        self._db = database

    # ------------------------------------------------------------------ papel

    def select_role(self, user: AuthenticatedUser, role: Role) -> tuple[MeResponse, bool]:
        """Idempotente. Devolve (me, criado_agora)."""
        with self._db.user_transaction(user) as conn:
            profile = load_profile(conn, user)
            if profile.status == "suspended":
                raise account_suspended()
            if role in ProfileRepository(conn).list_roles(user.id):
                return build_me(conn, user, profile), False
            # Única escrita como papel de conexão (edusearch_api): RLS limita ao "sub" do JWT.
            with as_connection_role(conn):
                OnboardingRepository(conn).insert_role(user.id, role)
            return build_me(conn, user, profile), True

    def _guard(
        self, conn: psycopg.Connection, user: AuthenticatedUser, role: Role, *, write: bool = False
    ) -> None:
        profile = load_profile(conn, user)
        if role not in ProfileRepository(conn).list_roles(user.id):
            raise _role_required(role)
        if write and profile.status == "suspended":
            raise account_suspended()

    # ------------------------------------------------------------------ aluno

    def get_student(self, user: AuthenticatedUser) -> StudentProfileOut:
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "student")
            row = OnboardingRepository(conn).get_student(user.id)
            if row is None:
                raise not_found("student_profile_not_found", "Cadastro de aluno ainda não salvo.")
            return StudentProfileOut(**row)

    def save_student(self, user: AuthenticatedUser, data: StudentProfileIn) -> StudentProfileOut:
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "student", write=True)
            repo = OnboardingRepository(conn)
            try:
                repo.upsert_student(user.id, data)
            except UnknownSubjectsError as exc:
                raise _unknown_subjects(exc) from exc
            row = repo.get_student(user.id)
            if row is None:  # pragma: no cover — acabou de ser gravado na mesma transação
                raise not_found("student_profile_not_found", "Cadastro de aluno ainda não salvo.")
            return StudentProfileOut(**row)

    # ------------------------------------------------------------------ professor

    def get_teacher(self, user: AuthenticatedUser) -> TeacherProfileOut:
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "teacher")
            row = OnboardingRepository(conn).get_teacher(user.id)
            if row is None:
                raise not_found(
                    "teacher_profile_not_found", "Cadastro de professor ainda não salvo."
                )
            return TeacherProfileOut(**row)

    def save_teacher(self, user: AuthenticatedUser, data: TeacherProfileIn) -> TeacherProfileOut:
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "teacher", write=True)
            repo = OnboardingRepository(conn)
            try:
                repo.upsert_teacher(user.id, data)
            except UnknownSubjectsError as exc:
                raise _unknown_subjects(exc) from exc
            row = repo.get_teacher(user.id)
            if row is None:  # pragma: no cover
                raise not_found(
                    "teacher_profile_not_found", "Cadastro de professor ainda não salvo."
                )
            return TeacherProfileOut(**row)

    # ------------------------------------------------------------------ catálogo

    def list_subjects(self) -> list[SubjectOut]:
        with self._db.anon_transaction() as conn:
            return [SubjectOut(**r) for r in OnboardingRepository(conn).list_subjects()]


def get_onboarding_service(
    database: Annotated[BaseDatabase, Depends(get_database)],
) -> OnboardingService:
    return DbOnboardingService(database)
