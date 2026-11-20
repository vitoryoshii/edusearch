"""Validação do JWT do Supabase: assinatura, emissor, público, expiração e identidade."""

import base64
import json
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth.jwt import (
    JwksKeyResolver,
    JwksUnavailableError,
    TokenVerifier,
    UnknownKeyError,
)
from app.errors import ApiError
from tests.conftest import ISSUER, KID


def _expect(status: int, code: str, fn, *args):
    with pytest.raises(ApiError) as info:
        fn(*args)
    assert info.value.status_code == status
    assert info.value.code == code
    return info.value


def test_valid_token_returns_identity(verifier: TokenVerifier, make_token) -> None:
    user_id = uuid.uuid4()
    user = verifier.verify(make_token(user_id))
    assert user.id == user_id
    assert user.email == "aluno.ficticio@example.com"
    assert user.claims["aud"] == "authenticated"


def test_expired_token_is_rejected(verifier: TokenVerifier, make_token) -> None:
    err = _expect(401, "token_expired", verifier.verify, make_token(exp_delta=-120))
    assert err.headers and "invalid_token" in err.headers["WWW-Authenticate"]


def test_signature_from_unknown_key_is_rejected(verifier, make_token, other_key) -> None:
    _expect(401, "invalid_token", verifier.verify, make_token(key=other_key))


def test_tampered_payload_is_rejected(verifier: TokenVerifier, make_token) -> None:
    header, payload, signature = make_token().split(".")
    claims = json.loads(base64.urlsafe_b64decode(payload + "=="))
    claims["sub"] = str(uuid.uuid4())
    forged = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    _expect(401, "invalid_token", verifier.verify, f"{header}.{forged}.{signature}")


@pytest.mark.parametrize(
    "overrides",
    [
        {"iss": "https://outro-projeto.supabase.co/auth/v1"},
        {"iss": "https://accounts.google.com"},
        {"aud": "anon"},
        {"aud": "123-cliente.apps.googleusercontent.com"},
        {"role": "anon"},
        {"role": "service_role"},
        {"sub": "nao-e-uuid"},
        {"iat": "ontem"},
    ],
)
def test_wrong_claims_are_rejected(verifier, make_token, overrides) -> None:
    _expect(401, "invalid_token", verifier.verify, make_token(**overrides))


@pytest.mark.parametrize("claim", ["exp", "iat", "sub", "aud", "iss"])
def test_missing_required_claim_is_rejected(verifier, make_token, claim) -> None:
    _expect(401, "invalid_token", verifier.verify, make_token(drop=(claim,)))


def test_anonymous_user_is_forbidden(verifier: TokenVerifier, make_token) -> None:
    _expect(403, "anonymous_not_allowed", verifier.verify, make_token(is_anonymous=True))


def test_hs256_token_is_rejected(verifier: TokenVerifier, make_token) -> None:
    # Token "legado" assinado com segredo compartilhado: o algoritmo não é aceito.
    token = make_token(key="segredo-ficticio-com-pelo-menos-32-bytes!!", alg="HS256")
    _expect(401, "invalid_token", verifier.verify, token)


def test_alg_none_is_rejected(verifier: TokenVerifier) -> None:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "kid": KID}).encode())
    body = base64.urlsafe_b64encode(json.dumps({"sub": str(uuid.uuid4()), "iss": ISSUER}).encode())
    token = f"{header.rstrip(b'=').decode()}.{body.rstrip(b'=').decode()}."
    _expect(401, "invalid_token", verifier.verify, token)


def test_alg_header_cannot_differ_from_jwk(jwks, make_token) -> None:
    # Mesmo que o verificador aceite RS256, a chave do kid é EC (ES256): o token RS256 é recusado.
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    resolver = JwksKeyResolver("https://x/jwks", fetch=lambda _u, _t: jwks)
    verifier = TokenVerifier(
        issuer=ISSUER,
        audience="authenticated",
        algorithms=["ES256", "RS256"],
        key_resolver=resolver,
    )
    _expect(401, "invalid_token", verifier.verify, make_token(key=rsa_key, alg="RS256"))


def test_google_id_token_shape_is_rejected(verifier: TokenVerifier) -> None:
    # Um ID token do Google (RS256, outra chave, outro emissor/público) nunca é aceito.
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": "123-cliente.apps.googleusercontent.com",
            "sub": "109876543210987654321",
            "email": "pessoa.ficticia@example.com",
            "exp": 9999999999,
            "iat": 1700000000,
        },
        rsa_key,
        algorithm="RS256",
        headers={"kid": "google-kid"},
    )
    _expect(401, "invalid_token", verifier.verify, token)


def test_missing_kid_is_rejected(verifier: TokenVerifier, make_token) -> None:
    _expect(401, "invalid_token", verifier.verify, make_token(kid=None))


def test_unknown_kid_is_rejected(verifier: TokenVerifier, make_token) -> None:
    _expect(401, "invalid_token", verifier.verify, make_token(kid="kid-desconhecido"))


@pytest.mark.parametrize("token", ["", "abc", "a.b", "a.b.c.d", "x" * 9000, "eyJ.eyJ.sig"])
def test_malformed_tokens_are_rejected(verifier: TokenVerifier, token: str) -> None:
    _expect(401, "invalid_token", verifier.verify, token)


def test_jwks_unavailable_returns_503(make_token) -> None:
    def broken(_u, _t):
        raise JwksUnavailableError("rede fora")

    verifier = TokenVerifier(
        issuer=ISSUER,
        audience="authenticated",
        algorithms=["ES256"],
        key_resolver=JwksKeyResolver("https://x/jwks", fetch=broken),
    )
    _expect(503, "auth_unavailable", verifier.verify, make_token())


def test_verifier_refuses_symmetric_algorithms() -> None:
    with pytest.raises(ValueError):
        TokenVerifier(issuer=ISSUER, audience="a", algorithms=["HS256"], key_resolver=lambda k: k)
    with pytest.raises(ValueError):
        TokenVerifier(issuer=ISSUER, audience="a", algorithms=["none"], key_resolver=lambda k: k)


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_jwks_cache_and_refresh_throttle(jwks) -> None:
    calls: list[str] = []

    def fetch(url: str, _t: float):
        calls.append(url)
        return jwks

    clock = _Clock()
    resolver = JwksKeyResolver(
        "https://x/jwks", cache_seconds=600, min_refresh_seconds=30, fetch=fetch, clock=clock
    )
    assert resolver(KID).key_id == KID
    assert resolver(KID).key_id == KID
    assert len(calls) == 1  # cache

    with pytest.raises(UnknownKeyError):
        resolver("novo-kid")
    assert len(calls) == 1  # kid desconhecido dentro da janela mínima: sem nova busca

    clock.now += 31
    with pytest.raises(UnknownKeyError):
        resolver("novo-kid")
    assert len(calls) == 2  # janela mínima passou: busca de novo (rotação de chave)

    clock.now += 600
    resolver(KID)
    assert len(calls) == 3  # cache expirou (máximo de 10 min)


def test_jwks_invalid_payload_is_unavailable() -> None:
    resolver = JwksKeyResolver("https://x/jwks", fetch=lambda _u, _t: {"keys": "lixo"})
    with pytest.raises(JwksUnavailableError):
        resolver(KID)
