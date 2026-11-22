"""Cliente mínimo do Google OAuth 2.0 (código + PKCE) e da Google Calendar API v3.

* Escopo ÚNICO: ``calendar.events.owned`` (criar/alterar/remover eventos nas agendas do próprio
  professor). Sem leitura de outras agendas, contatos ou e-mail.
* Fluxo separado do login (GIS/ID token): autorização incremental, ``access_type=offline`` para
  obter refresh token. O segredo do cliente só existe na API.
* Eventos com Google Meet via ``conferenceData.createRequest`` (``conferenceDataVersion=1``),
  ``sendUpdates=none`` (nenhum e-mail enviado pelo Google nesta fase) e ID determinístico (o ID
  da aula): repetir a criação nunca duplica o evento.
* O transporte HTTP é injetável (testes sem rede).
"""

import base64
import hashlib
import logging
import re
import secrets
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

import httpx

logger = logging.getLogger("edusearch.api.google")

CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 — URL pública, não é segredo
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

_MEET_URL = re.compile(r"^https://meet\.google\.com/[a-z0-9-]{3,64}$")


class GoogleUnavailableError(Exception):
    """Rede, tempo limite, 5xx ou 429 do Google: tentar de novo depois."""


class CredentialRevokedError(Exception):
    """Refresh token inválido/revogado ou permissão retirada: o professor precisa reconectar."""


class GoogleRequestError(Exception):
    """Requisição recusada pelo Google por outro motivo (4xx)."""

    def __init__(self, status: int, reason: str) -> None:
        super().__init__(f"{status} {reason}")
        self.status = status
        self.reason = reason


@dataclass(frozen=True)
class TokenGrant:
    refresh_token: str | None
    access_token: str
    scopes: list[str]


@dataclass(frozen=True)
class CalendarEvent:
    event_id: str
    meet_url: str | None


def pkce_pair() -> tuple[str, str]:
    """(code_verifier, code_challenge S256)."""
    verifier = secrets.token_urlsafe(64)[:96]
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def meet_url_from(event: dict[str, Any]) -> str | None:
    candidates = [event.get("hangoutLink")]
    for entry in (event.get("conferenceData") or {}).get("entryPoints") or []:
        if isinstance(entry, dict) and entry.get("entryPointType") == "video":
            candidates.append(entry.get("uri"))
    for url in candidates:
        if isinstance(url, str) and _MEET_URL.match(url):
            return url
    return None


def _error_reason(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return ""
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, str):
            return err
        if isinstance(err, dict):
            errors = err.get("errors") or []
            if errors and isinstance(errors[0], dict):
                return str(errors[0].get("reason") or err.get("status") or "")
            return str(err.get("status") or "")
    return ""


class GoogleCalendarClient:
    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        timeout: float = 10.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self.redirect_uri = redirect_uri
        self._http = httpx.Client(timeout=timeout, transport=transport, follow_redirects=False)

    def close(self) -> None:
        self._http.close()

    # ------------------------------------------------------------------ OAuth

    def authorization_url(self, *, state: str, code_challenge: str) -> str:
        params = {
            "client_id": self._client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": CALENDAR_SCOPE,
            "access_type": "offline",
            # Garante um refresh token novo a cada (re)conexão.
            "prompt": "consent",
            # Autorização incremental: soma ao que a conta já concedeu ao app, sem pedir de novo.
            "include_granted_scopes": "true",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        return f"{AUTH_URL}?{urlencode(params)}"

    def _post_form(self, url: str, data: dict[str, str]) -> httpx.Response:
        try:
            response = self._http.post(url, data=data)
        except httpx.HTTPError as exc:
            raise GoogleUnavailableError(exc.__class__.__name__) from exc
        if response.status_code >= 500 or response.status_code == 429:
            raise GoogleUnavailableError(str(response.status_code))
        return response

    def exchange_code(self, *, code: str, code_verifier: str) -> TokenGrant:
        response = self._post_form(
            TOKEN_URL,
            {
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": code_verifier,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "redirect_uri": self.redirect_uri,
            },
        )
        if response.status_code != 200:
            raise GoogleRequestError(response.status_code, _error_reason(response))
        data = response.json()
        return TokenGrant(
            refresh_token=data.get("refresh_token"),
            access_token=str(data.get("access_token") or ""),
            scopes=str(data.get("scope") or "").split(),
        )

    def refresh_access_token(self, refresh_token: str) -> str:
        response = self._post_form(
            TOKEN_URL,
            {
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
        )
        if response.status_code in (400, 401):
            # invalid_grant: revogado, senha trocada ou expirado (app em "teste": 7 dias).
            raise CredentialRevokedError(_error_reason(response))
        if response.status_code != 200:
            raise GoogleRequestError(response.status_code, _error_reason(response))
        token = response.json().get("access_token")
        if not isinstance(token, str) or not token:
            raise GoogleUnavailableError("resposta sem access_token")
        return token

    def revoke(self, token: str) -> None:
        """Revoga no Google (melhor esforço: falha aqui não impede desconectar localmente)."""
        try:
            self._http.post(REVOKE_URL, data={"token": token})
        except httpx.HTTPError:
            logger.warning("falha ao revogar token no Google (ignorado)")

    # ------------------------------------------------------------------ Calendar

    def _calendar(self, method: str, url: str, access_token: str, **kwargs: Any) -> httpx.Response:
        headers = {"Authorization": f"Bearer {access_token}"}
        try:
            response = self._http.request(method, url, headers=headers, **kwargs)
        except httpx.HTTPError as exc:
            raise GoogleUnavailableError(exc.__class__.__name__) from exc
        if response.status_code >= 500 or response.status_code == 429:
            raise GoogleUnavailableError(str(response.status_code))
        if response.status_code == 401:
            raise CredentialRevokedError("unauthorized")
        if response.status_code == 403:
            reason = _error_reason(response)
            if reason in {"rateLimitExceeded", "userRateLimitExceeded"}:
                raise GoogleUnavailableError(reason)
            raise CredentialRevokedError(reason or "forbidden")
        return response

    def create_event(
        self, access_token: str, *, event_id: str, body: dict[str, Any]
    ) -> CalendarEvent:
        params = {"conferenceDataVersion": "1", "sendUpdates": "none"}
        payload = {**body, "id": event_id}
        response = self._calendar("POST", EVENTS_URL, access_token, params=params, json=payload)
        if response.status_code == 409:
            # Já criado numa tentativa anterior (ID determinístico): reaproveita.
            return self.get_event(access_token, event_id=event_id)
        if response.status_code not in (200, 201):
            raise GoogleRequestError(response.status_code, _error_reason(response))
        data = response.json()
        return CalendarEvent(event_id=str(data.get("id") or event_id), meet_url=meet_url_from(data))

    def get_event(self, access_token: str, *, event_id: str) -> CalendarEvent:
        response = self._calendar("GET", f"{EVENTS_URL}/{event_id}", access_token)
        if response.status_code != 200:
            raise GoogleRequestError(response.status_code, _error_reason(response))
        data = response.json()
        return CalendarEvent(event_id=str(data.get("id") or event_id), meet_url=meet_url_from(data))

    def delete_event(self, access_token: str, *, event_id: str) -> None:
        response = self._calendar(
            "DELETE", f"{EVENTS_URL}/{event_id}", access_token, params={"sendUpdates": "none"}
        )
        # 404/410: já removido (pelo professor ou numa tentativa anterior).
        if response.status_code not in (200, 204, 404, 410):
            raise GoogleRequestError(response.status_code, _error_reason(response))
