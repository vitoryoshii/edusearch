from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.concurrency import run_in_threadpool

from app.auth.dependencies import CurrentUser
from app.schemas.common import ErrorResponse
from app.schemas.payments import (
    CheckoutIn,
    PaymentOut,
    PaymentsStatus,
    PayoutAccountIn,
    PayoutAccountOut,
)
from app.services.payments import PaymentsService, get_payments_service

router = APIRouter(tags=["pagamentos"])
Service = Annotated[PaymentsService, Depends(get_payments_service)]

_ERRORS: dict[int | str, dict[str, object]] = {
    401: {
        "model": ErrorResponse,
        "description": "Token ausente/ inválido (ou webhook não autenticado)",
    },
    403: {
        "model": ErrorResponse,
        "description": "Pagamentos desligados, papel ausente ou sem permissão",
    },
    404: {"model": ErrorResponse, "description": "Não encontrado"},
    409: {"model": ErrorResponse, "description": "Conflito (horário, idempotência, estado)"},
    422: {"model": ErrorResponse, "description": "Dados inválidos"},
    503: {"model": ErrorResponse, "description": "Gateway, banco ou configuração indisponível"},
}


@router.get("/v1/payments/status", response_model=PaymentsStatus, responses=_ERRORS)
def payments_status(user: CurrentUser, service: Service) -> PaymentsStatus:
    """Estágio dos pagamentos e regra comercial vigente (comissão em basis points)."""
    return service.status()


@router.post("/v1/payments/checkout", response_model=PaymentOut, status_code=201, responses=_ERRORS)
def checkout(
    payload: CheckoutIn, response: Response, user: CurrentUser, service: Service
) -> PaymentOut:
    """Reserva o horário (aguardando pagamento) e gera o Pix. Valor e comissão vêm do servidor.

    Mesma ``idempotency_key`` → mesma reserva e mesmo Pix (200).
    """
    payment, created = service.checkout(user, payload)
    response.status_code = 201 if created else 200
    return payment


@router.get("/v1/payments/{payment_id}", response_model=PaymentOut, responses=_ERRORS)
def get_payment(payment_id: UUID, user: CurrentUser, service: Service) -> PaymentOut:
    """Estado do pagamento. Pendente: o servidor concilia com o gateway (no máximo a cada 5 s)."""
    return service.get(user, payment_id)


@router.post("/v1/payments/{payment_id}/simulate", response_model=PaymentOut, responses=_ERRORS)
def simulate_payment(payment_id: UUID, user: CurrentUser, service: Service) -> PaymentOut:
    """SÓ sandbox: simula o pagamento no Modo Teste da AbacatePay (nenhum dinheiro real)."""
    return service.simulate(user, payment_id)


@router.get("/v1/me/payments", response_model=list[PaymentOut], responses=_ERRORS)
def my_payments(user: CurrentUser, service: Service) -> list[PaymentOut]:
    return service.history(user)


@router.get("/v1/me/payout-account", response_model=PayoutAccountOut, responses=_ERRORS)
def get_payout_account(user: CurrentUser, service: Service) -> PayoutAccountOut:
    return service.payout_account(user)


@router.put("/v1/me/payout-account", response_model=PayoutAccountOut, responses=_ERRORS)
def put_payout_account(
    payload: PayoutAccountIn, user: CurrentUser, service: Service
) -> PayoutAccountOut:
    """Cria a subconta do professor no gateway. Só os 4 últimos dígitos ficam salvos."""
    return service.save_payout_account(user, payload)


@router.post("/v1/payments/webhooks/abacatepay", responses=_ERRORS)
async def abacatepay_webhook(
    request: Request,
    service: Service,
    webhook_secret: Annotated[str | None, Query(alias="webhookSecret", max_length=200)] = None,
) -> dict[str, object]:
    """Público (sem JWT): autenticado por segredo + assinatura HMAC do CORPO BRUTO."""
    raw = await request.body()
    if len(raw) > 256_000:
        return {"received": False}
    headers = {k.lower(): v for k, v in request.headers.items()}
    result = await run_in_threadpool(service.webhook, raw, headers, webhook_secret)
    return {"received": True, "outcome": result.outcome}
