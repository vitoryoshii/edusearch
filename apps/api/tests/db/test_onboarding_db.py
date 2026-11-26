"""Onboarding de ponta a ponta com banco real, conectando como edusearch_api.

Persistência (salvar → reabrir → recuperar), isolamento entre usuários, professor pendente sem
publicação, papel de conexão sem privilégios extras e integridade dos dados existentes.
"""

import copy

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.db import Database
from app.main import create_app
from tests.test_onboarding_api import STUDENT, TEACHER


@pytest.fixture
def make_client(settings, verifier, api_database_url):
    """Cada chamada cria uma API NOVA (outro pool): simula recarregar a página / novo login."""
    clients: list[TestClient] = []

    def _make() -> TestClient:
        database = Database(api_database_url, min_size=0, max_size=2, connect_timeout=5)
        c = TestClient(create_app(settings, token_verifier=verifier, database=database))
        c.__enter__()
        clients.append(c)
        return c

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --------------------------------------------------------------------------- catálogo


def test_subjects_catalog_via_anon(client) -> None:
    r = client.get("/v1/subjects")
    assert r.status_code == 200
    slugs = [s["slug"] for s in r.json()]
    assert {"matematica", "fisica", "programacao"} <= set(slugs)
    assert len(slugs) == len(set(slugs))


# --------------------------------------------------------------------------- papel


def test_role_selection_is_persisted_and_idempotent(client, users, make_token, admin) -> None:
    a = users.create("Aluna A")
    token = make_token(a)
    r = client.post("/v1/me/roles", json={"role": "student"}, headers=auth(token))
    assert r.status_code == 201, r.text
    assert r.json()["roles"] == ["student"]
    assert r.json()["onboarding"] == {"student": {"status": "pending"}, "teacher": None}

    again = client.post("/v1/me/roles", json={"role": "student"}, headers=auth(token))
    assert again.status_code == 200
    n = admin.execute("select count(*) as n from public.account_roles where user_id = %s", (a,))
    assert n.fetchone()["n"] == 1

    both = client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(token))
    assert both.status_code == 201
    assert both.json()["roles"] == ["student", "teacher"]


def test_role_for_unknown_account_is_404(client, make_token) -> None:
    r = client.post("/v1/me/roles", json={"role": "student"}, headers=auth(make_token()))
    assert (r.status_code, r.json()["code"]) == (404, "profile_not_found")


def test_suspended_account_cannot_select_role(client, users, make_token, admin) -> None:
    a = users.create()
    admin.execute("update public.profiles set status = 'suspended' where id = %s", (a,))
    r = client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(make_token(a)))
    assert (r.status_code, r.json()["code"]) == (403, "account_suspended")


# --------------------------------------------------------------------------- aluno


def test_student_saves_and_recovers_after_reload(make_client, users, make_token) -> None:
    a = users.create("Aluna A")
    first = make_client()
    first.post("/v1/me/roles", json={"role": "student"}, headers=auth(make_token(a)))
    assert first.get("/v1/me/student-profile", headers=auth(make_token(a))).status_code == 404

    r = first.put("/v1/me/student-profile", json=STUDENT, headers=auth(make_token(a)))
    assert r.status_code == 200, r.text

    # "Recarregar"/novo login: outra instância da API e outro token do mesmo usuário.
    second = make_client()
    got = second.get("/v1/me/student-profile", headers=auth(make_token(a)))
    assert got.status_code == 200
    body = got.json()
    assert body["learning_goal"] == STUDENT["learning_goal"]
    assert sorted(body["subjects"]) == sorted(STUDENT["subjects"])
    assert body["difficulty_areas"] == STUDENT["difficulty_areas"]
    assert body["preferred_weekdays"] == STUDENT["preferred_weekdays"]
    assert (body["budget_min_cents"], body["budget_max_cents"]) == (5000, 8000)
    me = second.get("/v1/me", headers=auth(make_token(a))).json()
    assert me["onboarding"]["student"] == {"status": "completed"}


def test_student_update_replaces_subjects(client, users, make_token, admin) -> None:
    a = users.create()
    t = make_token(a)
    client.post("/v1/me/roles", json={"role": "student"}, headers=auth(t))
    client.put("/v1/me/student-profile", json=STUDENT, headers=auth(t))
    changed = {**STUDENT, "subjects": ["fisica", "quimica"], "learning_goal": "Novo objetivo"}
    r = client.put("/v1/me/student-profile", json=changed, headers=auth(t))
    assert sorted(r.json()["subjects"]) == ["fisica", "quimica"]
    n = admin.execute(
        "select count(*) as n from public.student_profiles where user_id = %s", (a,)
    ).fetchone()["n"]
    assert n == 1


