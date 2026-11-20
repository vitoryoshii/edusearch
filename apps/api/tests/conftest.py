"""Fixtures comuns: chaves ES256 efêmeras, JWKS local e fábrica de tokens.

Nenhum teste usa credenciais reais: as chaves são geradas em memória a cada execução e o JWKS é
servido por uma função local (sem rede).
"""

import json
import time
import uuid
from collections.abc import Callable
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

from app.auth.jwt import JwksKeyResolver, TokenVerifier
from app.config import Settings

SUPABASE_URL = "https://test-project.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
KID = "test-key-1"


def _public_jwk(private_key: ec.EllipticCurvePrivateKey, kid: str) -> dict[str, Any]:
    jwk = json.loads(ECAlgorithm.to_jwk(private_key.public_key()))
    jwk.update({"kid": kid, "alg": "ES256", "use": "sig"})
    return jwk


@pytest.fixture(scope="session")
def signing_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture(scope="session")
def other_key() -> ec.EllipticCurvePrivateKey:
    """Chave que NÃO está no JWKS (simula token forjado)."""
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture(scope="session")
def jwks(signing_key: ec.EllipticCurvePrivateKey) -> dict[str, Any]:
    return {"keys": [_public_jwk(signing_key, KID)]}


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        supabase_url=SUPABASE_URL,
        cors_origins="http://localhost:5174,https://app.edusearch.com.br",
        database_url=None,
    )


@pytest.fixture
def verifier(jwks: dict[str, Any]) -> TokenVerifier:
    resolver = JwksKeyResolver(ISSUER + "/.well-known/jwks.json", fetch=lambda _u, _t: jwks)
    return TokenVerifier(
        issuer=ISSUER, audience="authenticated", algorithms=["ES256"], key_resolver=resolver
    )


TokenFactory = Callable[..., str]


@pytest.fixture
def make_token(signing_key: ec.EllipticCurvePrivateKey) -> TokenFactory:
    def _make(
        sub: str | uuid.UUID | None = None,
        *,
        key: Any = None,
        kid: str | None = KID,
        alg: str = "ES256",
        exp_delta: int = 3600,
        drop: tuple[str, ...] = (),
        **overrides: Any,
    ) -> str:
        now = int(time.time())
        claims: dict[str, Any] = {
            "iss": ISSUER,
            "aud": "authenticated",
            "sub": str(sub or uuid.uuid4()),
            "exp": now + exp_delta,
            "iat": now - 5,
            "role": "authenticated",
            "aal": "aal1",
            "session_id": str(uuid.uuid4()),
            "email": "aluno.ficticio@example.com",
            "is_anonymous": False,
        }
        claims.update(overrides)
        for name in drop:
            claims.pop(name, None)
        headers = {"kid": kid} if kid is not None else {}
        return jwt.encode(
            claims, key if key is not None else signing_key, algorithm=alg, headers=headers
        )

    return _make
