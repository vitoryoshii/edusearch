"""RLS e privilégios com dois usuários independentes e um visitante anônimo."""

import psycopg
import pytest

from tests.db.conftest import credential_approved

PERSONAL_TABLES = [
    "public.profiles",
    "public.account_roles",
    "public.student_profiles",
    "public.teacher_profiles",
    "public.teacher_subjects",
    "public.student_subjects",
]

TEACHER_INSERT = """
insert into public.teacher_profiles (user_id, headline, bio, price_cents, lesson_duration_minutes)
values (%s, 'Professora de matemática', %s, 8000, 60)
"""
BIO = "Professora fictícia com experiência em ensino médio e pré-vestibular."


# ------------------------------------------------------------------------------- anônimo


@pytest.mark.parametrize("table", PERSONAL_TABLES)
def test_anon_cannot_read_personal_tables(anon, users, table) -> None:
    users.create()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        anon.rows(f"select * from {table}")  # noqa: S608


def test_anon_can_read_only_active_subjects(anon, admin) -> None:
    admin.execute(
        "insert into public.subjects (slug, name, is_active) values ('teste-inativa', 'Inativa', false)"
    )
    try:
        slugs = {r["slug"] for r in anon.rows("select slug from public.subjects")}
        assert "matematica" in slugs
        assert "teste-inativa" not in slugs
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            anon.execute("insert into public.subjects (slug, name) values ('x', 'Xx')")
    finally:
        admin.execute("delete from public.subjects where slug = 'teste-inativa'")


def test_anon_cannot_touch_private_schema_or_hook(anon) -> None:
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        anon.rows("select * from private.signup_allowlist")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        anon.rows("select public.hook_before_user_created('{}'::jsonb)")


# ------------------------------------------------------------------------------- profiles


def test_profile_is_created_from_auth_user(users, admin) -> None:
    uid = users.create(
        "  Aluna\u0007 Fictícia ", avatar_url="https://lh3.googleusercontent.com/a/x"
    )
    row = admin.execute("select * from public.profiles where id = %s", (uid,)).fetchone()
    assert row["display_name"] == "Aluna Fictícia"
    assert row["avatar_url"] == "https://lh3.googleusercontent.com/a/x"
    assert row["status"] == "onboarding"
    roles = admin.execute(
        "select count(*) as n from public.account_roles where user_id = %s", (uid,)
    )
    assert roles.fetchone()["n"] == 0  # criar conta não concede papel


def test_profile_ignores_unsafe_avatar_and_empty_name(users, admin) -> None:
    uid = users.create("", avatar_url="javascript:alert(1)")
    row = admin.execute("select * from public.profiles where id = %s", (uid,)).fetchone()
    assert row["avatar_url"] is None
    assert row["display_name"].startswith("teste+")  # parte local do e-mail


def test_user_sees_only_own_profile(users, as_user) -> None:
    a, b = users.create("A"), users.create("B")
    rows = as_user(a).rows("select id from public.profiles")
    assert [r["id"] for r in rows] == [a]
    assert as_user(a).rows("select * from public.profiles where id = %s", (b,)) == []


def test_user_cannot_update_other_profile(users, as_user, admin) -> None:
    a, b = users.create("A"), users.create("B")
    assert (
        as_user(a).execute("update public.profiles set display_name = 'x' where id = %s", (b,)) == 0
    )
    name = admin.execute("select display_name from public.profiles where id = %s", (b,)).fetchone()
    assert name["display_name"] == "B"


def test_user_can_update_own_presentation_fields(users, as_user) -> None:
    a = users.create("A")
    n = as_user(a).execute(
        "update public.profiles set display_name = 'Novo', avatar_url = null where id = %s", (a,)
    )
    assert n == 1


@pytest.mark.parametrize(
    "assignment",
    ["status = 'active'", "id = gen_random_uuid()", "created_at = now()", "updated_at = now()"],
)
def test_user_cannot_update_server_fields(users, as_user, assignment) -> None:
    a = users.create()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(a).execute(f"update public.profiles set {assignment} where id = %s", (a,))  # noqa: S608


def test_user_cannot_insert_or_delete_profiles(users, as_user) -> None:
    a, b = users.create(), users.create()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(a).execute(
            "insert into public.profiles (id, display_name) values (gen_random_uuid(), 'x')"
        )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(a).execute("delete from public.profiles where id = %s", (b,))


def test_updated_at_trigger(users, admin, commit_as) -> None:
    a = users.create()
    before = admin.execute("select updated_at from public.profiles where id = %s", (a,)).fetchone()
    commit_as(a).execute("update public.profiles set display_name = 'Depois' where id = %s", (a,))
    after = admin.execute("select updated_at from public.profiles where id = %s", (a,)).fetchone()
    assert after["updated_at"] > before["updated_at"]


# ------------------------------------------------------------------------------- papéis


def test_user_cannot_grant_roles(users, as_user) -> None:
    a = users.create()
    for role in ("student", "teacher"):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            as_user(a).execute(
                "insert into public.account_roles (user_id, role) values (%s, %s)", (a, role)
            )