def test_unknown_subject_is_422_and_nothing_saved(client, users, make_token, admin) -> None:
    a = users.create()
    t = make_token(a)
    client.post("/v1/me/roles", json={"role": "student"}, headers=auth(t))
    r = client.put(
        "/v1/me/student-profile", json={**STUDENT, "subjects": ["alquimia"]}, headers=auth(t)
    )
    assert (r.status_code, r.json()["code"]) == (422, "unknown_subject")
    n = admin.execute("select count(*) as n from public.student_profiles where user_id = %s", (a,))
    assert n.fetchone()["n"] == 0  # transação desfeita


def test_student_b_cannot_read_student_a(client, users, make_token) -> None:
    a, b = users.create("Aluna A"), users.create("Aluno B")
    for uid in (a, b):
        client.post("/v1/me/roles", json={"role": "student"}, headers=auth(make_token(uid)))
    client.put("/v1/me/student-profile", json=STUDENT, headers=auth(make_token(a)))

    r = client.get("/v1/me/student-profile", headers=auth(make_token(b)))
    assert r.status_code == 404  # B só enxerga o próprio (inexistente), nunca o de A
    r = client.get(f"/v1/me/student-profile?user_id={a}", headers=auth(make_token(b)))
    assert r.status_code == 404


def test_student_subjects_private_in_database(users, as_user, make_token, client) -> None:
    a, b = users.create(), users.create()
    client.post("/v1/me/roles", json={"role": "student"}, headers=auth(make_token(a)))
    client.put("/v1/me/student-profile", json=STUDENT, headers=auth(make_token(a)))
    assert (
        as_user(b).rows("select * from public.student_subjects where student_id = %s", (a,)) == []
    )
    assert len(as_user(a).rows("select * from public.student_subjects")) == 2
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(b).execute(
            "insert into public.student_subjects (student_id, subject_id) values (%s, 1)", (a,)
        )


# --------------------------------------------------------------------------- professor


def test_teacher_saves_pending_unpublished_and_recovers(make_client, users, make_token, as_user):
    a, b = users.create("Prof A"), users.create("Aluno B")
    c = make_client()
    c.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(make_token(a)))
    r = c.put("/v1/me/teacher-profile", json=TEACHER, headers=auth(make_token(a)))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verification_status"] == "pending"
    assert body["is_published"] is False and body["published_at"] is None
    assert body["lesson_durations_minutes"] == [45, 60]
    assert body["lesson_duration_minutes"] == 45
    assert body["teaching_methods"] == ["exercicios", "pratica"]
    assert body["available_periods"] == ["tarde", "noite"]

    got = make_client().get("/v1/me/teacher-profile", headers=auth(make_token(a))).json()
    assert got["bio"] == TEACHER["bio"] and got["specialties"] == TEACHER["specialties"]
    me = c.get("/v1/me", headers=auth(make_token(a))).json()
    assert me["onboarding"]["teacher"] == {
        "status": "completed",
        "verification_status": "pending",
        "is_published": False,
    }
    # Pendente: invisível para outro usuário autenticado.
    rows = as_user(b).rows("select * from public.teacher_profiles where user_id = %s", (a,))
    assert rows == []


def test_teacher_resave_does_not_change_approval(client, users, make_token, admin) -> None:
    a = users.create()
    t = make_token(a)
    client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(t))
    client.put("/v1/me/teacher-profile", json=TEACHER, headers=auth(t))
    admin.execute(
        "update public.teacher_profiles set verification_status = 'rejected' where user_id = %s",
        (a,),
    )
    r = client.put("/v1/me/teacher-profile", json={**TEACHER, "price_cents": 9000}, headers=auth(t))
    assert r.json()["verification_status"] == "rejected"  # salvar não reabre/aprova


def test_teacher_subject_update_keeps_existing_rows(client, users, make_token, admin) -> None:
    a = users.create()
    t = make_token(a)
    client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(t))
    client.put("/v1/me/teacher-profile", json=TEACHER, headers=auth(t))
    admin.execute(
        "update public.teacher_subjects set levels = '{medio}' where teacher_id = %s", (a,)
    )
    body = {**TEACHER, "subjects": ["matematica", "fisica"]}
    client.put("/v1/me/teacher-profile", json=body, headers=auth(t))
    rows = admin.execute(
        "select s.slug, ts.levels::text[] as levels from public.teacher_subjects ts "
        "join public.subjects s on s.id = ts.subject_id where ts.teacher_id = %s order by 1",
        (a,),
    ).fetchall()
    assert rows == [
        {"slug": "fisica", "levels": []},
        {"slug": "matematica", "levels": ["medio"]},  # níveis existentes preservados
    ]


