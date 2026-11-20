"""Formato único de erro da API.

Corpo: ``{"detail": "<mensagem em português>", "code": "<código estável>"}``. O frontend já exibe
``detail`` quando é texto (``apps/web/src/lib/api/client.ts``); ``code`` serve para decisões no
código. Erros de validação acrescentam ``errors`` (lista com ``loc``, ``msg`` e ``type``).
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("edusearch.api")


class ApiError(Exception):
    """Erro de negócio/segurança com status HTTP, código estável e mensagem para o usuário."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers


def unauthorized(code: str = "invalid_token", message: str = "Sessão inválida.") -> ApiError:
    headers = {"WWW-Authenticate": 'Bearer error="invalid_token"'}
    return ApiError(401, code, message, headers=headers)


def missing_credentials() -> ApiError:
    return ApiError(
        401, "not_authenticated", "Faça login para continuar.", {"WWW-Authenticate": "Bearer"}
    )


def forbidden(
    code: str = "forbidden", message: str = "Você não tem permissão para esta ação."
) -> ApiError:
    return ApiError(403, code, message)


def not_found(code: str, message: str) -> ApiError:
    return ApiError(404, code, message)


def service_unavailable(code: str, message: str) -> ApiError:
    return ApiError(503, code, message, headers={"Retry-After": "5"})


def _body(code: str, message: str, **extra: object) -> dict[str, object]:
    return {"detail": message, "code": code, **extra}


_HTTP_CODES = {
    404: ("not_found", "Recurso não encontrado."),
    405: ("method_not_allowed", "Método não permitido."),
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code, content=_body(exc.code, exc.message), headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Nunca devolve o valor recebido ("input"): pode conter dado pessoal.
        errors = [
            {"loc": list(e.get("loc", ())), "msg": e.get("msg", ""), "type": e.get("type", "")}
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=_body("validation_error", "Dados inválidos.", errors=errors),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        default = ("http_error", "Não foi possível concluir.")
        code, message = _HTTP_CODES.get(exc.status_code, default)
        return JSONResponse(
            status_code=exc.status_code, content=_body(code, message), headers=exc.headers
        )

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        logger.error("erro inesperado: %s", exc.__class__.__name__, exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=_body("internal_error", "O servidor encontrou um problema. Tente novamente."),
        )
