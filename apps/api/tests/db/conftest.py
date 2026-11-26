"""Fixtures dos testes de banco (marcados com ``db``).

Exigem ``TEST_DATABASE_URL`` apontando para um banco DESCARTÁVEL. Nunca use o banco de produção.

* CI: banco local do Supabase CLI (``supabase db start``), com as migrations já aplicadas.
* Local sem Docker: um PostgreSQL vazio; se o schema ``auth`` não existir, aplica
  ``supabase_shim.sql`` e depois as migrations de ``supabase/migrations`` em ordem.

Cada teste cria usuários com UUID novo e os remove ao final (o cascade limpa o resto).
"""

import json
import os
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import psycopg
import pytest
from psycopg.rows import dict_row

REPO_ROOT = Path(__file__).resolve().parents[4]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
SHIM = Path(__file__).with_name("supabase_shim.sql")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

pytestmark = pytest.mark.db


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    for item in items:
        if "tests/db" in item.nodeid.replace("\\", "/"):
            item.add_marker(pytest.mark.db)
            if not TEST_DATABASE_URL:
                item.add_marker(pytest.mark.skip(reason="TEST_DATABASE_URL não definido"))


def migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def _prepare_schema(url: str) -> None:
    with psycopg.connect(url, autocommit=True) as conn:
        has_auth = conn.execute("select to_regnamespace('auth') is not null").fetchone()[0]
        has_profiles = conn.execute("select to_regclass('public.profiles') is not null").fetchone()[
            0
        ]
        if has_profiles:
            return
        if not has_auth:
            conn.execute(SHIM.read_text(encoding="utf-8"))
        for path in migration_files():
            conn.execute(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def database_url() -> str:
    assert TEST_DATABASE_URL
    _prepare_schema(TEST_DATABASE_URL)
    return TEST_DATABASE_URL


# Senha SOMENTE para o banco descartável de testes (local/CI). Nunca usada no remoto.
API_ROLE_TEST_PASSWORD = "edusearch-api-test-only"


@pytest.fixture(scope="session")
def api_database_url(database_url: str) -> str:
    """Conexão como edusearch_api (papel de menor privilégio da API), com login de teste."""
    from psycopg import sql
    from psycopg.conninfo import conninfo_to_dict, make_conninfo

    with psycopg.connect(database_url, autocommit=True) as conn:
        conn.execute(
            sql.SQL("alter role edusearch_api with login password {}").format(
                sql.Literal(API_ROLE_TEST_PASSWORD)
            )
        )
    params = conninfo_to_dict(database_url)
    params.update(user="edusearch_api", password=API_ROLE_TEST_PASSWORD)
    return make_conninfo(**params)


@pytest.fixture
def admin(database_url: str) -> Iterator[psycopg.Connection]:
    """Conexão do dono do schema (papel de migration / servidor), em autocommit."""
    with psycopg.connect(database_url, autocommit=True, row_factory=dict_row) as conn:
        yield conn


class Users:
    """Cria usuários fictícios em auth.users e remove tudo no final."""

    def __init__(self, admin: psycopg.Connection) -> None:
        self._admin = admin
        self.created: list[uuid.UUID] = []

    def create(
        self, name: str = "Pessoa Fictícia", *, email_confirmed: bool = False, **meta: Any
    ) -> uuid.UUID:
        uid = uuid.uuid4()
        email = f"teste+{uid.hex[:12]}@example.com"
        metadata = {"full_name": name, **meta}
        self._admin.execute(
            "insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data) "
            "values (%s, 'authenticated', 'authenticated', %s, "
            "case when %s then now() else null end, %s)",
            (uid, email, email_confirmed, json.dumps(metadata)),
        )
        self.created.append(uid)
        return uid

    def grant_role(self, uid: uuid.UUID, role: str) -> None:
        self._admin.execute(
            "insert into public.account_roles (user_id, role) values (%s, %s)", (uid, role)
        )

    def cleanup(self) -> None:
        if self.created:
            # Tabelas privadas de auditoria/outbox usam FKs RESTRICT para preservar
            # histórico operacional em produção. Nos testes descartáveis, limpe só
            # os registros ligados aos usuários efêmeros antes do cascade de auth.
            self._admin.execute(
                "delete from private.admin_audit_log where actor_id = any(%s) or resource_id = any(%s)",
                (self.created, self.created),
            )
            self._admin.execute(
                "delete from private.notification_outbox where recipient_user_id = any(%s)",
                (self.created,),
            )
            # Trust Engine e auditoria do credenciamento também usam RESTRICT.
            self._admin.execute(
                "delete from private.teacher_verification_evidence where job_id in ("
                "select id from private.teacher_verification_jobs where teacher_id = any(%s))",
                (self.created,),
            )
            self._admin.execute(
                "delete from private.teacher_verification_contestations where teacher_id = any(%s)",
                (self.created,),
            )
            for table in (
                "private.teacher_credential_legacy_review",
                "private.teacher_verification_decisions",
                "private.teacher_verification_jobs",
                "private.teacher_verification_audit_log",
            ):
                self._admin.execute(
                    f"delete from {table} where teacher_id = any(%s)",  # noqa: S608
                    (self.created,),
                )
            self._admin.execute("delete from auth.users where id = any(%s)", (self.created,))


def credential_approved(admin: psycopg.Connection, teacher_id: uuid.UUID) -> None:
    """FIXTURE DE TESTE: registra um credenciamento aprovado direto no banco descartável.

    Em produção, somente o Trust Engine (com evidências suficientes) chega a este estado.
    """
    admin.execute(
        "insert into private.teacher_verifications (teacher_id, status, qualification_kind, "
        "birth_date, institution, qualification, terms_version, terms_accepted_at, submitted_at, "
        "reviewed_at) values (%s, 'approved', 'graduated', '1990-01-01', 'Instituição de teste', "
        "'Licenciatura de teste', 'teacher-terms-2026-11', now(), now(), now()) "
        "on conflict (teacher_id) do update set status = 'approved', "
        "submitted_at = coalesce(private.teacher_verifications.submitted_at, now())",
        (teacher_id,),
    )


@pytest.fixture
def users(admin: psycopg.Connection) -> Iterator[Users]:
    u = Users(admin)
    yield u
    u.cleanup()


class Session:
    """Executa SQL como um papel da Data API (anon/authenticated), sempre com ROLLBACK."""

    def __init__(self, url: str, role: str, uid: uuid.UUID | None) -> None:
        self._url = url
        self._role = role
        self._claims = {"role": role}
        if uid is not None:
            self._claims.update(sub=str(uid), aud="authenticated")

    def _run(self, query: str, params: Any = None, *, fetch: bool) -> Any:
        with psycopg.connect(self._url, row_factory=dict_row) as conn:
            try:
                conn.execute(f"set local role {self._role}")
                conn.execute(
                    "select set_config('request.jwt.claims', %s, true)", (json.dumps(self._claims),)
                )
                cur = conn.execute(query, params)
                if fetch:
                    return cur.fetchall()
                return cur.rowcount
            finally:
                conn.rollback()

    def rows(self, query: str, params: Any = None) -> list[dict[str, Any]]:
        return self._run(query, params, fetch=True)

    def execute(self, query: str, params: Any = None) -> int:
        return self._run(query, params, fetch=False)


@pytest.fixture
def as_user(database_url: str):
    def _make(uid: uuid.UUID) -> Session:
        return Session(database_url, "authenticated", uid)

    return _make


@pytest.fixture
def anon(database_url: str) -> Session:
    return Session(database_url, "anon", None)


class Committing:
    """Como Session, mas COMMITA (para preparar dados pelo próprio usuário)."""

    def __init__(self, url: str, uid: uuid.UUID) -> None:
        self._url = url
        self._claims = json.dumps({"role": "authenticated", "sub": str(uid)})

    def execute(self, query: str, params: Any = None) -> int:
        with psycopg.connect(self._url) as conn:
            conn.execute("set local role authenticated")
            conn.execute("select set_config('request.jwt.claims', %s, true)", (self._claims,))
            return conn.execute(query, params).rowcount


@pytest.fixture
def commit_as(database_url: str):
    return lambda uid: Committing(database_url, uid)
