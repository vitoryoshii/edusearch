"""Integração administrativa: JWT verificado, RBAC persistido e fronteira privada.

Estes testes usam o mesmo papel ``edusearch_api`` da API.  Assim, uma resposta
200 prova tanto a autorização do endpoint quanto o EXECUTE mínimo das funções
``private``; usuários comuns nunca recebem acesso direto a essas tabelas.
"""

import json
import uuid

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.db import Database
from app.main import create_app


@pytest.fixture
def client(settings, verifier, api_database_url):
    database = Database(api_database_url, min_size=0, max_size=2, connect_timeout=5)
    with TestClient(
        create_app(settings, token_verifier=verifier, database=database)
    ) as test_client:
        yield test_client


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def grant_admin(admin, user_id, role: str) -> None:
    admin.execute("update public.profiles set status = 'active' where id = %s", (user_id,))
    admin.execute(
        "insert into private.admin_memberships (user_id, role) values (%s, %s::private.admin_role)",
        (user_id, role),
    )


def make_teacher(admin, users, name: str = "Professor pendente"):
    teacher_id = users.create(name, email_confirmed=True)
    users.grant_role(teacher_id, "teacher")
    admin.execute("insert into public.teacher_profiles (user_id) values (%s)", (teacher_id,))
    return teacher_id


def test_admin_requires_verified_jwt(client, make_token, other_key) -> None:
    assert client.get("/v1/admin/me").status_code == 401
    forged = make_token(key=other_key, kid="unknown")
    assert client.get("/v1/admin/me", headers=auth(forged)).status_code == 401


def test_public_student_and_teacher_cannot_access_admin(client, users, make_token, admin) -> None:
    student = users.create("Aluna pública")
    users.grant_role(student, "student")
    teacher = make_teacher(admin, users, "Professor público")
    for user_id in (student, teacher):
        response = client.get("/v1/admin/dashboard", headers=auth(make_token(user_id)))
        assert response.status_code == 403
        assert response.json()["code"] == "admin_permission_required"


@pytest.mark.parametrize(
    ("role", "allowed", "denied"),
    [
        ("super_admin", "/v1/admin/administrators", None),
        ("operations_admin", "/v1/admin/teachers", "/v1/admin/payments"),
        ("finance_admin", "/v1/admin/payments", "/v1/admin/students"),
        ("support_admin", "/v1/admin/notifications", "/v1/admin/payments"),
        ("auditor", "/v1/admin/audit", "/v1/admin/dashboard"),
    ],
)
def test_each_role_has_only_its_persisted_permissions(
    client, users, make_token, admin, role, allowed, denied
) -> None:
    operator = users.create(f"Admin {role}", email_confirmed=True)
    grant_admin(admin, operator, role)
    headers = auth(make_token(operator))
    assert client.get(allowed, headers=headers).status_code == 200
    if denied:
        assert client.get(denied, headers=headers).status_code == 403


def test_revoked_admin_loses_access(client, users, make_token, admin) -> None:
    operator = users.create("Admin revogado", email_confirmed=True)
    grant_admin(admin, operator, "super_admin")
    headers = auth(make_token(operator))
    assert client.get("/v1/admin/me", headers=headers).status_code == 200
    admin.execute(
        "update private.admin_memberships set active=false, revoked_at=now() where user_id=%s",
        (operator,),
    )
    assert client.get("/v1/admin/me", headers=headers).status_code == 403


def test_super_admin_can_read_every_endpoint_family(client, users, make_token, admin) -> None:
    operator = users.create("Admin completo", email_confirmed=True)
    grant_admin(admin, operator, "super_admin")
    headers = auth(make_token(operator))
    for path in (
        "/v1/admin/me",
        "/v1/admin/dashboard",
        "/v1/admin/teachers",
        "/v1/admin/students",
        "/v1/admin/lessons",
        "/v1/admin/payments",
        "/v1/admin/payout-accounts",
        "/v1/admin/notifications",
        "/v1/admin/audit",
        "/v1/admin/administrators",
    ):
        response = client.get(path, headers=headers)
        assert response.status_code == 200, (path, response.text)


def test_teacher_transitions_are_audited_and_reject_invalid_actor(
    client, users, make_token, admin
) -> None:
    operator = users.create("Operações", email_confirmed=True)
    grant_admin(admin, operator, "operations_admin")
    teacher = make_teacher(admin, users)
    headers = auth(make_token(operator))

    for action in ("approve", "reject", "suspend", "reactivate"):
        response = client.post(
            f"/v1/admin/teachers/{teacher}/{action}",
            headers=headers,
            json={"justification": f"Operação válida: {action}"},
        )
        assert response.status_code == 200, response.text

    rows = admin.execute(
        "select action, result from private.admin_audit_log where actor_id=%s and resource_id=%s "
        "order by created_at",
        (operator, teacher),
    ).fetchall()
    assert [row["action"] for row in rows] == [
        "teachers.approve",
        "teachers.reject",
        "teachers.suspend",
        "teachers.reactivate",
    ]
    assert {row["result"] for row in rows} == {"success"}

    public_user = users.create("Sem permissão", email_confirmed=True)
    before = admin.execute("select status from public.profiles where id=%s", (teacher,)).fetchone()[
        "status"
    ]
    denied = client.post(
        f"/v1/admin/teachers/{teacher}/suspend",
        headers=auth(make_token(public_user)),
        json={"justification": "Tentativa indevida"},
    )
    assert denied.status_code == 403
    after = admin.execute("select status from public.profiles where id=%s", (teacher,)).fetchone()[
        "status"
    ]
    assert after == before


