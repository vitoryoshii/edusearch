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
    TeacherVerificationDocumentIn,
    TeacherVerificationDocumentOut,
    TeacherVerificationIn,
    TeacherVerificationOut,
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
    def get_teacher_verification(self, user: AuthenticatedUser) -> TeacherVerificationOut: ...
    def save_teacher_verification(
        self, user: AuthenticatedUser, data: TeacherVerificationIn
    ) -> TeacherVerificationOut: ...
    def register_teacher_verification_document(
        self, user: AuthenticatedUser, data: TeacherVerificationDocumentIn
    ) -> TeacherVerificationDocumentOut: ...
    def submit_teacher_verification(self, user: AuthenticatedUser) -> TeacherVerificationOut: ...
    def list_subjects(self) -> list[SubjectOut]: ...


def _role_required(role: Role) -> ApiError:
    label = "aluno" if role == "student" else "professor"
    return forbidden("role_required", f"Escolha o perfil de {label} antes de continuar.")


def _unknown_subjects(exc: UnknownSubjectsError) -> ApiError:
    return ApiError(422, "unknown_subject", f"Disciplina inválida: {', '.join(exc.slugs)}.")


def _verification_error(exc: psycopg.Error) -> ApiError:
    """Mapeia somente regras de domínio deliberadas; integridade inesperada continua falhando."""
    message = str(getattr(exc, "diag", None).message_primary or "")
    codes = {
        "teacher_must_be_adult": (
            422,
            "teacher_must_be_adult",
            "É necessário ter 18 anos ou mais.",
        ),
        "invalid_financial_identity": (
            422,
            "invalid_financial_identity",
            "Documento financeiro inválido.",
        ),
        "invalid_document_path": (422, "invalid_document_path", "Caminho de documento inválido."),
        "invalid_document_content_type": (
            422,
            "invalid_document_content_type",
            "Tipo de arquivo não permitido.",
        ),
        "invalid_document_size": (
            422,
            "invalid_document_size",
            "O arquivo excede o limite permitido.",
        ),
        "document_not_owned": (403, "document_not_owned", "O documento não pertence à sua conta."),
        "document_already_registered": (
            409,
            "document_already_registered",
            "Documento já registrado.",
        ),
        "verification_locked_for_review": (
            409,
            "verification_locked_for_review",
            "Dossiê em análise.",
        ),
        "verification_dossier_required": (
            422,
            "verification_dossier_required",
            "Preencha o dossiê antes de enviar.",
        ),
        "verification_documents_required": (
            422,
            "verification_documents_required",
            "Envie identidade e comprovação acadêmica.",
        ),
        "verification_not_submittable": (
            409,
            "verification_not_submittable",
            "Dossiê não pode ser enviado neste estado.",
        ),
    }
    if message in codes:
        status, code, detail = codes[message]
        return ApiError(status, code, detail)
    raise exc


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
            display_name = load_profile(conn, user).display_name
            repo = OnboardingRepository(conn)
            try:
                repo.upsert_student(user.id, data)
            except UnknownSubjectsError as exc:
                raise _unknown_subjects(exc) from exc
            row = repo.get_student(user.id)
            if row is None:  # pragma: no cover — acabou de ser gravado na mesma transação
                raise not_found("student_profile_not_found", "Cadastro de aluno ainda não salvo.")
            # A chave estável torna o reenvio do PUT idempotente. A função privada resolve
            # exclusivamente o e-mail confirmado em auth.users; nenhum e-mail chega do cliente.
            with as_connection_role(conn):
                conn.execute(
                    "select private.notification_enqueue_for_user(%s, null, %s, %s, "
                    "jsonb_build_object('NOME', %s::text), %s)",
                    (
                        "onboarding.student_completed",
                        user.id,
                        "edusearch-boas-vindas-aluno-v1",
                        display_name,
                        f"welcome/student/{user.id}",
                    ),
                )
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
            display_name = load_profile(conn, user).display_name
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
            with as_connection_role(conn):
                conn.execute(
                    "select private.notification_enqueue_for_user(%s, null, %s, %s, "
                    "jsonb_build_object('NOME', %s::text), %s)",
                    (
                        "onboarding.teacher_completed",
                        user.id,
                        "edusearch-boas-vindas-professor-v1",
                        display_name,
                        f"welcome/teacher/{user.id}",
                    ),
                )
            return TeacherProfileOut(**row)

    # --------------------------------------------------------------- credenciamento

    def _teacher_verification_row(self, repo: OnboardingRepository) -> TeacherVerificationOut:
        row = repo.teacher_verification()
        if row is None:
            raise not_found(
                "teacher_verification_not_found", "Dossiê de credenciamento ainda não iniciado."
            )
        row["documents"] = [TeacherVerificationDocumentOut(**item) for item in row["documents"]]
        return TeacherVerificationOut(**row)

    def get_teacher_verification(self, user: AuthenticatedUser) -> TeacherVerificationOut:
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "teacher")
            with as_connection_role(conn):
                return self._teacher_verification_row(OnboardingRepository(conn))

    def save_teacher_verification(
        self, user: AuthenticatedUser, data: TeacherVerificationIn
    ) -> TeacherVerificationOut:
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "teacher", write=True)
            with as_connection_role(conn):
                repo = OnboardingRepository(conn)
                try:
                    repo.upsert_teacher_verification(data)
                except psycopg.Error as exc:
                    raise _verification_error(exc) from exc
                return self._teacher_verification_row(repo)

    def register_teacher_verification_document(
        self, user: AuthenticatedUser, data: TeacherVerificationDocumentIn
    ) -> TeacherVerificationDocumentOut:
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "teacher", write=True)
            with as_connection_role(conn):
                try:
                    row = OnboardingRepository(conn).register_teacher_verification_document(data)
                except psycopg.Error as exc:
                    raise _verification_error(exc) from exc
                return TeacherVerificationDocumentOut(**row)

    def submit_teacher_verification(self, user: AuthenticatedUser) -> TeacherVerificationOut:
        with self._db.user_transaction(user) as conn:
            self._guard(conn, user, "teacher", write=True)
            with as_connection_role(conn):
                repo = OnboardingRepository(conn)
                try:
                    repo.submit_teacher_verification()
                except psycopg.Error as exc:
                    raise _verification_error(exc) from exc
                return self._teacher_verification_row(repo)

    # ------------------------------------------------------------------ catálogo

    def list_subjects(self) -> list[SubjectOut]:
        with self._db.anon_transaction() as conn:
            return [SubjectOut(**r) for r in OnboardingRepository(conn).list_subjects()]


def get_onboarding_service(
    database: Annotated[BaseDatabase, Depends(get_database)],
) -> OnboardingService:
    return DbOnboardingService(database)