def test_student_cannot_save_teacher_profile(client, users, make_token, admin) -> None:
    a = users.create()
    t = make_token(a)
    client.post("/v1/me/roles", json={"role": "student"}, headers=auth(t))
    r = client.put("/v1/me/teacher-profile", json=TEACHER, headers=auth(t))
    assert (r.status_code, r.json()["code"]) == (403, "role_required")
    n = admin.execute("select count(*) as n from public.teacher_profiles where user_id = %s", (a,))
    assert n.fetchone()["n"] == 0


def test_payload_cannot_publish(client, users, make_token, admin) -> None:
    a = users.create()
    t = make_token(a)
    client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(t))
    body = copy.deepcopy(TEACHER) | {"is_published": True, "verification_status": "approved"}
    assert client.put("/v1/me/teacher-profile", json=body, headers=auth(t)).status_code == 422
    n = admin.execute("select count(*) as n from public.teacher_profiles where user_id = %s", (a,))
    assert n.fetchone()["n"] == 0


# --------------------------------------------------------------------------- papel de conexão


def test_api_connection_role_is_least_privilege(api_database_url, admin) -> None:
    row = admin.execute(
        "select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolinherit "
        "from pg_roles where rolname = 'edusearch_api'"
    ).fetchone()
    assert row == {
        "rolsuper": False,
        "rolbypassrls": False,
        "rolcreaterole": False,
        "rolcreatedb": False,
        "rolinherit": False,
    }
    with psycopg.connect(api_database_url) as conn:
        for query in [
            "select * from public.profiles",
            "select * from public.account_roles",
            "select * from public.student_profiles",
            "update public.teacher_profiles set verification_status = 'approved'",
            "select * from private.signup_allowlist",
            "select * from auth.users",
        ]:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(query)
            conn.rollback()
        for role in ["service_role", "postgres", "supabase_auth_admin"]:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(f"set role {role}")
            conn.rollback()


def test_api_role_cannot_grant_role_to_another_user(api_database_url, users) -> None:
    a, b = users.create(), users.create()
    with psycopg.connect(api_database_url) as conn:
        conn.execute(
            "select set_config('request.jwt.claims', %s, true)",
            (f'{{"sub": "{a}", "role": "authenticated"}}',),
        )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "insert into public.account_roles (user_id, role) values (%s, 'teacher')", (b,)
            )
        conn.rollback()
        # Sem claims, nenhum INSERT passa.
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                "insert into public.account_roles (user_id, role) values (%s, 'teacher')", (a,)
            )
        conn.rollback()


def test_existing_rows_survive_new_columns(users, commit_as, admin) -> None:
    """Linhas criadas sem os campos novos continuam válidas (padrões vazios)."""
    a = users.create()
    users.grant_role(a, "teacher")
    commit_as(a).execute(
        "insert into public.teacher_profiles (user_id, bio, price_cents) values (%s, %s, 8000)",
        (a, "Professora fictícia com bio de pelo menos trinta caracteres."),
    )
    row = admin.execute(
        "select teaching_methods::text[] as m, lesson_durations_minutes::int[] as d, "
        "lesson_duration_minutes as p from public.teacher_profiles where user_id = %s",
        (a,),
    ).fetchone()
    assert row == {"m": [], "d": [], "p": 60}


# -------------------------------------------------------------------- credenciamento


VERIFICATION = {
    "qualification_kind": "graduated",
    "birth_date": "1990-01-02",
    "institution": "Universidade Fictícia",
    "qualification": "Licenciatura em Matemática",
    "professional_experience": "Experiência comprovável em reforço escolar e preparação para vestibulares.",
    "curriculum_summary": "Atuação em aulas individuais, planejamento didático e acompanhamento de aprendizagem.",
    "financial_tax_id_kind": "cpf",
    "financial_tax_id_last4": "1234",
    "terms_version": "teacher-terms-2026-11",
}


def test_teacher_verification_is_private_and_submission_requires_documents(
    client, users, make_token, as_user
) -> None:
    teacher = users.create("Prof Credenciado", email_confirmed=True)
    token = make_token(teacher)
    client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(token))
    assert (
        client.put("/v1/me/teacher-profile", json=TEACHER, headers=auth(token)).status_code == 200
    )

    assert client.get("/v1/me/teacher-verification", headers=auth(token)).status_code == 404
    saved = client.put("/v1/me/teacher-verification", json=VERIFICATION, headers=auth(token))
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["status"] == "draft"
    assert "birth_date" not in body and "financial_tax_id_last4" not in body

    submitted = client.post("/v1/me/teacher-verification/submit", headers=auth(token))
    assert (submitted.status_code, submitted.json()["code"]) == (
        422,
        "verification_documents_required",
    )
    # O usuário não recebe acesso direto aos dados sensíveis, mesmo autenticado.
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(teacher).rows("select * from private.teacher_verifications")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(teacher).rows("select * from private.teacher_verification_documents")
