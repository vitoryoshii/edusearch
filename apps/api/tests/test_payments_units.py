"""Fase 5 sem banco e sem rede: comissão, webhook, cliente AbacatePay e salvaguardas."""

import base64
import hashlib
import hmac
import json

import httpx
import pytest

from app.abacatepay import (
    AbacatePayClient,
    GatewayAuthError,
    GatewayRejectedError,
    GatewayUnavailableError,
    InvalidGatewayResponseError,
    SplitNotEnabledError,
    verify_webhook,
)
from app.config import Settings
from app.payments_rules import COMMISSION_BPS, split_amount
from app.schemas.payments import PayoutAccountIn

SECRET = "s" * 40
PUBLIC = "chave-publica-de-teste"


def sign(body: bytes, key: str = PUBLIC) -> str:
    return base64.b64encode(hmac.new(key.encode(), body, hashlib.sha256).digest()).decode()


# ------------------------------------------------------------------------------- comissão


@pytest.mark.parametrize(
    ("amount", "commission"),
    [(8000, 1200), (2000, 300), (100000, 15000), (101, 15), (110, 17), (3333, 500), (1, 0), (0, 0)],
)
def test_commission_is_exact_integer_half_up(amount, commission) -> None:
    s = split_amount(amount)
    assert COMMISSION_BPS == 1500
    assert s.commission_cents == commission
    assert s.commission_cents + s.teacher_share_cents == amount


def test_commission_matches_frontend_formula_for_every_cent() -> None:
    for amount in range(0, 20001):
        s = split_amount(amount)
        assert s.commission_cents == (amount * 1500 + 5000) // 10000  # mesma conta do commission.ts
        assert s.teacher_share_cents == amount - s.commission_cents


def test_commission_rejects_floats() -> None:
    with pytest.raises(ValueError):
        split_amount(80.5)  # type: ignore[arg-type]


# ------------------------------------------------------------------------------- webhook


def test_webhook_signature_and_secret() -> None:
    body = json.dumps({"id": "evt_1", "event": "transparent.completed"}).encode()
    ok = dict(
        raw_body=body,
        header_secret=SECRET,
        query_secret=None,
        signature=sign(body),
        expected_secret=SECRET,
        public_key=PUBLIC,
    )
    assert verify_webhook(**ok)
    assert verify_webhook(
        **{**ok, "header_secret": None, "query_secret": SECRET}
    )  # segredo na query
    assert not verify_webhook(**{**ok, "raw_body": body + b" "})  # corpo alterado
    assert not verify_webhook(**{**ok, "header_secret": "x" * 40})  # segredo errado
    assert not verify_webhook(**{**ok, "signature": None})  # sem assinatura
    assert not verify_webhook(
        **{**ok, "signature": sign(body, "outra-chave")}
    )  # assinatura forjada
    assert not verify_webhook(**{**ok, "header_secret": None, "query_secret": None})


# ------------------------------------------------------------------------------- cliente


def client_with(handler) -> AbacatePayClient:
    return AbacatePayClient("abc_dev_teste", transport=httpx.MockTransport(handler))


def ok(data) -> httpx.Response:
    return httpx.Response(200, json={"data": data, "success": True, "error": None})


CHARGE = {
    "id": "pix_char_abc123",
    "amount": 8000,
    "status": "PENDING",
    "devMode": True,
    "brCode": "00020101021226...",
    "brCodeBase64": "data:image/png;base64,iVBORw0KGgo=",
    "platformFee": 80,
    "expiresAt": "2026-12-01T12:00:00.000Z",
}


def test_create_pix_sends_documented_contract() -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["Authorization"]
        seen["body"] = json.loads(request.content)
        return ok(CHARGE)

    charge = client_with(handler).create_pix(
        amount=8000,
        description="x" * 300,
        expires_in=120,
        external_id="intent-1",
        metadata={"intent_id": "intent-1"},
        splits=[{"subAccountId": "sacc_abcd1234", "amount": 6800}],
    )
    assert seen["url"] == "https://api.abacatepay.com/v2/transparents/create"
    assert seen["auth"] == "Bearer abc_dev_teste"
    body = seen["body"]
    assert body["method"] == "PIX"
    assert body["data"]["amount"] == 8000 and body["data"]["externalId"] == "intent-1"
    assert len(body["data"]["description"]) == 140  # limite da página Pix
    assert body["data"]["expiresIn"] == 300  # mínimo documentado
    assert body["data"]["splits"] == [{"subAccountId": "sacc_abcd1234", "amount": 6800}]
    assert charge.id == "pix_char_abc123" and charge.dev_mode and charge.platform_fee == 80
    assert charge.br_code_image.startswith("data:image/png;base64,")


