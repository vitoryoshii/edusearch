import json

import httpx
import pytest

from app.notifications import (
    NotificationPermanentError,
    NotificationRetryableError,
    ResendClient,
)


def client(handler):
    c = ResendClient("re_test", "EduSearch <notificacoes@mail.edusearch.com.br>")
    c._http = httpx.Client(
        base_url="https://api.resend.com", transport=httpx.MockTransport(handler)
    )
    return c


def test_template_send_uses_published_alias_and_idempotency_header() -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = dict(request.headers)
        seen["payload"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "email_123"})

    sent = client(handler).send_template(
        recipient="student@example.com",
        template_alias="edusearch-boas-vindas-aluno-v1",
        variables={"NOME": "Aluno"},
        idempotency_key="welcome/123",
    )
    assert sent.provider_message_id == "email_123"
    assert seen["headers"]["idempotency-key"] == "welcome/123"
    assert seen["payload"]["template"]["id"] == "edusearch-boas-vindas-aluno-v1"


@pytest.mark.parametrize("status", [429, 500, 503])
def test_transient_provider_errors_are_retryable(status: int) -> None:
    with pytest.raises(NotificationRetryableError):
        client(lambda _: httpx.Response(status)).send_template(
            recipient="student@example.com",
            template_alias="edusearch-boas-vindas-aluno-v1",
            variables={"NOME": "Aluno"},
            idempotency_key="welcome/123",
        )


def test_template_contract_rejects_missing_or_unknown_variables() -> None:
    with pytest.raises(NotificationPermanentError):
        client(lambda _: httpx.Response(200, json={"id": "x"})).send_template(
            recipient="student@example.com",
            template_alias="edusearch-boas-vindas-aluno-v1",
            variables={},
            idempotency_key="welcome/123",
        )
