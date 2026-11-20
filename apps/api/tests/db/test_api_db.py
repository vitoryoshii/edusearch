"""API de ponta a ponta com banco real: JWT verificado → SET ROLE authenticated → RLS."""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import Database
from app.main import create_app


@pytest.fixture
def client(settings, verifier, database_url):
    database = Database(database_url, min_size=0, max_size=2, connect_timeout=5)
    app = create_app(settings, token_verifier=verifier, database=database)
    with TestClient(app) as c:
        yield c


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_get_me_returns_own_profile_and_persisted_roles(client, users, make_token) -> None:
    a, b = users.create("Aluna A"), users.create("Professor B")
    users.grant_role(a, "student")
    users.grant_role(b, "teacher")

    r = client.get("/v1/me", headers=_auth(make_token(a, email="a@example.com")))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == str(a)
    assert body["display_name"] == "Aluna A"
    assert body["roles"] == ["student"]
    assert body["status"] == "onboarding"
    assert body["email"] == "a@example.com"


def test_token_role_claims_do_not_grant_roles(client, users, make_token) -> None:
    a = users.create()
    token = make_token(a, user_metadata={"role": "teacher"}, app_metadata={"role": "teacher"})
    assert client.get("/v1/me", headers=_auth(token)).json()["roles"] == []


def test_get_me_for_valid_token_without_user_is_404(client, make_token) -> None:
    r = client.get("/v1/me", headers=_auth(make_token(uuid.uuid4())))
    assert r.status_code == 404
    assert r.json()["code"] == "profile_not_found"


def test_put_profile_persists_only_allowed_fields(client, users, make_token, admin) -> None:
    a = users.create("Antes")
    r = client.put(
        "/v1/me/profile",
        headers=_auth(make_token(a)),
        json={"display_name": "Depois", "avatar_url": "https://lh3.googleusercontent.com/a/y"},
    )
    assert r.status_code == 200, r.text
    row = admin.execute("select * from public.profiles where id = %s", (a,)).fetchone()
    assert row["display_name"] == "Depois"
    assert row["avatar_url"] == "https://lh3.googleusercontent.com/a/y"
    assert row["status"] == "onboarding"


def test_put_profile_cannot_escalate(client, users, make_token, admin) -> None:
    a = users.create("Antes")
    for extra in ({"status": "active"}, {"roles": ["teacher"]}, {"id": str(uuid.uuid4())}):
        r = client.put(
            "/v1/me/profile", headers=_auth(make_token(a)), json={"display_name": "X", **extra}
        )
        assert r.status_code == 422
    row = admin.execute("select display_name, status from public.profiles where id = %s", (a,))
    assert row.fetchone() == {"display_name": "Antes", "status": "onboarding"}
    roles = admin.execute("select count(*) as n from public.account_roles where user_id = %s", (a,))
    assert roles.fetchone()["n"] == 0


def test_put_profile_only_touches_token_owner(client, users, make_token, admin) -> None:
    a, b = users.create("A"), users.create("B")
    r = client.put("/v1/me/profile", headers=_auth(make_token(a)), json={"display_name": "A2"})
    assert r.status_code == 200
    names = {
        row["id"]: row["display_name"]
        for row in admin.execute(
            "select id, display_name from public.profiles where id = any(%s)", ([a, b],)
        ).fetchall()
    }
    assert names == {a: "A2", b: "B"}


def test_suspended_account_cannot_edit(client, users, make_token, admin) -> None:
    a = users.create("A")
    admin.execute("update public.profiles set status = 'suspended' where id = %s", (a,))
    r = client.put("/v1/me/profile", headers=_auth(make_token(a)), json={"display_name": "Novo"})
    assert r.status_code == 403
    assert r.json()["code"] == "account_suspended"


def test_api_queries_run_under_rls(database_url, users, make_token, verifier, settings) -> None:
    """Mesmo chamando o repositório com o id de OUTRO usuário, o RLS devolve nada."""
    from app.auth.jwt import user_from_claims
    from app.repositories.profiles import ProfileRepository

    a, b = users.create("A"), users.create("B")
    user_a = user_from_claims({"sub": str(a), "role": "authenticated", "aud": "authenticated"})
    database = Database(database_url, min_size=0, max_size=1)
    database.open()
    try:
        with database.user_transaction(user_a) as conn:
            repo = ProfileRepository(conn)
            assert repo.get_profile(b) is None
            assert repo.update_profile(b, display_name="hack", avatar_url=None) is None
            assert repo.get_profile(a) is not None
            role = conn.execute("select current_user as u").fetchone()["u"]
            assert role == "authenticated"
    finally:
        database.close()
