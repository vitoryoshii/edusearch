"""Endpoint máquina-a-máquina do Trust Engine; nunca expõe dados do dossiê."""

import hmac
from typing import Annotated

from fastapi import APIRouter, Header, Request

from app.errors import service_unavailable, unauthorized

router = APIRouter(prefix="/v1/internal/trust", tags=["internal"])


@router.post("/dispatch")
def dispatch_trust_jobs(
    request: Request,
    secret: Annotated[str | None, Header(alias="X-Trust-Dispatch-Secret")] = None,
) -> dict[str, int]:
    settings = request.app.state.settings
    expected = settings.trust_dispatch_secret
    if expected is None or not hmac.compare_digest(secret or "", expected.get_secret_value()):
        raise unauthorized("invalid_dispatch_credentials", "Credencial de serviço inválida.")
    dispatcher = getattr(request.app.state, "trust_dispatcher", None)
    if dispatcher is None:
        raise service_unavailable("trust_engine_not_configured", "Trust Engine não configurado.")
    return dispatcher.dispatch(settings.trust_batch_size)
