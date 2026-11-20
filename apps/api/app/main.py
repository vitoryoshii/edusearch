"""Aplicação FastAPI do EduSearch."""

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.auth.jwt import JwksKeyResolver, TokenVerifier
from app.config import Settings, get_settings
from app.db import Database
from app.errors import install_error_handlers
from app.routers import health, me

logger = logging.getLogger("edusearch.api")


def build_token_verifier(settings: Settings) -> TokenVerifier | None:
    if not settings.jwt_issuer or not settings.jwks_url:
        return None
    resolver = JwksKeyResolver(
        settings.jwks_url,
        cache_seconds=settings.jwks_cache_seconds,
        min_refresh_seconds=settings.jwks_min_refresh_seconds,
        timeout_seconds=settings.jwks_timeout_seconds,
    )
    return TokenVerifier(
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
        algorithms=settings.jwt_algorithm_list,
        key_resolver=resolver,
        leeway_seconds=settings.jwt_leeway_seconds,
    )


def build_database(settings: Settings) -> Database | None:
    if settings.database_url is None:
        return None
    return Database(
        settings.database_url.get_secret_value(),
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
        connect_timeout=settings.db_connect_timeout_seconds,
        statement_timeout_ms=settings.db_statement_timeout_ms,
    )


def create_app(
    settings: Settings | None = None,
    *,
    token_verifier: TokenVerifier | None = None,
    database: Database | None = None,
) -> FastAPI:
    """Monta a aplicação. Testes injetam ``token_verifier`` e ``database``."""
    settings = settings or get_settings()
    verifier = token_verifier or build_token_verifier(settings)
    db = database if database is not None else build_database(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if verifier is None:
            logger.warning("API_SUPABASE_URL ausente: rotas autenticadas responderão 503")
        if db is not None:
            db.open()
        else:
            logger.warning("API_DATABASE_URL ausente: rotas com banco responderão 503")
        try:
            yield
        finally:
            if db is not None:
                db.close()

    app = FastAPI(
        title="EduSearch API",
        description="API do EduSearch — Encontre o professor certo para você.",
        version=__version__,
        lifespan=lifespan,
        docs_url="/docs" if settings.enable_docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.enable_docs else None,
    )
    app.state.settings = settings
    app.state.token_verifier = verifier
    app.state.database = db

    install_error_handlers(app)

    # Autenticação por cabeçalho Bearer (sem cookies): allow_credentials=False.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "PUT", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )

    @app.middleware("http")
    async def _no_store(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/v1/"):
            # Respostas com dados pessoais não devem ficar em cache de navegador ou proxy.
            response.headers["Cache-Control"] = "no-store"
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        return response

    app.include_router(health.router)
    app.include_router(me.router)
    return app


app = create_app()