def test_user_reads_only_own_roles(users, as_user) -> None:
    a, b = users.create(), users.create()
    users.grant_role(a, "student")
    users.grant_role(b, "teacher")
    rows = as_user(a).rows("select user_id, role::text from public.account_roles")
    assert rows == [{"user_id": a, "role": "student"}]


def test_user_cannot_delete_or_change_roles(users, as_user) -> None:
    a = users.create()
    users.grant_role(a, "student")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(a).execute(
            "update public.account_roles set role = 'teacher' where user_id = %s", (a,)
        )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(a).execute("delete from public.account_roles where user_id = %s", (a,))


# ------------------------------------------------------------------------------- alunos


def test_student_profile_requires_persisted_student_role(users, as_user) -> None:
    a = users.create()
    with pytest.raises(psycopg.errors.InsufficientPrivilege):  # RLS WITH CHECK
        as_user(a).execute(
            "insert into public.student_profiles (user_id, learning_goal) values (%s, 'Passar no Enem')",
            (a,),
        )
    users.grant_role(a, "student")
    assert (
        as_user(a).execute(
            "insert into public.student_profiles (user_id, learning_goal) values (%s, 'Passar no Enem')",
            (a,),
        )
        == 1
    )


def test_student_data_is_private(users, as_user, commit_as, anon) -> None:
    a, b = users.create("Aluno A"), users.create("Aluno B")
    users.grant_role(a, "student")
    users.grant_role(b, "student")
    commit_as(a).execute(
        "insert into public.student_profiles (user_id, learning_goal, difficulties) "
        "values (%s, 'Melhorar em física', 'Dificuldade fictícia')",
        (a,),
    )
    assert as_user(b).rows("select * from public.student_profiles where user_id = %s", (a,)) == []
    assert (
        as_user(b).execute(
            "update public.student_profiles set learning_goal = 'hackeado' where user_id = %s", (a,)
        )
        == 0
    )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(b).execute(
            "insert into public.student_profiles (user_id, learning_goal) values (%s, 'xxx')", (a,)
        )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        anon.rows("select * from public.student_profiles")
    assert len(as_user(a).rows("select * from public.student_profiles")) == 1


def test_student_constraints(users, commit_as) -> None:
    a = users.create()
    users.grant_role(a, "student")
    with pytest.raises(psycopg.errors.CheckViolation):
        commit_as(a).execute(
            "insert into public.student_profiles (user_id, budget_min_cents, budget_max_cents) "
            "values (%s, 9000, 5000)",
            (a,),
        )


# ------------------------------------------------------------------------------- professores


def test_teacher_profile_requires_teacher_role(users, as_user) -> None:
    a = users.create()
    users.grant_role(a, "student")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(a).execute(TEACHER_INSERT, (a, BIO))


@pytest.mark.parametrize(
    "column_value",
    [
        ("verification_status", "'approved'"),
        ("is_published", "true"),
        ("verified_at", "now()"),
        ("published_at", "now()"),
    ],
)
def test_teacher_cannot_self_approve_or_publish(users, as_user, commit_as, column_value) -> None:
    a = users.create()
    users.grant_role(a, "teacher")
    commit_as(a).execute(TEACHER_INSERT, (a, BIO))
    column, value = column_value
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(a).execute(
            f"update public.teacher_profiles set {column} = {value} where user_id = %s",  # noqa: S608
            (a,),
        )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(a).execute(
            f"insert into public.teacher_profiles (user_id, {column}) values (%s, {value})",  # noqa: S608
            (a,),
        )


def test_teacher_cannot_edit_other_teacher(users, as_user, commit_as, admin) -> None:
    a, b = users.create("Prof A"), users.create("Prof B")
    users.grant_role(a, "teacher")
    users.grant_role(b, "teacher")
    commit_as(a).execute(TEACHER_INSERT, (a, BIO))
    assert (
        as_user(b).execute(
            "update public.teacher_profiles set price_cents = 2000 where user_id = %s", (a,)
        )
        == 0
    )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(b).execute(TEACHER_INSERT, (a, BIO))
    price = admin.execute(
        "select price_cents from public.teacher_profiles where user_id = %s", (a,)
    )
    assert price.fetchone()["price_cents"] == 8000


def test_teacher_profile_visible_only_after_approval_and_publication(
    users, as_user, commit_as, admin, anon
) -> None:
    a, b = users.create("Prof A"), users.create("Aluno B")
    users.grant_role(a, "teacher")
    commit_as(a).execute(TEACHER_INSERT, (a, BIO))

    select = "select user_id from public.teacher_profiles where user_id = %s"
    assert as_user(b).rows(select, (a,)) == []
    assert len(as_user(a).rows(select, (a,))) == 1

    # Aprovação sem publicação: ainda invisível.
    credential_approved(admin, a)
    admin.execute(
        "update public.teacher_profiles set verification_status = 'approved', verified_at = now() "
        "where user_id = %s",
        (a,),
    )
    assert as_user(b).rows(select, (a,)) == []

    admin.execute(
        "update public.teacher_profiles set is_published = true, published_at = now() "
        "where user_id = %s",
        (a,),
    )
    assert len(as_user(b).rows(select, (a,))) == 1
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        anon.rows("select * from public.teacher_profiles")


