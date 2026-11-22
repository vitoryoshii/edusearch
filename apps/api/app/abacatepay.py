"""Cliente da AbacatePay API v2 (Pix transparente, subcontas, reembolso) e verificação de webhooks.

Contrato conferido na documentação oficial (docs.abacatepay.com, nov/2026):
* Base única ``https://api.abacatepay.com/v2``; o ambiente vem da CHAVE (``abc_dev_`` = Modo Teste,
  ``abc_prod_`` = produção). ``Authorization: Bearer <chave>``.
* ``POST /transparents/create`` com ``{"method": "PIX", "data": {...}}``: ``amount`` em centavos
  (mín. 100), ``expiresIn`` em segundos (mín. 300), ``externalId`` (idempotência: devolve a cobrança
  pendente existente), ``metadata``, ``splits`` [{subAccountId, amount}] (só Pix; precisa ser
  habilitado pelo suporte).
* ``GET /transparents/check?id=``; ``POST /transparents/simulate-payment?id=`` (só Modo Teste).
* ``POST /sub-accounts/create`` (idempotente pelo CPF/CNPJ); ``POST /transparents/refund``.
* Envelope ``{"data", "success", "error"}``; 400 regra de negócio, 401 chave, 422 schema,
  429 limite.
* Webhook: segredo em ``X-Webhook-Secret`` (ou ``?webhookSecret=``) + ``X-Webhook-Signature`` =
  base64(HMAC-SHA256(corpo bruto, chave pública da AbacatePay)).

Nunca registra a chave, o Pix copia e cola nem dados pessoais nos logs.
"""

import base64
import hashlib
import hmac
import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

logger = logging.getLogger("edusearch.api.abacatepay")

BASE_URL = "https://api.abacatepay.com/v2"
_CHARGE_ID = re.compile(r"^[A-Za-z0-9_-]{4,128}$")
_SACC_ID = re.compile(r"^sacc_[A-Za-z0-9]{4,64}$")
_PNG_DATA_URI = "data:image/png;base64,"
PIX_STATUSES = {
    "PENDING",
    "EXPIRED",
    "CANCELLED",
    "PAID",
    "UNDER_DISPUTE",
    "REFUNDED",
    "REDEEMED",
    "APPROVED",
    "FAILED",
}
_SPLIT_DISABLED = ("split para subcontas não está habilitado", "função não habilitada")


class GatewayUnavailableError(Exception):
    """Rede, tempo limite, 5xx ou 429: o resultado é DESCONHECIDO (pode ter sido criado)."""


class GatewayAuthError(Exception):
    """401: chave inválida, expirada, sem permissão ou de versão errada."""


