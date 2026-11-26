"""Aplicação FastAPI do EduSearch."""

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.abacatepay import AbacatePayClient
from app.auth.jwt import JwksKeyResolver, TokenVerifier
from app.config import Settings, get_settings
from app.crypto import TokenCipher
from app.db import BaseDatabase, Database
from app.errors import ApiError, install_error_handlers
from app.google_calendar import GoogleCalendarClient
from app.notifications import NotificationDispatcher, ResendClient
from app.routers import admin, health, internal_notifications, me, onboarding, payments, scheduling
from app.services.payments import build_gateway
from app.services.scheduling import build_calendar_client

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


def _check_connection_role(db: BaseDatabase, settings: Settings) -> None:
    """A API deve conectar com um papel SEM superusuário e SEM BYPASSRLS (edusearch_api).

    Em produção, um papel privilegiado impede a inicialização. Fora dela, só avisa (o banco
    local de desenvolvimento costuma usar "postgres").
    """
    try:
        info = db.connection_role()
    except ApiError:
        logger.warning("não foi possível conferir o papel de conexão (banco indisponível)")
        return
    if info["superuser"] or info["bypassrls"]:
        message = f"papel de conexão privilegiado: {info['name']} (use edusearch_api)"
        if settings.environment == "production":
            raise RuntimeError(message)
        logger.warning(message)


def create_app(
    settings: Settings | None = None,
    *,
    token_verifier: TokenVerifier | None = None,
    database: BaseDatabase | None = None,
    check_connection_role: bool = True,
    google_calendar: GoogleCalendarClient | None = None,
    token_cipher: TokenCipher | None = None,
    clock: Callable[[], datetime] | None = None,
    payment_gateway: AbacatePayClient | None = None,
) -> FastAPI:
    """Monta a aplicação. Testes injetam ``token_verifier``, ``database`` e o cliente do Google."""
    settings = settings or get_settings()
    verifier = token_verifier or build_token_verifier(settings)
    db = database if database is not None else build_database(settings)
    if google_calendar is None and token_cipher is None:
        google_calendar, token_cipher = build_calendar_client(settings)
    if payment_gateway is None:
        payment_gateway = build_gateway(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if verifier is None:
            logger.warning("API_SUPABASE_URL ausente: rotas autenticadas responderão 503")
        if db is not None:
            db.open()
            if check_connection_role:
                _check_connection_role(db, settings)
        else:
            logger.warning("API_DATABASE_URL ausente: rotas com banco responderão 503")
        try:
            yield
        finally:
            if db is not None:
                db.close()
            if google_calendar is not None:
                google_calendar.close()
            if payment_gateway is not None:
                payment_gateway.close()

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
    app.state.google_calendar = google_calendar
    app.state.token_cipher = token_cipher
    app.state.payment_gateway = payment_gateway
    # O dispatcher só existe se a operação habilitar explicitamente as notificações; em ``off``
    # o endpoint não processa a fila e nenhum e-mail pode ser enviado.
    app.state.notification_dispatcher = None
    if (
        settings.notifications_stage != "off"
        and settings.notifications_configured
        and db is not None
    ):
        assert settings.resend_api_key is not None  # noqa: S101
        assert settings.resend_from is not None  # noqa: S101
        app.state.notification_dispatcher = NotificationDispatcher(
            db,
            ResendClient(
                settings.resend_api_key.get_secret_value(),
                settings.resend_from,
                timeout=settings.resend_timeout_seconds,
            ),
        )
    if clock is not None:
        app.state.clock = clock

    install_error_handlers(app)

    # Autenticação por cabeçalho Bearer (sem cookies): allow_credentials=False.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        # Somente os métodos efetivamente implementados.
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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
    app.include_router(onboarding.router)
    app.include_router(scheduling.router)
    app.include_router(payments.router)
    app.include_router(internal_notifications.router)
    app.include_router(admin.router)
    return app


app = create_app()
