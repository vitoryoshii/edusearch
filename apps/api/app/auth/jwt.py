"""Validação criptográfica do access token emitido pelo Supabase Auth.

* Assinatura conferida com a chave pública do JWKS do projeto (ES256 no ``edusearch-db``).
  Só algoritmos assimétricos configurados são aceitos: ``HS256`` e ``none`` são recusados.
* ``iss`` = ``<API_SUPABASE_URL>/auth/v1`` e ``aud`` = ``authenticated``; ``exp``, ``iat``,
  ``iss``, ``aud`` e ``sub`` obrigatórios; ``sub`` precisa ser UUID; ``role`` = ``authenticated``.
* O ID token do Google NÃO é aceito: emissor, público e chave são outros.
* O JWKS fica em memória por até 10 min (orientação do Supabase). Um ``kid`` desconhecido força
  no máximo uma nova busca a cada ``min_refresh_seconds`` (tokens forjados não geram tráfego).
"""

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

import httpx
import jwt
from jwt import PyJWK, PyJWKSet

from app.errors import forbidden, service_unavailable, unauthorized

logger = logging.getLogger("edusearch.api.auth")

MAX_TOKEN_LENGTH = 8192


class JwksUnavailableError(Exception):
    """Não foi possível obter o JWKS (rede, status HTTP ou conteúdo inválido)."""


class UnknownKeyError(Exception):
    """O ``kid`` do token não está no JWKS."""


@dataclass(frozen=True)
class AuthenticatedUser:
    """Usuário autenticado. Somente dados vindos do token VERIFICADO."""

    id: UUID
    email: str | None
    session_id: str | None
    claims: dict[str, Any] = field(repr=False)


def _http_fetch_json(url: str, timeout: float) -> dict[str, Any]:
    try:
        response = httpx.get(url, timeout=timeout, follow_redirects=False)
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise JwksUnavailableError(f"falha ao obter JWKS: {exc.__class__.__name__}") from exc
    if not isinstance(data, dict):
        raise JwksUnavailableError("JWKS inválido")
    return data


class JwksKeyResolver:
    """Resolve ``kid`` → chave pública, com cache e limite de recarga."""

    def __init__(
        self,
        url: str,
        *,
        cache_seconds: int = 600,
        min_refresh_seconds: int = 30,
        timeout_seconds: float = 5.0,
        fetch: Callable[[str, float], dict[str, Any]] = _http_fetch_json,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._url = url
        self._cache_seconds = cache_seconds
        self._min_refresh_seconds = min_refresh_seconds
        self._timeout = timeout_seconds
        self._fetch = fetch
        self._clock = clock
        self._lock = threading.Lock()
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: float | None = None

    def __call__(self, kid: str) -> PyJWK:
        with self._lock:
            now = self._clock()
            if self._fetched_at is None or now - self._fetched_at >= self._cache_seconds:
                self._refresh(now)
            elif kid not in self._keys and now - self._fetched_at >= self._min_refresh_seconds:
                # Possível rotação de chave: recarrega, mas no máximo a cada min_refresh_seconds.
                self._refresh(now)
            key = self._keys.get(kid)
        if key is None:
            raise UnknownKeyError(kid)
        return key

    def _refresh(self, now: float) -> None:
        try:
            data = self._fetch(self._url, self._timeout)
            keyset = PyJWKSet.from_dict(data)
        except JwksUnavailableError:
            raise
        except Exception as exc:  # noqa: BLE001 — conteúdo inesperado vira "indisponível"
            raise JwksUnavailableError(f"JWKS inválido: {exc.__class__.__name__}") from exc
        self._keys = {k.key_id: k for k in keyset.keys if k.key_id}
        self._fetched_at = now


class TokenVerifier:
    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        algorithms: list[str],
        key_resolver: Callable[[str], PyJWK],
        leeway_seconds: int = 10,
    ) -> None:
        symmetric = [a for a in algorithms if a.upper().startswith("HS") or a.lower() == "none"]
        if not algorithms or symmetric:
            raise ValueError("somente algoritmos assimétricos são aceitos")
        self._issuer = issuer
        self._audience = audience
        self._algorithms = list(algorithms)
        self._resolve = key_resolver
        self._leeway = leeway_seconds

    def verify(self, token: str) -> AuthenticatedUser:
        if not token or len(token) > MAX_TOKEN_LENGTH or token.count(".") != 2:
            raise unauthorized()

        try:
            header = jwt.get_unverified_header(token)
        except jwt.InvalidTokenError as exc:
            raise unauthorized() from exc

        alg = header.get("alg")
        kid = header.get("kid")
        if alg not in self._algorithms or not isinstance(kid, str) or not kid:
            raise unauthorized()

        try:
            jwk = self._resolve(kid)
        except UnknownKeyError as exc:
            raise unauthorized() from exc
        except JwksUnavailableError as exc:
            logger.warning("JWKS indisponível: %s", exc)
            raise service_unavailable(
                "auth_unavailable", "Não foi possível validar sua sessão agora. Tente novamente."
            ) from exc

        # A chave do JWKS define o algoritmo; o cabeçalho do token não pode trocá-lo.
        if jwk.algorithm_name != alg:
            raise unauthorized()

        try:
            claims = jwt.decode(
                token,
                key=jwk.key,
                algorithms=[alg],
                audience=self._audience,
                issuer=self._issuer,
                leeway=self._leeway,
                options={"require": ["exp", "iat", "iss", "aud", "sub"], "verify_signature": True},
            )
        except jwt.ExpiredSignatureError as exc:
            raise unauthorized("token_expired", "Sua sessão expirou. Entre novamente.") from exc
        except jwt.InvalidTokenError as exc:
            raise unauthorized() from exc

        return user_from_claims(claims)


def user_from_claims(claims: dict[str, Any]) -> AuthenticatedUser:
    try:
        user_id = UUID(str(claims["sub"]))
    except (KeyError, ValueError) as exc:
        raise unauthorized() from exc

    if claims.get("role") != "authenticated":
        raise unauthorized()
    if claims.get("is_anonymous") is True:
        raise forbidden("anonymous_not_allowed", "Entre com uma conta para continuar.")

    email = claims.get("email")
    session_id = claims.get("session_id")
    return AuthenticatedUser(
        id=user_id,
        email=email if isinstance(email, str) and email else None,
        session_id=session_id if isinstance(session_id, str) else None,
        claims=claims,
    )
