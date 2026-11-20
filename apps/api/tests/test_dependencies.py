"""Dependências reutilizáveis: papéis persistidos e propriedade de recursos."""

import uuid
from typing import Annotated

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth.dependencies import (
    CurrentUser,
    ensure_owner,
    get_user_roles,
    require_role,
)
from app.auth.jwt import AuthenticatedUser
from app.errors import ApiError, install_error_handlers


@pytest.fixture
def roles_by_user() -> dict[uuid.UUID, set[str]]:
    return {}


@pytest.fixture
def client(verifier, roles_by_user) -> TestClient:
    app = FastAPI()
    install_error_handlers(app)
    app.state.token_verifier = verifier

    @app.get("/teacher-area")
    def teacher_area(user: Annotated[AuthenticatedUser, Depends(require_role("teacher"))]) -> dict:
        return {"ok": str(user.id)}

    @app.get("/resources/{owner_id}")
    def resource(owner_id: str, user: CurrentUser) -> dict:
        ensure_owner(user, owner_id)
        return {"owner": owner_id}

    # Papéis "persistidos" simulados; o token NÃO participa da decisão.
    def fake_roles(user: CurrentUser) -> set[str]:
        return roles_by_user.get(user.id, set())

    app.dependency_overrides[get_user_roles] = fake_roles
    return TestClient(app)


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_require_role_allows_persisted_role(client, roles_by_user, make_token) -> None:
    uid = uuid.uuid4()
    roles_by_user[uid] = {"teacher"}
    assert client.get("/teacher-area", headers=_auth(make_token(uid))).status_code == 200


def test_require_role_denies_missing_role(client, roles_by_user, make_token) -> None:
    uid = uuid.uuid4()
    roles_by_user[uid] = {"student"}
    r = client.get("/teacher-area", headers=_auth(make_token(uid)))
    assert r.status_code == 403
    assert r.json()["code"] == "role_required"


def test_role_claims_in_token_metadata_are_ignored(client, make_token) -> None:
    # Papel/admin em user_metadata ou app_metadata do token não concede nada.
    token = make_token(
        user_metadata={"role": "teacher", "is_admin": True},
        app_metadata={"roles": ["teacher", "admin"]},
    )
    assert client.get("/teacher-area", headers=_auth(token)).status_code == 403


def test_require_role_without_token_is_401(client) -> None:
    assert client.get("/teacher-area").status_code == 401


def test_owner_can_access_own_resource(client, make_token) -> None:
    uid = uuid.uuid4()
    assert client.get(f"/resources/{uid}", headers=_auth(make_token(uid))).status_code == 200


def test_other_user_resource_is_403(client, make_token) -> None:
    r = client.get(f"/resources/{uuid.uuid4()}", headers=_auth(make_token(uuid.uuid4())))
    assert r.status_code == 403
    assert r.json()["code"] == "forbidden"


def test_ensure_owner_rejects_garbage_ids() -> None:
    user = AuthenticatedUser(id=uuid.uuid4(), email=None, session_id=None, claims={})
    with pytest.raises(ApiError) as info:
        ensure_owner(user, "../../etc/passwd")
    assert info.value.status_code == 403
