"""Unidades da Fase 3A sem banco e sem rede: cifragem, regras de agenda e cliente do Google."""

import json
import time
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.config import Settings
from app.crypto import DecryptionError, TokenCipher, generate_key
from app.google_calendar import (
    CALENDAR_SCOPE,
    CredentialRevokedError,
    GoogleCalendarClient,
    GoogleRequestError,
    GoogleUnavailableError,
    meet_url_from,
    pkce_pair,
)
from app.scheduling import (
    LOCAL_TZ,
    InvalidWindowsError,
    Window,
    available_slots,
    booking_problem,
    normalize_windows,
)

# ------------------------------------------------------------------------------- cifragem


def test_token_roundtrip_and_binding_to_owner() -> None:
    cipher = TokenCipher(generate_key())
    owner = uuid.uuid4()
    blob = cipher.encrypt_token("1//refresh-ficticio", owner=owner)
    assert b"refresh-ficticio" not in blob
    assert cipher.decrypt_token(blob, owner=owner, key_version=1) == "1//refresh-ficticio"
    # O mesmo texto cifrado copiado para OUTRA conta não decifra (AAD com o dono).
    with pytest.raises(DecryptionError):
        cipher.decrypt_token(blob, owner=uuid.uuid4(), key_version=1)


def test_token_tampering_and_wrong_key_are_rejected() -> None:
    cipher = TokenCipher(generate_key())
    owner = uuid.uuid4()
    blob = bytearray(cipher.encrypt_token("segredo", owner=owner))
    blob[-1] ^= 0x01
    with pytest.raises(DecryptionError):
        cipher.decrypt_token(bytes(blob), owner=owner, key_version=1)
    other = TokenCipher(generate_key())
    with pytest.raises(DecryptionError):
        other.decrypt_token(cipher.encrypt_token("x", owner=owner), owner=owner, key_version=1)
    with pytest.raises(DecryptionError):
        cipher.decrypt_token(cipher.encrypt_token("x", owner=owner), owner=owner, key_version=2)


def test_key_must_be_32_bytes() -> None:
    with pytest.raises(ValueError):
        TokenCipher("curta")


def test_state_seal_open_tamper_and_expiry() -> None:
    cipher = TokenCipher(generate_key())
    state = cipher.seal_state({"sub": "abc", "cv": "verifier"})
    assert "verifier" not in state  # nada legível no navegador
    assert cipher.open_state(state)["sub"] == "abc"
    with pytest.raises(DecryptionError):
        cipher.open_state(state[:-2] + ("A" if state[-2] != "A" else "B") + state[-1])
    expired = cipher.seal_state({"sub": "abc"}, ttl=-1)
    with pytest.raises(DecryptionError):
        cipher.open_state(expired)
    with pytest.raises(DecryptionError):
        cipher.open_state("")


# ------------------------------------------------------------------------------- regras de agenda

NOW = datetime(2026, 12, 1, 12, 0, tzinfo=UTC)  # terça, 09:00 em São Paulo
FULL_WEEK = [Window(d, 0, 1440) for d in ("seg", "ter", "qua", "qui", "sex", "sab", "dom")]


def local(y: int, m: int, d: int, hh: int, mm: int = 0) -> datetime:
    return datetime(y, m, d, hh, mm, tzinfo=LOCAL_TZ)


def test_windows_reject_overlap_granularity_and_order() -> None:
    assert normalize_windows([Window("qua", 600, 720), Window("seg", 480, 540)])[0].weekday == "seg"
    with pytest.raises(InvalidWindowsError):
        normalize_windows([Window("seg", 480, 600), Window("seg", 540, 660)])
    with pytest.raises(InvalidWindowsError):
        normalize_windows([Window("seg", 481, 600)])
    with pytest.raises(InvalidWindowsError):
        normalize_windows([Window("seg", 600, 600)])
    # Janelas encostadas (sem sobreposição) são válidas.
    assert len(normalize_windows([Window("seg", 480, 600), Window("seg", 600, 720)])) == 2


def test_booking_rules() -> None:
    windows = [Window("qua", 14 * 60, 18 * 60)]
    ok = local(2026, 12, 2, 14)  # quarta 14:00
    assert booking_problem(ok, 60, windows, [], now=NOW) is None
    assert booking_problem(local(2026, 12, 2, 17, 30), 60, windows, [], now=NOW) is not None
    assert booking_problem(local(2026, 12, 3, 14), 60, windows, [], now=NOW) is not None
    assert "antecedência" in booking_problem(
        NOW + timedelta(minutes=30), 30, FULL_WEEK, [], now=NOW
    )
    assert "60 dias" in booking_problem(NOW + timedelta(days=61), 30, FULL_WEEK, [], now=NOW)
    busy = [(ok + timedelta(minutes=30), ok + timedelta(minutes=90))]
    assert booking_problem(ok, 60, windows, busy, now=NOW) == "horário indisponível"
    # Encostado no fim de uma aula ocupada: livre (intervalos semiabertos).
    assert booking_problem(ok + timedelta(minutes=90), 60, windows, busy, now=NOW) is None
    assert (
        booking_problem(local(2026, 12, 2, 14, 7), 60, windows, [], now=NOW) == "horário inválido"
    )


def test_available_slots_respect_notice_busy_and_windows() -> None:
    windows = [Window("ter", 9 * 60, 12 * 60), Window("qua", 14 * 60, 16 * 60)]
    busy = [(local(2026, 12, 2, 14).astimezone(UTC), local(2026, 12, 2, 15).astimezone(UTC))]
    slots = available_slots(windows, 60, busy, now=NOW, days=1)
    as_local = [s.astimezone(LOCAL_TZ).strftime("%a %H:%M") for s in slots]
    # Terça 09:00 local = agora: só a partir de 11:00 (2h de antecedência); 11:00–12:00 cabe.
    assert as_local == ["Tue 11:00", "Wed 15:00"]
    assert all(s.tzinfo is not None for s in slots)


