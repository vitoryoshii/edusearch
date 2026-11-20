"""Rotas /v1/me sem banco: autenticação, contratos, validação e falhas (serviço falso)."""

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.auth.jwt import AuthenticatedUser
from app.db import Database
from app.errors import ApiError, not_found
from app.main import create_app
from app.schemas.me import MeResponse, ProfileUpdate
from app.services.profiles import DbProfileService, get_profile_service

NOW = datetime(2026, 11, 19, 12, 0, tzinfo=UTC)


class FakeProfileService:
    """Guarda perfis em memória, indexados pelo id do token (como o RLS faria)."""

    def __init__(self) -> None:
        self.profiles: dict[uuid.UUID, dict] = {}
        self.calls: list[tuple[str, uuid.UUID]] = []

    def add(self, user_id: uuid.UUID, **fields) -> None:
        self.profiles[user_id] = {
            "display_name": "Pessoa Fictícia",
            "avatar_url": None,
            "status": "onboarding",
            "roles": [],
            **fields,
        }

    def _me(self, user: AuthenticatedUser) -> MeResponse:
        p = self.profiles.get(user.id)
        if p is None:
            raise not_found("profile_not_found", "Perfil não encontrado para esta conta.")
        return MeResponse(id=user.id, email=user.email, created_at=NOW, updated_at=NOW, **p)

    def get_me(self, user: AuthenticatedUser) -> MeResponse:
        self.calls.append(("get", user.id))
        return self._me(user)

    def update_profile(self, user: AuthenticatedUser, data: ProfileUpdate) -> MeResponse:
        self.calls.append(("update", user.id))
        if user.id not in self.profiles:
            return self._me(user)
        self.profiles[user.id].update(display_name=data.display_name, avatar_url=data.avatar_url)
        return self._me(user)


@pytest.fixture
def service() -> FakeProfileService:
    return FakeProfileService()


@pytest.fixture
def client(settings, verifier, service) -> TestClient:
    app = create_app(settings, token_verifier=verifier)
    app.dependency_overrides[get_profile_service] = lambda: service
    return TestClient(app)


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --------------------------------------------------------------------------- autenticação


def test_me_without_token_is_401(client: TestClient, service) -> None:
    r = client.get("/v1/me")
    assert r.status_code == 401
    assert r.json()["code"] == "not_authenticated"
    assert r.headers["www-authenticate"] == "Bearer"
    assert service.calls == []


@pytest.mark.parametrize("header", ["Basic dXNlcjpwYXNz", "Bearer", "Token abc", "bearer"])
def test_malformed_authorization_header_is_401(client: TestClient, header: str) -> None:
    r = client.get("/v1/me", headers={"Authorization": header})
    assert r.status_code == 401


def test_invalid_token_is_401(client: TestClient, make_token, other_key) -> None:
    r = client.get("/v1/me", headers=auth(make_token(key=other_key)))
    assert r.status_code == 401
    assert r.json() == {"detail": "Sessão inválida.", "code": "invalid_token"}


def test_expired_token_is_401_with_code(client: TestClient, make_token) -> None:
    r = client.get("/v1/me", headers=auth(make_token(exp_delta=-3600)))
    assert r.status_code == 401
    assert r.json()["code"] == "token_expired"


def test_auth_not_configured_is_503(settings, make_token) -> None:
    settings.supabase_url = None
    app = create_app(settings)
    r = TestClient(app).get("/v1/me", headers=auth(make_token()))
    assert r.status_code == 503
    assert r.json()["code"] == "auth_not_configured"


# --------------------------------------------------------------------------- GET /v1/me


def test_get_me_returns_only_the_token_owner(client: TestClient, service, make_token) -> None:
    alice, bob = uuid.uuid4(), uuid.uuid4()
    service.add(alice, display_name="Aluna Fictícia", roles=["student"])
    service.add(bob, display_name="Professor Fictício", roles=["teacher"])

    r = client.get("/v1/me", headers=auth(make_token(alice)))
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == str(alice)
    assert body["display_name"] == "Aluna Fictícia"
    assert body["roles"] == ["student"]
    assert set(body) == {
        "id",
        "email",
        "display_name",
        "avatar_url",
        "status",
        "roles",
        "created_at",
        "updated_at",
    }
    assert r.headers["cache-control"] == "no-store"


def test_get_me_ignores_identity_in_query_or_headers(client, service, make_token) -> None:
    alice, bob = uuid.uuid4(), uuid.uuid4()
    service.add(alice)
    service.add(bob, display_name="Outra Pessoa")
    r = client.get(
        f"/v1/me?id={bob}&user_id={bob}",
        headers={**auth(make_token(alice)), "X-User-Id": str(bob)},
    )
    assert r.status_code == 200
    assert r.json()["id"] == str(alice)


def test_get_me_for_user_without_profile_is_404(client: TestClient, make_token) -> None:
    r = client.get("/v1/me", headers=auth(make_token()))
    assert r.status_code == 404
    assert r.json()["code"] == "profile_not_found"


# --------------------------------------------------------------------------- PUT /v1/me/profile


