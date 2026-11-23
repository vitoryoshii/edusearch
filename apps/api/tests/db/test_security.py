"""Hook de admissão, endurecimento de rls_auto_enable e verificações no estilo do Security Advisor."""

import json
import uuid

import psycopg
import pytest

from tests.db.conftest import MIGRATIONS_DIR

APP_TABLES = [
    "profiles",
    "account_roles",
    "subjects",
    "student_profiles",
    "teacher_profiles",
    "teacher_subjects",
    "student_subjects",
    "teacher_availability",
    "lessons",
    "payment_intents",
    "payment_splits",
    "teacher_payout_accounts",
    "withdrawal_requests",
    "refund_requests",
]


# ------------------------------------------------------------------------------- hook


def _hook(admin: psycopg.Connection, email: str | None) -> dict:
    event = {
        "metadata": {"name": "before-user-created", "uuid": "0", "time": "", "ip_address": ""},
        "user": {"email": email, "app_metadata": {"provider": "google"}, "user_metadata": {}},
    }
    row = admin.execute(
        "select public.hook_before_user_created(%s::jsonb) as r", (json.dumps(event),)
    ).fetchone()
    return row["r"]


def test_hook_allows_only_allowlisted_emails(admin) -> None:
    email = "testador.ficticio@example.com"
    admin.execute("insert into private.signup_allowlist (email) values (%s)", (email,))
    try:
        assert _hook(admin, email) == {}
        assert _hook(admin, "  TESTADOR.Ficticio@Example.com ") == {}
        denied = _hook(admin, "intruso@example.com")
        assert denied["error"]["http_code"] == 403
        assert _hook(admin, None)["error"]["http_code"] == 403
        assert _hook(admin, "")["error"]["http_code"] == 403
    finally:
        admin.execute("delete from private.signup_allowlist where email = %s", (email,))


def test_allowlist_requires_normalized_email(admin) -> None:
    with pytest.raises(psycopg.errors.CheckViolation):
        admin.execute(
            "insert into private.signup_allowlist (email) values ('Maiuscula@Example.com')"
        )


def test_hook_execute_privileges(admin) -> None:
    fn = "public.hook_before_user_created(jsonb)"
    can = admin.execute(
        "select has_function_privilege('supabase_auth_admin', %s, 'execute') as auth_admin,"
        "       has_function_privilege('anon', %s, 'execute') as anon,"
        "       has_function_privilege('authenticated', %s, 'execute') as authenticated",
        (fn, fn, fn),
    ).fetchone()
    assert can == {"auth_admin": True, "anon": False, "authenticated": False}


def test_auth_admin_has_no_direct_access_to_allowlist(admin) -> None:
    row = admin.execute(
        "select has_table_privilege('supabase_auth_admin', 'private.signup_allowlist', 'select') as t"
    ).fetchone()
    assert row["t"] is False


# ------------------------------------------------------------------------------- rls_auto_enable


def test_rls_auto_enable_hardening_migration(database_url) -> None:
    """Simula a função remota (com EXECUTE aberto) e aplica a migration de endurecimento."""
    migration = next(MIGRATIONS_DIR.glob("*_harden_rls_auto_enable.sql")).read_text("utf-8")
    with psycopg.connect(database_url) as conn:
        try:
            exists = conn.execute("select to_regprocedure('public.rls_auto_enable()')").fetchone()[
                0
            ]
            if exists is None:
                conn.execute(
                    """
                    create function public.rls_auto_enable() returns event_trigger
                    language plpgsql security definer as $$
                    declare r record;
                    begin
                      for r in select * from pg_event_trigger_ddl_commands()
                               where command_tag = 'CREATE TABLE' and object_type = 'table' loop
                        execute format('alter table %s enable row level security', r.object_identity);
                      end loop;
                    end $$;
                    grant execute on function public.rls_auto_enable() to public, anon, authenticated;
                    """
                )
            conn.execute(migration)
            conn.execute(migration)  # idempotente
            row = conn.execute(
                """
                select has_function_privilege('anon', p.oid, 'execute') as anon,
                       has_function_privilege('authenticated', p.oid, 'execute') as authn,
                       p.proconfig
                  from pg_proc p where p.oid = 'public.rls_auto_enable()'::regprocedure
                """
            ).fetchone()
            assert row[0] is False
            assert row[1] is False
            assert any(c.startswith("search_path=") for c in row[2] or [])
        finally:
            conn.rollback()


# ------------------------------------------------------------------------------- "advisor"