def test_invalid_responses_are_rejected_or_sanitized() -> None:
    bad_image = {**CHARGE, "brCodeBase64": "javascript:alert(1)"}
    assert (
        client_with(lambda r: ok(bad_image))
        .create_pix(amount=8000, description="a", expires_in=900, external_id="i", metadata={})
        .br_code_image
        is None
    )
    with pytest.raises(InvalidGatewayResponseError):
        client_with(lambda r: ok({**CHARGE, "status": "WHATEVER"})).check_pix("pix_char_abc123")
    with pytest.raises(InvalidGatewayResponseError):
        client_with(lambda r: ok({**CHARGE, "amount": "8000"})).create_pix(
            amount=8000, description="a", expires_in=900, external_id="i", metadata={}
        )


@pytest.mark.parametrize(
    ("status", "error", "exc"),
    [
        (503, "x", GatewayUnavailableError),
        (429, "Too many requests", GatewayUnavailableError),
        (401, "API key version mismatch", GatewayAuthError),
        (400, "Split para subcontas não está habilitado para esta loja", SplitNotEnabledError),
        (400, "PIX is not available for this store", GatewayRejectedError),
        (422, "Property 'data.amount' is missing", GatewayRejectedError),
    ],
)
def test_errors_are_typed(status, error, exc) -> None:
    c = client_with(
        lambda r: httpx.Response(status, json={"data": None, "success": False, "error": error})
    )
    with pytest.raises(exc):
        c.create_pix(amount=8000, description="a", expires_in=900, external_id="i", metadata={})


def test_network_timeout_is_unknown_outcome() -> None:
    def boom(request):
        raise httpx.ReadTimeout("timeout")

    with pytest.raises(GatewayUnavailableError):
        client_with(boom).check_pix("pix_char_abc123")


def test_simulation_only_with_dev_key() -> None:
    prod = AbacatePayClient("abc_prod_x", transport=httpx.MockTransport(lambda r: ok(CHARGE)))
    with pytest.raises(GatewayRejectedError):
        prod.simulate_payment("pix_char_abc123")


# ------------------------------------------------------------------------------- salvaguardas


BASE = dict(_env_file=None, supabase_url="https://x.supabase.co")


def test_payments_off_by_default_and_guardrails() -> None:
    assert Settings(**BASE).payments_stage == "off"
    with pytest.raises(ValueError, match="abc_dev_"):
        Settings(**BASE, payments_stage="sandbox", abacatepay_api_key="chave_qualquer")
    with pytest.raises(ValueError, match="PRODUÇÃO"):
        Settings(**BASE, payments_stage="sandbox", abacatepay_api_key="abc_prod_x")
    with pytest.raises(ValueError, match="PRODUÇÃO"):
        Settings(**BASE, payments_stage="off", abacatepay_api_key="abc_prod_x")
    with pytest.raises(ValueError, match="APPROVED"):
        Settings(**BASE, payments_stage="production", abacatepay_api_key="abc_prod_x")
    with pytest.raises(ValueError, match="32"):
        Settings(**BASE, abacatepay_webhook_secret="curto")
    ok_sandbox = Settings(
        **BASE,
        payments_stage="sandbox",
        abacatepay_api_key="abc_dev_x",
        abacatepay_webhook_secret=SECRET,
        abacatepay_webhook_public_key=PUBLIC,
    )
    assert ok_sandbox.payments_configured


def test_tax_id_validation() -> None:
    assert PayoutAccountIn(legal_name="Prof Teste", tax_id="529.982.247-25").tax_id == "52998224725"
    for bad in ("111.111.111-11", "529.982.247-24", "123"):
        with pytest.raises(ValueError):
            PayoutAccountIn(legal_name="Prof Teste", tax_id=bad)