def test_put_profile_updates_allowed_fields(client, service, make_token) -> None:
    alice = uuid.uuid4()
    service.add(alice)
    r = client.put(
        "/v1/me/profile",
        headers=auth(make_token(alice)),
        json={
            "display_name": "  Nome   Novo  ",
            "avatar_url": "https://lh3.googleusercontent.com/a/x",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["display_name"] == "Nome Novo"
    assert r.json()["avatar_url"] == "https://lh3.googleusercontent.com/a/x"


@pytest.mark.parametrize(
    "extra",
    [
        {"id": str(uuid.uuid4())},
        {"user_id": str(uuid.uuid4())},
        {"status": "active"},
        {"roles": ["teacher"]},
        {"role": "admin"},
        {"verification_status": "approved"},
        {"is_published": True},
        {"email": "outro@example.com"},
        {"created_at": "2020-01-01T00:00:00Z"},
        {"app_metadata": {"role": "admin"}},
    ],
)
def test_put_profile_rejects_server_controlled_fields(client, service, make_token, extra) -> None:
    alice = uuid.uuid4()
    service.add(alice)
    r = client.put(
        "/v1/me/profile", headers=auth(make_token(alice)), json={"display_name": "Ok", **extra}
    )
    assert r.status_code == 422
    assert r.json()["code"] == "validation_error"
    assert ("update", alice) not in service.calls
    assert service.profiles[alice]["status"] == "onboarding"
    assert service.profiles[alice]["roles"] == []


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"display_name": ""},
        {"display_name": "   "},
        {"display_name": "x" * 81},
        {"display_name": "Nome\u0000"},
        {"display_name": "Nome‮Invertido"},
        {"display_name": 123},
        {"display_name": "Ok", "avatar_url": "http://lh3.googleusercontent.com/a"},
        {"display_name": "Ok", "avatar_url": "javascript:alert(1)"},
        {"display_name": "Ok", "avatar_url": "https://user:pass@lh3.googleusercontent.com/a"},
        {"display_name": "Ok", "avatar_url": "https://lh3.googleusercontent.com:8443/a"},
        {"display_name": "Ok", "avatar_url": "https://lh3.googleusercontent.com/a b"},
        {"display_name": "Ok", "avatar_url": "https://" + "a" * 2050 + ".com"},
    ],
)
def test_put_profile_validates_payload(client, service, make_token, payload) -> None:
    alice = uuid.uuid4()
    service.add(alice)
    r = client.put("/v1/me/profile", headers=auth(make_token(alice)), json=payload)
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    # O valor enviado não é ecoado na resposta (pode ser dado pessoal).
    assert "input" not in str(body["errors"])


def test_put_profile_rejects_non_json_body(client, make_token) -> None:
    r = client.put(
        "/v1/me/profile",
        headers={**auth(make_token()), "Content-Type": "text/plain"},
        content="display_name=x",
    )
    assert r.status_code == 422


def test_put_profile_requires_auth_before_validation(client) -> None:
    r = client.put("/v1/me/profile", json={"status": "active"})
    assert r.status_code == 401


def test_avatar_host_must_be_allowed(make_token, settings) -> None:
    service = DbProfileService(database=None, avatar_host_suffixes=settings.avatar_host_suffix_list)  # type: ignore[arg-type]
    user = AuthenticatedUser(id=uuid.uuid4(), email=None, session_id=None, claims={})
    with pytest.raises(ApiError) as info:
        service.update_profile(
            user, ProfileUpdate(display_name="Ok", avatar_url="https://tracker.example.com/p.png")
        )
    assert info.value.status_code == 422
    assert info.value.code == "avatar_host_not_allowed"
    assert settings.avatar_host_suffix_list == ["googleusercontent.com", "test-project.supabase.co"]


# --------------------------------------------------------------------------- falhas de banco


def test_database_not_configured_is_503(settings, verifier, make_token) -> None:
    app = create_app(settings, token_verifier=verifier)
    r = TestClient(app).get("/v1/me", headers=auth(make_token()))
    assert r.status_code == 503
    assert r.json()["code"] == "database_unavailable"
    assert r.headers["retry-after"] == "5"


def test_database_unreachable_is_503(settings, verifier, make_token) -> None:
    # Porta 1 em localhost: conexão recusada. Nada de credencial real.
    database = Database(
        "postgresql://ninguem@127.0.0.1:1/inexistente", min_size=0, max_size=1, connect_timeout=1
    )
    app = create_app(settings, token_verifier=verifier, database=database)
    with TestClient(app) as c:
        r = c.get("/v1/me", headers=auth(make_token()))
    assert r.status_code == 503
    assert r.json() == {
        "detail": "Serviço temporariamente indisponível. Tente novamente.",
        "code": "database_unavailable",
    }


def test_unexpected_error_is_500_without_details(settings, verifier, make_token) -> None:
    class Broken:
        def get_me(self, user):
            raise RuntimeError("segredo interno: postgresql://user:senha@host")

    app = create_app(settings, token_verifier=verifier)
    app.dependency_overrides[get_profile_service] = lambda: Broken()
    r = TestClient(app, raise_server_exceptions=False).get("/v1/me", headers=auth(make_token()))
    assert r.status_code == 500
    assert r.json()["code"] == "internal_error"
    assert "senha" not in r.text


# --------------------------------------------------------------------------- CORS


def test_cors_preflight_allows_configured_origin(client: TestClient) -> None:
    r = client.options(
        "/v1/me",
        headers={
            "Origin": "https://app.edusearch.com.br",
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "https://app.edusearch.com.br"
    assert "access-control-allow-credentials" not in r.headers


def test_cors_rejects_unknown_origin(client: TestClient) -> None:
    r = client.options(
        "/v1/me",
        headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "GET"},
    )
    assert "access-control-allow-origin" not in r.headers


def test_unknown_route_uses_error_format(client: TestClient) -> None:
    r = client.get("/v1/nao-existe")
    assert r.status_code == 404
    assert r.json() == {"detail": "Recurso não encontrado.", "code": "not_found"}