class GatewayRejectedError(Exception):
    """400/422: o gateway recusou (regra de negócio ou schema)."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"{status}: {message[:200]}")
        self.status = status
        self.message = message


class SplitNotEnabledError(GatewayRejectedError):
    """Split/subcontas ainda não habilitados pelo suporte da AbacatePay nesta loja."""


class InvalidGatewayResponseError(Exception):
    """Resposta fora do contrato (campo ausente ou com tipo errado)."""


@dataclass(frozen=True)
class PixCharge:
    id: str
    status: str
    amount: int
    br_code: str | None
    br_code_image: str | None
    platform_fee: int | None
    expires_at: datetime | None
    dev_mode: bool


@dataclass(frozen=True)
class SubAccount:
    id: str
    tax_id_digits: str
    dev_mode: bool


def _iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise InvalidGatewayResponseError("data inválida") from exc


def _parse_charge(data: Any) -> PixCharge:
    if not isinstance(data, dict):
        raise InvalidGatewayResponseError("data ausente")
    charge_id, status, amount = data.get("id"), data.get("status"), data.get("amount")
    if not isinstance(charge_id, str) or not _CHARGE_ID.match(charge_id):
        raise InvalidGatewayResponseError("id da cobrança inválido")
    if status not in PIX_STATUSES:
        raise InvalidGatewayResponseError("status desconhecido")
    if not isinstance(amount, int) or isinstance(amount, bool):
        raise InvalidGatewayResponseError("amount inválido")
    image = data.get("brCodeBase64")
    if image is not None and (not isinstance(image, str) or not image.startswith(_PNG_DATA_URI)):
        image = None  # só data URI PNG é exibido
    br_code = data.get("brCode") if isinstance(data.get("brCode"), str) else None
    fee = data.get("platformFee")
    return PixCharge(
        id=charge_id,
        status=status,
        amount=amount,
        br_code=br_code,
        br_code_image=image,
        platform_fee=fee if isinstance(fee, int) and not isinstance(fee, bool) else None,
        expires_at=_iso(data.get("expiresAt")),
        dev_mode=bool(data.get("devMode")),
    )


class AbacatePayClient:
    def __init__(
        self, api_key: str, *, timeout: float = 10.0, transport: httpx.BaseTransport | None = None
    ) -> None:
        self._http = httpx.Client(
            base_url=BASE_URL,
            timeout=timeout,
            transport=transport,
            follow_redirects=False,
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
        )
        self.dev_mode = api_key.startswith("abc_dev_")

    def close(self) -> None:
        self._http.close()

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = self._http.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            logger.warning(
                "AbacatePay indisponível (%s %s): %s", method, path, exc.__class__.__name__
            )
            raise GatewayUnavailableError(exc.__class__.__name__) from exc
        status = response.status_code
        try:
            body = response.json()
        except ValueError:
            body = None
        message = str(body.get("error") or "") if isinstance(body, dict) else ""
        if status >= 500 or status == 429:
            logger.warning("AbacatePay %s %s → %s", method, path, status)
            raise GatewayUnavailableError(str(status))
        if status == 401:
            logger.error("AbacatePay recusou a chave (%s %s)", method, path)
            raise GatewayAuthError(message or "unauthorized")
        if status in (400, 422):
            if any(m in message.lower() for m in _SPLIT_DISABLED):
                raise SplitNotEnabledError(status, message)
            raise GatewayRejectedError(status, message)
        if status != 200 or not isinstance(body, dict) or body.get("success") is not True:
            raise InvalidGatewayResponseError(f"resposta inesperada ({status})")
        return body.get("data")

    # ------------------------------------------------------------------ Pix

    def create_pix(
        self,
        *,
        amount: int,
        description: str,
        expires_in: int,
        external_id: str,
        metadata: dict[str, str],
        splits: list[dict[str, Any]] | None = None,
    ) -> PixCharge:
        if amount < 100:
            raise ValueError("valor mínimo de R$ 1,00")
        data: dict[str, Any] = {
            "amount": amount,
            # A página Pix limita a 140 caracteres (o schema aceita 500): fica no menor.
            "description": description[:140],
            "expiresIn": max(300, int(expires_in)),
            "externalId": external_id,
            "metadata": metadata,
        }
        if splits:
            data["splits"] = splits
        charge = _parse_charge(
            self._request("POST", "/transparents/create", json={"method": "PIX", "data": data})
        )
        logger.info("Pix criado: %s (%s, devMode=%s)", charge.id, charge.status, charge.dev_mode)
        return charge

    def check_pix(self, charge_id: str) -> tuple[str, datetime | None]:
        if not _CHARGE_ID.match(charge_id):
            raise ValueError("id inválido")
        data = self._request("GET", "/transparents/check", params={"id": charge_id})
        status = data.get("status") if isinstance(data, dict) else None
        if status not in PIX_STATUSES:
            raise InvalidGatewayResponseError("status desconhecido")
        return status, _iso(data.get("expiresAt"))

    def simulate_payment(self, charge_id: str) -> PixCharge:
        """Só Modo Teste: marca a cobrança como paga e dispara o webhook transparent.completed."""
        if not self.dev_mode:
            raise GatewayRejectedError(400, "simulação só existe no Modo Teste")
        if not _CHARGE_ID.match(charge_id):
            raise ValueError("id inválido")
        return _parse_charge(
            self._request("POST", "/transparents/simulate-payment", params={"id": charge_id})
        )

    def refund(self, charge_id: str, reason: str) -> tuple[str, str]:
        data = self._request(
            "POST", "/transparents/refund", json={"id": charge_id, "reason": reason[:500]}
        )
        if not isinstance(data, dict) or not isinstance(data.get("id"), str):
            raise InvalidGatewayResponseError("reembolso sem id")
        return data["id"], str(data.get("status") or "")

    # ------------------------------------------------------------------ subcontas

    def create_sub_account(self, *, name: str, tax_id: str, external_id: str) -> SubAccount:
        data = self._request(
            "POST",
            "/sub-accounts/create",
            json={"name": name[:100], "taxId": tax_id, "externalId": external_id[:100]},
        )
        if (
            not isinstance(data, dict)
            or not isinstance(data.get("id"), str)
            or not _SACC_ID.match(data["id"])
        ):
            raise InvalidGatewayResponseError("subconta sem id")
        digits = re.sub(r"\D", "", str(data.get("taxId") or tax_id))
        return SubAccount(id=data["id"], tax_id_digits=digits, dev_mode=bool(data.get("devMode")))


# ---------------------------------------------------------------------- webhooks


def verify_webhook(
    raw_body: bytes,
    *,
    header_secret: str | None,
    query_secret: str | None,
    signature: str | None,
    expected_secret: str,
    public_key: str,
) -> bool:
    """Segredo (header OU query) E assinatura HMAC-SHA256/base64 do corpo bruto. Tempo constante."""
    provided = header_secret or query_secret or ""
    secret_ok = hmac.compare_digest(provided.encode(), expected_secret.encode())
    digest = hmac.new(public_key.encode("utf-8"), raw_body, hashlib.sha256).digest()
    expected_sig = base64.b64encode(digest).decode("ascii")
    sig_ok = hmac.compare_digest(expected_sig.encode(), (signature or "").encode())
    return secret_ok and sig_ok