def test_public_identity_cannot_self_grant_admin_or_read_private_data(
    client, users, make_token, admin, as_user, anon
) -> None:
    user_id = users.create("Tentativa de elevação")
    users.grant_role(user_id, "teacher")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(user_id).execute(
            "insert into private.admin_memberships (user_id, role) values (%s, 'super_admin')",
            (user_id,),
        )
    for session in (as_user(user_id), anon):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            session.rows("select * from private.admin_audit_log")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            session.rows("select * from private.notification_outbox")
    assert (
        client.get("/v1/admin/administrators", headers=auth(make_token(user_id))).status_code == 403
    )


def test_payments_keep_environment_and_outbox_hides_recipient_data(
    client, users, make_token, admin
) -> None:
    operator = users.create("Financeiro", email_confirmed=True)
    grant_admin(admin, operator, "finance_admin")
    student = users.create("Aluna pagante", email_confirmed=True)
    teacher = make_teacher(admin, users, "Professor financeiro")
    users.grant_role(student, "student")
    for environment in ("sandbox", "production"):
        admin.execute(
            """
            insert into public.payment_intents
              (student_id, teacher_id, amount_cents, commission_bps, commission_cents,
               teacher_share_cents, environment, idempotency_key, expires_at)
            values (%s, %s, 9000, 1500, 1350, 7650, %s::public.payment_environment, %s, now() + interval '1 hour')
            """,
            (student, teacher, environment, uuid.uuid4()),
        )
    headers = auth(make_token(operator))
    payments = client.get("/v1/admin/payments", headers=headers)
    assert payments.status_code == 200, payments.text
    assert {row["environment"] for row in payments.json()["items"]} >= {"sandbox", "production"}

    # finance_admin intentionally has no notification capability; a support admin may read only
    # the sanitized projection, never recipient/body/template variables.
    support = users.create("Suporte", email_confirmed=True)
    grant_admin(admin, support, "support_admin")
    admin.execute(
        """
        insert into private.notification_outbox
          (event_type, entity_type, entity_id, recipient_user_id, recipient_email, template_alias,
           template_variables, idempotency_key)
        values ('lesson.created', 'lesson', %s, %s, 'confirmed@example.com', 'edusearch-aula-confirmada-v1',
                %s::jsonb, %s)
        """,
        (uuid.uuid4(), student, json.dumps({"NOME": "Privado"}), uuid.uuid4()),
    )
    notifications = client.get("/v1/admin/notifications", headers=auth(make_token(support)))
    assert notifications.status_code == 200, notifications.text
    item = notifications.json()["items"][0]
    assert {"recipient_email", "template_variables", "body", "content"}.isdisjoint(item)


def test_pagination_is_bounded_and_keeps_contract(client, users, make_token, admin) -> None:
    operator = users.create("Admin paginação", email_confirmed=True)
    grant_admin(admin, operator, "super_admin")
    headers = auth(make_token(operator))
    for i in range(3):
        student = users.create(f"Aluna página {i}")
        users.grant_role(student, "student")
    page = client.get("/v1/admin/students?limit=2&offset=1", headers=headers)
    assert page.status_code == 200
    assert page.json()["limit"] == 2
    assert page.json()["offset"] == 1
    assert len(page.json()["items"]) <= 2
    assert client.get("/v1/admin/students?limit=101", headers=headers).status_code == 422
    assert client.get("/v1/admin/students?offset=-1", headers=headers).status_code == 422


def test_admin_private_grants_and_rls_are_closed_to_public_roles(admin) -> None:
    for table in (
        "private.admin_memberships",
        "private.admin_audit_log",
        "private.notification_outbox",
    ):
        row = admin.execute(
            "select has_table_privilege('anon', %s, 'select') as anon, "
            "has_table_privilege('authenticated', %s, 'select') as authenticated",
            (table, table),
        ).fetchone()
        assert row == {"anon": False, "authenticated": False}
    policies = admin.execute(
        "select tablename from pg_tables where schemaname='private' and tablename in "
        "('admin_memberships','admin_audit_log','notification_outbox')"
    ).fetchall()
    assert {row["tablename"] for row in policies} == {
        "admin_memberships",
        "admin_audit_log",
        "notification_outbox",
    }