def test_publication_requires_approval_constraint(users, commit_as, admin) -> None:
    a = users.create()
    users.grant_role(a, "teacher")
    commit_as(a).execute(TEACHER_INSERT, (a, BIO))
    credential_approved(admin, a)  # isola o CHECK do gatilho de credenciamento
    with pytest.raises(psycopg.errors.CheckViolation):
        admin.execute(
            "update public.teacher_profiles set is_published = true, published_at = now() "
            "where user_id = %s",
            (a,),
        )


@pytest.mark.parametrize(
    "assignment", ["price_cents = 1999", "price_cents = 100001", "lesson_duration_minutes = 50"]
)
def test_teacher_value_constraints(users, as_user, commit_as, assignment) -> None:
    a = users.create()
    users.grant_role(a, "teacher")
    commit_as(a).execute(TEACHER_INSERT, (a, BIO))
    with pytest.raises(psycopg.errors.CheckViolation):
        as_user(a).execute(
            f"update public.teacher_profiles set {assignment} where user_id = %s",
            (a,),  # noqa: S608
        )


def test_teacher_subjects_ownership_and_visibility(users, as_user, commit_as, admin) -> None:
    a, b = users.create("Prof A"), users.create("Prof B")
    users.grant_role(a, "teacher")
    users.grant_role(b, "teacher")
    commit_as(a).execute(TEACHER_INSERT, (a, BIO))
    commit_as(b).execute(TEACHER_INSERT, (b, BIO))
    subject = admin.execute("select id from public.subjects where slug = 'matematica'").fetchone()[
        "id"
    ]

    insert = "insert into public.teacher_subjects (teacher_id, subject_id) values (%s, %s)"
    commit_as(a).execute(insert, (a, subject))
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(b).execute(insert, (a, subject + 1))
    assert (
        as_user(b).execute("delete from public.teacher_subjects where teacher_id = %s", (a,)) == 0
    )

    select = "select * from public.teacher_subjects where teacher_id = %s"
    assert as_user(b).rows(select, (a,)) == []  # A não publicado
    credential_approved(admin, a)
    admin.execute(
        "update public.teacher_profiles set verification_status = 'approved', verified_at = now(), "
        "is_published = true, published_at = now() where user_id = %s",
        (a,),
    )
    assert len(as_user(b).rows(select, (a,))) == 1


# ------------------------------------------------------------------------------- integridade


def test_deleting_auth_user_cascades(users, commit_as, admin) -> None:
    a = users.create()
    users.grant_role(a, "teacher")
    users.grant_role(a, "student")
    commit_as(a).execute(TEACHER_INSERT, (a, BIO))
    commit_as(a).execute("insert into public.student_profiles (user_id) values (%s)", (a,))
    subject = admin.execute("select id from public.subjects where slug = 'fisica'").fetchone()["id"]
    commit_as(a).execute(
        "insert into public.teacher_subjects (teacher_id, subject_id) values (%s, %s)", (a, subject)
    )

    admin.execute("delete from auth.users where id = %s", (a,))
    for table, column in [
        ("profiles", "id"),
        ("account_roles", "user_id"),
        ("student_profiles", "user_id"),
        ("teacher_profiles", "user_id"),
        ("teacher_subjects", "teacher_id"),
    ]:
        n = admin.execute(
            f"select count(*) as n from public.{table} where {column} = %s",
            (a,),  # noqa: S608
        ).fetchone()["n"]
        assert n == 0, table


def test_subject_in_use_cannot_be_deleted(users, commit_as, admin) -> None:
    a = users.create()
    users.grant_role(a, "teacher")
    commit_as(a).execute(TEACHER_INSERT, (a, BIO))
    admin.execute("insert into public.subjects (slug, name) values ('teste-em-uso', 'Em uso')")
    try:
        sid = admin.execute(
            "select id from public.subjects where slug = 'teste-em-uso'"
        ).fetchone()["id"]
        commit_as(a).execute(
            "insert into public.teacher_subjects (teacher_id, subject_id) values (%s, %s)", (a, sid)
        )
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            admin.execute("delete from public.subjects where id = %s", (sid,))
    finally:
        admin.execute(
            "delete from public.teacher_subjects where subject_id in "
            "(select id from public.subjects where slug = 'teste-em-uso')"
        )
        admin.execute("delete from public.subjects where slug = 'teste-em-uso'")


def test_roles_require_existing_profile(admin) -> None:
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        admin.execute(
            "insert into public.account_roles (user_id, role) values (gen_random_uuid(), 'student')"
        )


def test_duplicate_role_rejected(users) -> None:
    a = users.create()
    users.grant_role(a, "student")
    with pytest.raises(psycopg.errors.UniqueViolation):
        users.grant_role(a, "student")