@pytest.mark.parametrize("table", APP_TABLES)
def test_rls_enabled_on_app_tables(admin, table) -> None:
    row = admin.execute(
        "select relrowsecurity from pg_class where oid = %s::regclass", (f"public.{table}",)
    ).fetchone()
    assert row["relrowsecurity"] is True


def test_every_public_table_has_rls(admin) -> None:
    rows = admin.execute(
        "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace "
        "where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity"
    ).fetchall()
    assert rows == []


def test_no_policy_uses_user_metadata(admin) -> None:
    rows = admin.execute(
        "select policyname from pg_policies "
        "where coalesce(qual, '') || coalesce(with_check, '') ~* '(user_metadata|raw_user_meta_data)'"
    ).fetchall()
    assert rows == []


def test_no_security_definer_callable_by_api_roles(admin) -> None:
    rows = admin.execute(
        """
        select p.oid::regprocedure::text as fn
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private') and p.prosecdef
           and (has_function_privilege('anon', p.oid, 'execute')
                or has_function_privilege('authenticated', p.oid, 'execute'))
        """
    ).fetchall()
    assert rows == []


def test_app_functions_have_fixed_search_path(admin) -> None:
    rows = admin.execute(
        """
        select p.oid::regprocedure::text as fn
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private')
           and p.prokind = 'f'
           and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                            where c like 'search_path=%%')
        """
    ).fetchall()
    assert rows == []


def test_anon_has_no_grants_on_personal_tables(admin) -> None:
    rows = admin.execute(
        "select table_name, privilege_type from information_schema.role_table_grants "
        "where grantee = 'anon' and table_schema = 'public' and table_name <> 'subjects'"
    ).fetchall()
    assert rows == []


def test_private_schema_not_usable_by_api_roles(admin) -> None:
    row = admin.execute(
        "select has_schema_privilege('anon', 'private', 'usage') as anon,"
        "       has_schema_privilege('authenticated', 'private', 'usage') as authn"
    ).fetchone()
    assert row == {"anon": False, "authn": False}


def test_withdrawal_history_is_private_and_not_writable(admin, users, as_user, anon) -> None:
    """RLS limita o histórico ao professor e a API é a única escritora."""
    owner, other = users.create("Prof Saque"), users.create("Outro Professor")
    for teacher in (owner, other):
        users.grant_role(teacher, "teacher")
        admin.execute("insert into public.teacher_profiles (user_id) values (%s)", (teacher,))
    withdrawal_id = uuid.uuid4()
    admin.execute(
        """
        insert into public.withdrawal_requests
          (id, teacher_id, environment, sub_account_id, amount_cents, idempotency_key, external_id)
        values (%s, %s, 'production', 'sacc_security1234', 100, %s, 'wd_securitycheck1234')
        """,
        (withdrawal_id, owner, uuid.uuid4()),
    )

    try:
        assert [
            row["id"] for row in as_user(owner).rows("select id from public.withdrawal_requests")
        ] == [withdrawal_id]
        assert as_user(other).rows("select id from public.withdrawal_requests") == []
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            anon.rows("select id from public.withdrawal_requests")
        for session in (as_user(owner), as_user(other)):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                session.execute(
                    "insert into public.withdrawal_requests "
                    "(teacher_id, environment, sub_account_id, amount_cents, idempotency_key, external_id) "
                    "values (%s, 'production', 'sacc_security1234', 100, %s, 'wd_directwrite1234')",
                    (owner, uuid.uuid4()),
                )
    finally:
        admin.execute(
            "delete from private.withdrawal_audit_log where withdrawal_id = %s", (withdrawal_id,)
        )
        admin.execute("delete from public.withdrawal_requests where id = %s", (withdrawal_id,))


def test_foreign_keys_are_indexed(admin) -> None:
    rows = admin.execute(
        """
        select c.conrelid::regclass::text as tbl, c.conname
          from pg_constraint c
         where c.contype = 'f'
           and c.connamespace = 'public'::regnamespace
           and not exists (
                 select 1 from pg_index i
                  where i.indrelid = c.conrelid
                    and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey)
        """
    ).fetchall()
    assert rows == []


# ------------------------------------------------------------------------------- GraphQL


def test_pg_graphql_is_not_installed(admin) -> None:
    row = admin.execute(
        "select count(*) as n from pg_extension where extname = 'pg_graphql'"
    ).fetchone()
    assert row["n"] == 0


# ------------------------------------------------------------------------------- matriz de acesso
# Fotografia exata dos privilégios e políticas. Qualquer afrouxamento (ou mudança) quebra o teste.