# ------------------------------------------------------------------------------- cliente do Google


class FakeGoogleHttp:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.events: dict[str, dict] = {}
        self.refresh_status = 200
        self.event_status: int | None = None
        self.pending_meet = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        if url.startswith("https://oauth2.googleapis.com/token"):
            form = parse_qs(request.content.decode())
            if form["grant_type"] == ["authorization_code"]:
                return httpx.Response(
                    200,
                    json={"access_token": "at", "refresh_token": "rt", "scope": CALENDAR_SCOPE},
                )
            if self.refresh_status != 200:
                return httpx.Response(self.refresh_status, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": "at2", "expires_in": 3599})
        if "calendar/v3" in url:
            if self.event_status:
                return httpx.Response(self.event_status, json={"error": {"status": "X"}})
            event_id = url.split("/events")[1].strip("/").split("?")[0]
            if request.method == "POST":
                body = json.loads(request.content)
                if body["id"] in self.events:
                    return httpx.Response(
                        409, json={"error": {"errors": [{"reason": "duplicate"}]}}
                    )
                ev = {"id": body["id"]}
                if not self.pending_meet:
                    ev["hangoutLink"] = "https://meet.google.com/abc-defg-hij"
                self.events[body["id"]] = ev
                return httpx.Response(200, json=ev)
            if request.method == "GET":
                ev = self.events.get(event_id)
                if ev is not None and "hangoutLink" not in ev:
                    ev["hangoutLink"] = "https://meet.google.com/xyz-uvwx-rst"
                return httpx.Response(200 if ev else 404, json=ev or {})
            if request.method == "DELETE":
                return httpx.Response(204 if self.events.pop(event_id, None) else 410)
        return httpx.Response(200)


def make_client(fake: FakeGoogleHttp) -> GoogleCalendarClient:
    return GoogleCalendarClient(
        client_id="cid.apps.googleusercontent.com",
        client_secret="segredo-de-teste",
        redirect_uri="https://app.example.com/conta/agenda/google/retorno",
        transport=httpx.MockTransport(fake),
    )


def test_authorization_url_minimal_scope_pkce_offline() -> None:
    _, challenge = pkce_pair()
    url = make_client(FakeGoogleHttp()).authorization_url(state="st", code_challenge=challenge)
    q = parse_qs(urlsplit(url).query)
    assert q["scope"] == [CALENDAR_SCOPE]
    assert q["access_type"] == ["offline"] and q["include_granted_scopes"] == ["true"]
    assert q["code_challenge_method"] == ["S256"] and q["code_challenge"] == [challenge]
    assert "client_secret" not in q  # o segredo nunca vai para o navegador


def test_create_event_is_idempotent_and_waits_for_meet() -> None:
    fake = FakeGoogleHttp()
    client = make_client(fake)
    ev = client.create_event("at", event_id="a" * 32, body={"summary": "x"})
    assert ev.meet_url == "https://meet.google.com/abc-defg-hij"
    params = parse_qs(urlsplit(str(fake.requests[-1].url)).query)
    assert params == {"conferenceDataVersion": ["1"], "sendUpdates": ["none"]}
    # Repetir com o mesmo ID (409) devolve o evento existente, sem duplicar.
    again = client.create_event("at", event_id="a" * 32, body={"summary": "x"})
    assert again.event_id == "a" * 32 and len(fake.events) == 1
    client.delete_event("at", event_id="a" * 32)
    client.delete_event("at", event_id="a" * 32)  # 410: já removido, sem erro
    assert fake.events == {}


def test_refresh_revoked_and_google_errors() -> None:
    fake = FakeGoogleHttp()
    client = make_client(fake)
    assert client.refresh_access_token("rt") == "at2"
    fake.refresh_status = 400
    with pytest.raises(CredentialRevokedError):
        client.refresh_access_token("rt")
    fake.event_status = 503
    with pytest.raises(GoogleUnavailableError):
        client.create_event("at", event_id="b" * 32, body={})
    fake.event_status = 401
    with pytest.raises(CredentialRevokedError):
        client.create_event("at", event_id="b" * 32, body={})
    fake.event_status = 400
    with pytest.raises(GoogleRequestError):
        client.create_event("at", event_id="b" * 32, body={})


def test_meet_url_only_from_google_meet() -> None:
    assert meet_url_from({"hangoutLink": "https://meet.google.com/abc-defg-hij"})
    assert meet_url_from({"hangoutLink": "https://evil.example/abc"}) is None
    video = {"entryPointType": "video", "uri": "https://meet.google.com/aaa-bbbb-ccc"}
    assert meet_url_from({"conferenceData": {"entryPoints": [video]}})


# ------------------------------------------------------------------------------- configuração


def test_calendar_needs_all_settings_and_https_redirect() -> None:
    base = dict(_env_file=None, supabase_url="https://x.supabase.co")
    assert not Settings(**base).calendar_configured
    full = Settings(
        **base,
        google_oauth_client_id="cid",
        google_oauth_client_secret="s",
        google_oauth_redirect_uri="https://app.edusearch.com.br/conta/agenda/google/retorno",
        token_encryption_key=generate_key(),
    )
    assert full.calendar_configured
    with pytest.raises(ValueError):
        Settings(**base, google_oauth_redirect_uri="http://app.edusearch.com.br/x")
    with pytest.raises(ValueError):
        Settings(**base, scheduling_stage="production")
    assert Settings(**base).scheduling_stage == "off"
    assert time.time() > 0
