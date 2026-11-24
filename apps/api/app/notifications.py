"""Cliente mínimo e seguro da API Resend para a outbox transacional.

O despachante persistente é responsável por chamar este cliente; fluxos de negócio nunca
fazem rede diretamente. O payload usa templates publicados no Resend, não HTML gerado pela API.
"""

import logging
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger("edusearch.api.notifications")

_BASE_URL = "https://api.resend.com"
TEMPLATE_VARIABLES: dict[str, frozenset[str]] = {
    "edusearch-boas-vindas-aluno-v1": frozenset({"NOME"}),
    "edusearch-boas-vindas-professor-v1": frozenset({"NOME"}),
    "edusearch-reserva-aguardando-pagamento-v1": frozenset(
        {"CODIGO_RESERVA", "DATA_HORA", "DISCIPLINA", "NOME", "PROFESSOR", "VALOR"}
    ),
    "edusearch-pagamento-aguardando-confirmacao-v1": frozenset(
        {"NOME", "CODIGO_RESERVA", "DISCIPLINA", "DATA_HORA", "VALOR"}
    ),
    "edusearch-pagamento-confirmado-v1": frozenset(
        {"CODIGO_RESERVA", "DATA_HORA", "DISCIPLINA", "ID_TRANSACAO", "NOME", "VALOR"}
    ),
    "edusearch-aula-confirmada-v1": frozenset(
        {"CODIGO_RESERVA", "DATA_HORA", "DISCIPLINA", "FORMATO", "NOME", "PROFESSOR"}
    ),
    "edusearch-cancelamento-v1": frozenset(
        {"CODIGO_RESERVA", "DATA_HORA", "DISCIPLINA", "NOME", "STATUS_REEMBOLSO"}
    ),
    "edusearch-lembrete-aula-v1": frozenset({"DATA_HORA", "DISCIPLINA", "NOME", "PROFESSOR"}),
    "edusearch-seguranca-acesso-v1": frozenset(
        {"DATA_HORA", "LOCAL_APROXIMADO", "NOME", "TIPO_EVENTO"}
    ),
}


class NotificationRetryableError(Exception):
    """Rede, 429 ou 5xx: a outbox preserva a chave e tenta depois."""


class NotificationPermanentError(Exception):
    """Contrato/credencial rejeitado: não repetir indefinidamente."""


@dataclass(frozen=True)
class SentNotification:
    provider_message_id: str


class ResendClient:
    def __init__(self, api_key: str, sender: str, *, timeout: float = 10.0) -> None:
        self._sender = sender
        self._http = httpx.Client(
            base_url=_BASE_URL,
            timeout=timeout,
            follow_redirects=False,
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
        )

    def close(self) -> None:
        self._http.close()

    def send_template(
        self,
        *,
        recipient: str,
        template_alias: str,
        variables: dict[str, str],
        idempotency_key: str,
    ) -> SentNotification:
        required = TEMPLATE_VARIABLES.get(template_alias)
        if (
            required is None
            or set(variables) != required
            or not recipient
            or len(idempotency_key) > 256
        ):
            raise NotificationPermanentError("notification_contract_invalid")
        try:
            response = self._http.post(
                "/emails",
                headers={"Idempotency-Key": idempotency_key},
                json={
                    "from": self._sender,
                    "to": [recipient],
                    "template": {"id": template_alias, "variables": variables},
                },
            )
        except httpx.HTTPError as exc:
            logger.warning("Resend indisponível: %s", exc.__class__.__name__)
            raise NotificationRetryableError("network") from exc
        if response.status_code == 429 or response.status_code >= 500:
            logger.warning("Resend indisponível: HTTP %s", response.status_code)
            raise NotificationRetryableError(f"http_{response.status_code}")
        try:
            body: Any = response.json()
        except ValueError:
            body = None
        message_id = body.get("id") if isinstance(body, dict) else None
        if response.status_code not in {200, 201} or not isinstance(message_id, str):
            # Não registra destinatário, payload, token ou resposta do provedor.
            raise NotificationPermanentError(f"http_{response.status_code}")
        return SentNotification(provider_message_id=message_id)
