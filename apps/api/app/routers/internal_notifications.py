"""Endpoint máquina-a-máquina da outbox; nunca expõe destinatários."""

import hmac
from typing import Annotated

from fastapi import APIRouter, Header, Request

from app.errors import service_unavailable, unauthorized

router = APIRouter(prefix="/v1/internal/notifications", tags=["internal"])


@router.post("/dispatch")
def dispatch_notifications(
    request: Request,
    secret: Annotated[str | None, Header(alias="X-Notifications-Dispatch-Secret")] = None,
) -> dict[str, int]:
    settings = request.app.state.settings
    expected = settings.notifications_dispatch_secret
    if expected is None or not hmac.compare_digest(secret or "", expected.get_secret_value()):
        raise unauthorized("invalid_dispatch_credentials", "Credencial de serviço inválida.")
    if settings.notifications_stage == "off":
        raise service_unavailable("notifications_disabled", "Notificações desabilitadas.")
    dispatcher = getattr(request.app.state, "notification_dispatcher", None)
    if dispatcher is None:
        raise service_unavailable("notifications_not_configured", "Notificações não configuradas.")
    return dispatcher.dispatch(settings.notifications_batch_size)