EXPECTED_TABLE_GRANTS = {
    ("anon", "subjects", "SELECT"),
    ("authenticated", "profiles", "SELECT"),
    ("authenticated", "account_roles", "SELECT"),
    ("authenticated", "subjects", "SELECT"),
    ("authenticated", "student_profiles", "SELECT"),
    ("authenticated", "teacher_profiles", "SELECT"),
    ("authenticated", "teacher_subjects", "SELECT"),
    ("authenticated", "teacher_subjects", "DELETE"),
    ("authenticated", "student_subjects", "SELECT"),
    ("authenticated", "student_subjects", "DELETE"),
    # Fase 3A: disponibilidade e aulas de teste (INSERT/UPDATE só por coluna, fora desta visão).
    ("authenticated", "teacher_availability", "SELECT"),
    ("authenticated", "teacher_availability", "DELETE"),
    ("authenticated", "lessons", "SELECT"),
    ("edusearch_api", "lessons", "SELECT"),
    # Fase 5A: tabelas financeiras são SOMENTE LEITURA para o app (escrita só por funções private).
    ("authenticated", "payment_intents", "SELECT"),
    ("authenticated", "payment_splits", "SELECT"),
    ("authenticated", "teacher_payout_accounts", "SELECT"),
    ("authenticated", "withdrawal_requests", "SELECT"),
    ("authenticated", "refund_requests", "SELECT"),
}

EXPECTED_POLICIES = {
    ("account_roles", "account_roles_insert_via_api", "INSERT"),
    ("account_roles", "account_roles_select_own", "SELECT"),
    ("profiles", "profiles_select_visible", "SELECT"),
    ("profiles", "profiles_update_own", "UPDATE"),
    ("student_profiles", "student_profiles_insert_own", "INSERT"),
    ("student_profiles", "student_profiles_select_own", "SELECT"),
    ("student_profiles", "student_profiles_update_own", "UPDATE"),
    ("student_subjects", "student_subjects_delete_own", "DELETE"),
    ("student_subjects", "student_subjects_insert_own", "INSERT"),
    ("student_subjects", "student_subjects_select_own", "SELECT"),
    ("subjects", "subjects_select_active", "SELECT"),
    ("teacher_profiles", "teacher_profiles_insert_own", "INSERT"),
    ("teacher_profiles", "teacher_profiles_select_own_or_published", "SELECT"),
    ("teacher_profiles", "teacher_profiles_update_own", "UPDATE"),
    ("teacher_subjects", "teacher_subjects_delete_own", "DELETE"),
    ("teacher_subjects", "teacher_subjects_insert_own", "INSERT"),
    ("teacher_subjects", "teacher_subjects_select_own_or_published", "SELECT"),
    ("teacher_subjects", "teacher_subjects_update_own", "UPDATE"),
    ("teacher_availability", "teacher_availability_select", "SELECT"),
    ("teacher_availability", "teacher_availability_insert_own", "INSERT"),
    ("teacher_availability", "teacher_availability_delete_own", "DELETE"),
    ("lessons", "lessons_select_participant", "SELECT"),
    ("lessons", "lessons_insert_student", "INSERT"),
    ("lessons", "lessons_update_participant", "UPDATE"),
    ("lessons", "lessons_select_via_api", "SELECT"),
    ("lessons", "lessons_update_calendar_via_api", "UPDATE"),
    ("payment_intents", "payment_intents_select_participant", "SELECT"),
    ("payment_splits", "payment_splits_select_teacher", "SELECT"),
    ("teacher_payout_accounts", "teacher_payout_accounts_select_own", "SELECT"),
    ("withdrawal_requests", "withdrawal_requests_select_own", "SELECT"),
    ("refund_requests", "refund_requests_select_participant", "SELECT"),
}


def test_table_grants_match_expected_matrix(admin) -> None:
    rows = admin.execute(
        "select grantee, table_name, privilege_type from information_schema.role_table_grants "
        "where table_schema = 'public' and grantee in ('anon', 'authenticated', 'edusearch_api') "
        "and table_name = any(%s)",
        (APP_TABLES,),
    ).fetchall()
    assert {(r["grantee"], r["table_name"], r["privilege_type"]) for r in rows} == (
        EXPECTED_TABLE_GRANTS
    )


def test_policies_match_expected_set(admin) -> None:
    rows = admin.execute(
        "select tablename, policyname, cmd from pg_policies where schemaname = 'public'"
    ).fetchall()
    assert {(r["tablename"], r["policyname"], r["cmd"]) for r in rows} == EXPECTED_POLICIES
