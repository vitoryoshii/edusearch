"""Entrada da API EduSearch em Cloudflare Python Workers.

A aplicação é a MESMA FastAPI de ``apps/api/app`` (copiada para ``src/app`` por
``worker/sync_app.py`` antes de ``pywrangler dev``/``deploy``). Diferenças só de infraestrutura:

* Configuração vem do ``env`` do Worker (``vars`` e secrets), não de ``.env``.
* Banco: ``DirectDatabase`` com os campos do binding Hyperdrive (uma conexão por transação; o
  pool é do Hyperdrive, em modo transação, que faz RESET da sessão ao devolver a conexão).
  O Hyperdrive deve ser criado com ``--caching-disabled``: as leituras dependem do papel e das
  claims da transação e NUNCA podem vir de cache compartilhado.
* O papel de conexão é conferido uma vez por isolate: superusuário ou BYPASSRLS → 503 em tudo.
* Rate limiting opcional (binding ``RATE_LIMITER``), por IP, antes de qualquer processamento.
* Pyodide não cria threads: rotas e dependências síncronas do FastAPI rodam inline (as operações
  de socket do runtime não bloqueiam o event loop). Só neste entrypoint; local nada muda.
* JWKS: buscado de forma assíncrona (fetch do runtime) ANTES de a requisição entrar na FastAPI,
  com o mesmo cache de 10 min; o resolver síncrono só lê esse cache (sem rede nem trava longa).
"""

import json
import logging
import time

from workers import Response, WorkerEntrypoint, asgi
from workers import fetch as runtime_fetch

logger = logging.getLogger("edusearch.api.worker")

_app = None
_role_ok: bool | None = None

JWKS_MAX_AGE_SECONDS = 600  # orientação do Supabase: não guardar o JWKS por mais de 10 min
_jwks: dict | None = None
_jwks_url: str | None = None
_jwks_at = 0.0


def _patch_threadpool() -> None:
    """Executa funções síncronas inline (Pyodide não tem threads)."""
    import fastapi.dependencies.utils as deps  # noqa: PLC0415
    import fastapi.routing as routing  # noqa: PLC0415
    import starlette.concurrency as concurrency  # noqa: PLC0415

    async def run_inline(func, *args, **kwargs):
        return func(*args, **kwargs)

    for module in (concurrency, routing, deps):
        if hasattr(module, "run_in_threadpool"):
            module.run_in_threadpool = run_inline


async def _refresh_jwks(url: str) -> None:
    """Atualiza o cache do JWKS (assíncrono). Falha → mantém o cache anterior (ou vazio)."""
    global _jwks, _jwks_at
    if _jwks is not None and time.monotonic() - _jwks_at < JWKS_MAX_AGE_SECONDS:
        return
    try:
        response = await runtime_fetch(url, redirect="manual")
        if response.status == 200:
            data = await response.json()
            if isinstance(data, dict) and isinstance(data.get("keys"), list):
                _jwks, _jwks_at = data, time.monotonic()
                return
        logger.warning("JWKS respondeu HTTP %s", response.status)
    except Exception as exc:  # noqa: BLE001
        logger.warning("falha ao buscar JWKS: %s", exc.__class__.__name__)


def _cached_jwks(_url: str, _timeout: float) -> dict:
    from app.auth.jwt import JwksUnavailableError  # noqa: PLC0415

    if _jwks is None:
        raise JwksUnavailableError("JWKS ainda não carregado")
    return _jwks


def _get(env, name: str, default: str | None = None) -> str | None:
    value = getattr(env, name, None)
    if value is None:
        return default
    return str(value)


def _build_app(env):
    from app.auth.jwt import JwksKeyResolver, TokenVerifier  # noqa: PLC0415
    from app.config import Settings  # noqa: PLC0415
    from app.db import DirectDatabase  # noqa: PLC0415
    from app.main import create_app  # noqa: PLC0415

    _patch_threadpool()

    settings = Settings(
        _env_file=None,
        environment=_get(env, "API_ENVIRONMENT", "production"),
        cors_origins=_get(env, "API_CORS_ORIGINS", "https://app.edusearch.com.br"),
        supabase_url=_get(env, "API_SUPABASE_URL"),
        jwt_algorithms=_get(env, "API_JWT_ALGORITHMS", "ES256"),
        avatar_allowed_host_suffixes=_get(
            env, "API_AVATAR_ALLOWED_HOST_SUFFIXES", "googleusercontent.com"
        ),
        enable_docs=_get(env, "API_ENABLE_DOCS", "false") == "true",
    )
    database = None
    hd = getattr(env, "HYPERDRIVE", None)
    if hd is not None:
        database = DirectDatabase(
            {
                "host": str(hd.host),
                "port": int(hd.port),
                "user": str(hd.user),
                "password": str(hd.password),
                "dbname": str(hd.database),
                "application_name": "edusearch-api-worker",
            },
            statement_timeout_ms=int(_get(env, "API_DB_STATEMENT_TIMEOUT_MS", "5000")),
        )
    verifier = None
    if settings.jwt_issuer and settings.jwks_url:
        verifier = TokenVerifier(
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            algorithms=settings.jwt_algorithm_list,
            # min_refresh=cache: o resolver nunca vai à rede; o entrypoint mantém o cache.
            key_resolver=JwksKeyResolver(
                settings.jwks_url, cache_seconds=30, min_refresh_seconds=1, fetch=_cached_jwks
            ),
            leeway_seconds=settings.jwt_leeway_seconds,
        )
    # O papel de conexão é conferido aqui (uma vez por isolate), não a cada requisição.
    app = create_app(
        settings, token_verifier=verifier, database=database, check_connection_role=False
    )
    return app, database, settings.jwks_url


def _json(status: int, code: str, detail: str, headers: dict | None = None):
    return Response(
        json.dumps({"detail": detail, "code": code}),
        status=status,
        headers={
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            **(headers or {}),
        },
    )


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        global _app, _role_ok, _jwks_url

        limiter = getattr(self.env, "RATE_LIMITER", None)
        if limiter is not None:
            from pyodide.ffi import to_js  # noqa: PLC0415

            ip = request.headers.get("cf-connecting-ip") or "unknown"
            outcome = await limiter.limit(to_js({"key": ip}))
            if not outcome.success:
                return _json(
                    429,
                    "rate_limited",
                    "Muitas requisições. Aguarde e tente novamente.",
                    {"Retry-After": "10"},
                )

        if _app is None:
            _app, database, _jwks_url = _build_app(self.env)
            if database is not None:
                try:
                    info = database.connection_role()
                    _role_ok = not (info["superuser"] or info["bypassrls"])
                    if not _role_ok:
                        logger.error("papel de conexão privilegiado: %s", info["name"])
                except Exception:  # noqa: BLE001 — banco indisponível: tenta de novo depois
                    _app = None
                    return _json(
                        503,
                        "database_unavailable",
                        "Serviço temporariamente indisponível. Tente novamente.",
                        {"Retry-After": "5"},
                    )

        if _role_ok is False:
            return _json(503, "misconfigured", "Serviço temporariamente indisponível.")

        if _jwks_url and request.headers.get("authorization"):
            await _refresh_jwks(_jwks_url)

        return await asgi.fetch(_app, request, self.env, self.ctx)
