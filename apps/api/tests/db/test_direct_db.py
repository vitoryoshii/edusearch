"""DirectDatabase (modo Cloudflare Workers + Hyperdrive): uma conexão por transação.

Mesmas garantias do pool: SET LOCAL ROLE, claims verificadas e RLS, conectando como
edusearch_api. Nenhum estado de sessão sobrevive entre transações.
"""

import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import conninfo_to_dict

from app.db import DirectDatabase
from app.main import create_app
from tests.test_onboarding_api import STUDENT


@pytest.fixture
def direct(api_database_url) -> DirectDatabase:
    params = conninfo_to_dict(api_database_url)
    return DirectDatabase(params, connect_timeout=5)


@pytest.fixture
def client(settings, verifier, direct):
    app = create_app(
        settings, token_verifier=verifier, database=direct, check_connection_role=False
    )
    with TestClient(app) as c:
        yield c


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_connection_role_is_not_privileged(direct) -> None:
    info = direct.connection_role()
    assert info == {"name": "edusearch_api", "superuser": False, "bypassrls": False}


def test_flow_and_isolation_with_direct_connections(client, users, make_token) -> None:
    a, b = users.create("A"), users.create("B")
    ta, tb = make_token(a), make_token(b)
    assert (
        client.post("/v1/me/roles", json={"role": "student"}, headers=auth(ta)).status_code == 201
    )
    assert client.put("/v1/me/student-profile", json=STUDENT, headers=auth(ta)).status_code == 200
    assert client.get("/v1/me/student-profile", headers=auth(ta)).json()["subjects"]
    # B: outra conexão, outras claims — nada de A aparece.
    assert client.get("/v1/me/student-profile", headers=auth(tb)).status_code == 403
    assert client.get("/v1/me", headers=auth(tb)).json()["id"] == str(b)


def test_no_session_state_leaks_between_transactions(direct, users) -> None:
    from app.auth.jwt import user_from_claims

    a = users.create()
    user = user_from_claims({"sub": str(a), "role": "authenticated", "aud": "authenticated"})
    with direct.user_transaction(user) as conn:
        assert conn.execute("select current_user as u").fetchone()["u"] == "authenticated"
    # Nova transação/conexão sem claims: papel e claims anteriores não existem mais.
    with direct._connection() as conn:  # noqa: SLF001
        row = conn.execute(
            "select current_user as u, current_setting('request.jwt.claims', true) as c"
        ).fetchone()
        assert row[0] == "edusearch_api"
        assert row[1] in (None, "")


def test_direct_database_unreachable_is_503(settings, verifier, make_token) -> None:
    db = DirectDatabase(
        {"host": "127.0.0.1", "port": 1, "user": "x", "dbname": "x"}, connect_timeout=1
    )
    app = create_app(settings, token_verifier=verifier, database=db, check_connection_role=False)
    r = TestClient(app).get("/v1/me", headers=auth(make_token()))
    assert (r.status_code, r.json()["code"]) == (503, "database_unavailable")
