"""Fase 3A com banco real (conexão como edusearch_api) e Google FALSO (sem rede).

Cobre: conexão OAuth (state, escopo, revogação, reconexão), disponibilidade, reserva com Meet,
idempotência, conflitos (professor e aluno), isolamento entre usuários, cancelamento, RLS das
tabelas novas, credenciais fora do alcance de anon/authenticated e agenda desligada por padrão.
"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.crypto import TokenCipher, generate_key
from app.db import Database
from app.google_calendar import CALENDAR_SCOPE, GoogleCalendarClient
from app.main import create_app
from tests.db.conftest import credential_approved
from tests.test_onboarding_api import STUDENT, TEACHER

FULL_WEEK = [
    {"weekday": d, "start": "00:00", "end": "24:00"}
    for d in ("seg", "ter", "qua", "qui", "sex", "sab", "dom")
]


class FakeGoogle:
    """Google em memória: códigos, refresh tokens, eventos e revogações."""

    def __init__(self) -> None:
        self.codes: dict[str, str] = {}  # code -> scope concedido
        self.refresh_tokens: set[str] = set()
        self.revoked: set[str] = set()
        self.events: dict[str, dict] = {}
        self.calendar_down = False

    def issue_code(self, scope: str = CALENDAR_SCOPE) -> str:
        code = f"code-{uuid.uuid4().hex}"
        self.codes[code] = scope
        return code

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url.startswith("https://oauth2.googleapis.com/revoke"):
            self.revoked.add(parse_qs(request.content.decode())["token"][0])
            return httpx.Response(200)
        if url.startswith("https://oauth2.googleapis.com/token"):
            form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            assert form["client_secret"] == "segredo-de-teste"
            if form["grant_type"] == "authorization_code":
                scope = self.codes.pop(form["code"], None)
                if scope is None or not form.get("code_verifier"):
                    return httpx.Response(400, json={"error": "invalid_grant"})
                rt = f"1//rt-{uuid.uuid4().hex}"
                self.refresh_tokens.add(rt)
                return httpx.Response(
                    200, json={"access_token": "at", "refresh_token": rt, "scope": scope}
                )
            rt = form["refresh_token"]
            if rt not in self.refresh_tokens or rt in self.revoked:
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": f"at-{rt}"})
        if "calendar/v3" in url:
            if self.calendar_down:
                return httpx.Response(503)
            event_id = url.split("/events")[1].strip("/").split("?")[0]
            if request.method == "POST":
                body = json.loads(request.content)
                if body["id"] in self.events:
                    return httpx.Response(
                        409, json={"error": {"errors": [{"reason": "duplicate"}]}}
                    )
                ev = {**body, "hangoutLink": f"https://meet.google.com/{body['id'][:3]}-test-meet"}
                self.events[body["id"]] = ev
                return httpx.Response(200, json=ev)
            if request.method == "GET":
                ev = self.events.get(event_id)
                return httpx.Response(200 if ev else 404, json=ev or {})
            if request.method == "DELETE":
                return httpx.Response(204 if self.events.pop(event_id, None) else 410)
        return httpx.Response(404)


@pytest.fixture
def google() -> FakeGoogle:
    return FakeGoogle()


@pytest.fixture
def cipher() -> TokenCipher:
    return TokenCipher(generate_key())


@pytest.fixture
def make_client(settings, verifier, api_database_url, google, cipher):
    clients: list[TestClient] = []

    def _make(stage: str = "testing") -> TestClient:
        s = settings.model_copy(
            update={
                "scheduling_stage": stage,
                "google_oauth_redirect_uri": "https://app.example.com/conta/agenda/google/retorno",
            }
        )
        gcal = GoogleCalendarClient(
            client_id="cid.apps.googleusercontent.com",
            client_secret="segredo-de-teste",
            redirect_uri=s.google_oauth_redirect_uri,
            transport=httpx.MockTransport(google),
        )
        database = Database(api_database_url, min_size=0, max_size=2, connect_timeout=5)
        app = create_app(
            s, token_verifier=verifier, database=database, google_calendar=gcal, token_cipher=cipher
        )
        c = TestClient(app)
        c.__enter__()
        clients.append(c)
        return c

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def local_at(days: int, hour: int = 14) -> datetime:
    """Horário FIXO de Brasília (UTC-3), ``days`` dias à frente. Evita testes que dependem da hora
    em que rodam (perto da meia-noite, "agora + N dias" cruzaria o dia)."""
    d = datetime.now(UTC).date() + timedelta(days=days)
    return datetime(d.year, d.month, d.day, hour + 3, 0, tzinfo=UTC)


def publish(admin, teacher_id) -> None:
    """Passo de OPERAÇÃO (fora da API): aprovar e publicar o professor de teste."""
    credential_approved(admin, teacher_id)
    admin.execute(
        "update public.teacher_profiles set verification_status = 'approved', verified_at = now(),"
        " is_published = true, published_at = now() where user_id = %s",
        (teacher_id,),
    )


@pytest.fixture
def people(users, make_token, client, admin):
    """Professor publicado com disponibilidade total e dois alunos, criados pela própria API."""
    teacher, s1, s2 = (
        users.create("Prof Fictícia"),
        users.create("Aluno Um"),
        users.create("Aluna Dois"),
    )
    tokens = {uid: make_token(uid) for uid in (teacher, s1, s2)}
    assert (
        client.post(
            "/v1/me/roles", json={"role": "teacher"}, headers=auth(tokens[teacher])
        ).status_code
        == 201
    )
    assert (
        client.put(
            "/v1/me/teacher-profile", json=TEACHER, headers=auth(tokens[teacher])
        ).status_code
        == 200
    )
    for s in (s1, s2):
        assert (
            client.post(
                "/v1/me/roles", json={"role": "student"}, headers=auth(tokens[s])
            ).status_code
            == 201
        )
        assert (
            client.put("/v1/me/student-profile", json=STUDENT, headers=auth(tokens[s])).status_code
            == 200
        )
    r = client.put(
        "/v1/me/availability", json={"windows": FULL_WEEK}, headers=auth(tokens[teacher])
    )
    assert r.status_code == 200, r.text
    publish(admin, teacher)
    return {"teacher": teacher, "s1": s1, "s2": s2, "tokens": tokens}


def connect(client, google, token) -> dict:
    start = client.post("/v1/me/google-calendar/authorization", headers=auth(token))
    assert start.status_code == 200, start.text
    state = parse_qs(urlsplit(start.json()["authorization_url"]).query)["state"][0]
    r = client.post(
        "/v1/me/google-calendar/connection",
        json={"code": google.issue_code(), "state": state},
        headers=auth(token),
    )
    assert r.status_code == 200, r.text
    return r.json()


def first_slot(client, teacher, token, duration: int = 60, skip: int = 0) -> str:
    r = client.get(f"/v1/teachers/{teacher}/slots?duration={duration}&days=3", headers=auth(token))
    assert r.status_code == 200, r.text
    return r.json()["slots"][skip]


def book(client, teacher, token, starts_at, *, key=None, duration=60):
    return client.post(
        "/v1/lessons",
        json={
            "teacher_id": str(teacher),
            "subject": "matematica",
            "starts_at": starts_at,
            "duration_minutes": duration,
            "idempotency_key": str(key or uuid.uuid4()),
        },
        headers=auth(token),
    )


# --------------------------------------------------------------------------- agenda desligada


def test_scheduling_is_off_by_default(make_client, users, make_token) -> None:
    c = make_client(stage="off")
    token = make_token(users.create())
    for method, path in [
        ("get", "/v1/me/google-calendar"),
        ("post", "/v1/me/google-calendar/authorization"),
        ("get", "/v1/me/availability"),
        ("get", "/v1/teachers"),
        ("get", "/v1/me/lessons"),
    ]:
        r = getattr(c, method)(path, headers=auth(token))
        assert r.status_code == 403 and r.json()["code"] == "scheduling_disabled", path
    status = c.get("/v1/scheduling/status", headers=auth(token)).json()
    assert status["stage"] == "off" and status["payments_enabled"] is False


def test_routes_require_token(client) -> None:
    assert client.get("/v1/me/lessons").status_code == 401
    assert client.post("/v1/lessons", json={}).status_code == 401


# --------------------------------------------------------------------------- conexão com o Google


def test_connect_stores_only_ciphertext_and_reconnects(
    client, google, people, admin, cipher
) -> None:
    teacher, tk = people["teacher"], people["tokens"][people["teacher"]]
    assert (
        client.get("/v1/me/google-calendar", headers=auth(tk)).json()["status"] == "not_connected"
    )
    body = connect(client, google, tk)
    assert body["status"] == "connected" and "token" not in json.dumps(body)

    row = admin.execute(
        "select refresh_token_ciphertext, key_version, scopes from private.google_calendar_credentials "
        "where teacher_id = %s",
        (teacher,),
    ).fetchone()
    blob = bytes(row["refresh_token_ciphertext"])
    assert not any(rt.encode() in blob for rt in google.refresh_tokens)  # nunca em texto puro
    assert (
        cipher.decrypt_token(blob, owner=teacher, key_version=row["key_version"])
        in google.refresh_tokens
    )
    assert row["scopes"] == [CALENDAR_SCOPE]

    # Desconectar: revoga no Google e apaga a credencial.
    r = client.delete("/v1/me/google-calendar", headers=auth(tk))
    assert r.json()["status"] == "not_connected" and google.revoked
    assert (
        admin.execute(
            "select count(*) as n from private.google_calendar_credentials where teacher_id = %s",
            (teacher,),
        ).fetchone()["n"]
        == 0
    )
    assert connect(client, google, tk)["status"] == "connected"


def test_state_from_another_account_and_denied_scope(
    client, google, people, users, make_token
) -> None:
    tk = people["tokens"][people["teacher"]]
    start = client.post("/v1/me/google-calendar/authorization", headers=auth(tk)).json()
    state = parse_qs(urlsplit(start["authorization_url"]).query)["state"][0]

    # Outro professor usando o link/código iniciado pela primeira conta: recusado.
    other = users.create("Outro Prof")
    ot = make_token(other)
    client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(ot))
    r = client.post(
        "/v1/me/google-calendar/connection",
        json={"code": google.issue_code(), "state": state},
        headers=auth(ot),
    )
    assert r.status_code == 403 and r.json()["code"] == "state_mismatch"

    # State adulterado.
    r = client.post(
        "/v1/me/google-calendar/connection",
        json={"code": google.issue_code(), "state": state[:-4] + "AAAA"},
        headers=auth(tk),
    )
    assert r.status_code == 400 and r.json()["code"] == "invalid_state"

    # Professor desmarcou a permissão da agenda no consentimento granular.
    r = client.post(
        "/v1/me/google-calendar/connection",
        json={"code": google.issue_code(scope="openid email"), "state": state},
        headers=auth(tk),
    )
    assert r.status_code == 422 and r.json()["code"] == "calendar_scope_denied"


def test_students_cannot_connect_calendar(client, people) -> None:
    r = client.post(
        "/v1/me/google-calendar/authorization", headers=auth(people["tokens"][people["s1"]])
    )
    assert r.status_code == 403 and r.json()["code"] == "role_required"


# --------------------------------------------------------------------------- reserva com Meet


def test_booking_creates_meet_and_is_idempotent(client, google, people) -> None:
    teacher, s1, s2, tokens = people["teacher"], people["s1"], people["s2"], people["tokens"]
    connect(client, google, tokens[teacher])

    teachers = client.get("/v1/teachers", headers=auth(tokens[s1])).json()
    assert [t["id"] for t in teachers] == [str(teacher)]

    slot = first_slot(client, teacher, tokens[s1])
    key = uuid.uuid4()
    r = book(client, teacher, tokens[s1], slot, key=key)
    assert r.status_code == 201, r.text
    lesson = r.json()
    assert lesson["calendar_sync_status"] == "synced" and lesson["is_test"] is True
    assert lesson["meet_url"].startswith("https://meet.google.com/")
    assert len(google.events) == 1
    event = next(iter(google.events.values()))
    assert event["id"] == uuid.UUID(lesson["id"]).hex  # ID determinístico
    assert "attendees" not in event and event["visibility"] == "private"

    # Clique duplo / nova tentativa: MESMA aula, sem novo evento.
    again = book(client, teacher, tokens[s1], slot, key=key)
    assert again.status_code == 200 and again.json()["id"] == lesson["id"]
    assert len(google.events) == 1
    # Mesma chave para outro horário: conflito explícito.
    later = first_slot(client, teacher, tokens[s1], skip=3)
    assert (
        book(client, teacher, tokens[s1], later, key=key).json()["code"] == "idempotency_conflict"
    )

    # Outro aluno no mesmo horário: ocupado.
    r = book(client, teacher, tokens[s2], slot)
    assert r.status_code == 409 and r.json()["code"] == "slot_unavailable"
    # O horário some da lista de livres.
    assert (
        slot
        not in client.get(f"/v1/teachers/{teacher}/slots?days=3", headers=auth(tokens[s2])).json()[
            "slots"
        ]
    )

    # Professor vê a aula com o nome do aluno; o outro aluno não vê nada.
    tl = client.get("/v1/me/lessons", headers=auth(tokens[teacher])).json()
    assert tl[0]["role"] == "teacher" and tl[0]["student"]["display_name"] == "Aluno Um"
    assert client.get("/v1/me/lessons", headers=auth(tokens[s2])).json() == []


def test_student_cannot_double_book_same_time(client, people, users, make_token, admin) -> None:
    teacher, s1, tokens = people["teacher"], people["s1"], people["tokens"]
    slot = first_slot(client, teacher, tokens[s1])
    assert book(client, teacher, tokens[s1], slot).status_code == 201

    other = users.create("Outra Prof")
    ot = make_token(other)
    client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(ot))
    client.put("/v1/me/teacher-profile", json=TEACHER, headers=auth(ot))
    client.put("/v1/me/availability", json={"windows": FULL_WEEK}, headers=auth(ot))
    publish(admin, other)
    r = book(client, other, tokens[s1], slot)
    assert r.status_code == 409 and r.json()["code"] == "slot_unavailable"


def test_booking_without_calendar_and_with_revoked_calendar(client, google, people) -> None:
    teacher, s1, tokens = people["teacher"], people["s1"], people["tokens"]
    r = book(client, teacher, tokens[s1], first_slot(client, teacher, tokens[s1]))
    assert r.status_code == 201 and r.json()["calendar_sync_status"] == "not_connected"
    assert r.json()["meet_url"] is None

    connect(client, google, tokens[teacher])
    google.revoked |= google.refresh_tokens  # professor revogou no Google
    r = book(client, teacher, tokens[s1], first_slot(client, teacher, tokens[s1], skip=4))
    assert r.status_code == 201 and r.json()["calendar_sync_status"] == "failed"
    assert (
        client.get("/v1/me/google-calendar", headers=auth(tokens[teacher])).json()["status"]
        == "revoked"
    )

    # Reconexão e nova tentativa de sincronizar a aula.
    connect(client, google, tokens[teacher])
    r = client.post(f"/v1/lessons/{r.json()['id']}/calendar-sync", headers=auth(tokens[teacher]))
    assert r.json()["calendar_sync_status"] == "synced" and r.json()["meet_url"]


def test_google_outage_keeps_lesson_and_allows_resync(client, google, people) -> None:
    teacher, s1, tokens = people["teacher"], people["s1"], people["tokens"]
    connect(client, google, tokens[teacher])
    google.calendar_down = True
    r = book(client, teacher, tokens[s1], first_slot(client, teacher, tokens[s1]))
    assert r.status_code == 201 and r.json()["calendar_sync_status"] == "failed"
    google.calendar_down = False
    lesson_id = r.json()["id"]
    assert (
        client.post(f"/v1/lessons/{lesson_id}/calendar-sync", headers=auth(tokens[s1])).status_code
        == 403
    )
    r = client.post(f"/v1/lessons/{lesson_id}/calendar-sync", headers=auth(tokens[teacher]))
    assert r.json()["calendar_sync_status"] == "synced"


def test_cancel_removes_event_and_frees_slot(client, google, people) -> None:
    teacher, s1, s2, tokens = people["teacher"], people["s1"], people["s2"], people["tokens"]
    connect(client, google, tokens[teacher])
    slot = first_slot(client, teacher, tokens[s1])
    lesson = book(client, teacher, tokens[s1], slot).json()

    assert (
        client.post(f"/v1/lessons/{lesson['id']}/cancel", headers=auth(tokens[s2])).status_code
        == 404
    )
    r = client.post(f"/v1/lessons/{lesson['id']}/cancel", headers=auth(tokens[s1]))
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "cancelled" and body["cancelled_by_role"] == "student"
    assert body["calendar_sync_status"] == "removed" and body["meet_url"] is None
    assert google.events == {}
    assert (
        client.post(f"/v1/lessons/{lesson['id']}/cancel", headers=auth(tokens[teacher])).status_code
        == 409
    )
    # Horário liberado para outro aluno.
    assert book(client, teacher, tokens[s2], slot).status_code == 201


def test_booking_validation_errors(client, people, users, make_token, admin) -> None:
    teacher, s1, tokens = people["teacher"], people["s1"], people["tokens"]
    slot = first_slot(client, teacher, tokens[s1])
    assert (
        book(client, teacher, tokens[s1], slot, duration=90).json()["code"]
        == "duration_not_offered"
    )
    r = client.post(
        "/v1/lessons",
        json={
            "teacher_id": str(teacher),
            "subject": "fisica",
            "starts_at": slot,
            "duration_minutes": 60,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth(tokens[s1]),
    )
    assert r.json()["code"] == "subject_not_offered"
    soon = (datetime.now(UTC) + timedelta(minutes=30)).replace(second=0, microsecond=0)
    soon = soon - timedelta(minutes=soon.minute % 15)
    assert book(client, teacher, tokens[s1], soon.isoformat()).json()["code"] == "slot_invalid"
    r = client.post(
        "/v1/lessons", json={"teacher_id": str(teacher), "price_cents": 1}, headers=auth(tokens[s1])
    )
    assert r.status_code == 422
    # Professor não publicado: inexistente para o aluno.
    hidden = users.create("Prof Oculta")
    ht = make_token(hidden)
    client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(ht))
    client.put("/v1/me/teacher-profile", json=TEACHER, headers=auth(ht))
    client.put("/v1/me/availability", json={"windows": FULL_WEEK}, headers=auth(ht))
    assert book(client, hidden, tokens[s1], slot).status_code == 404
    assert client.get(f"/v1/teachers/{hidden}/slots", headers=auth(tokens[s1])).status_code == 404
    # Professor não pode reservar (papel de aluno ausente).
    assert book(client, teacher, tokens[teacher], slot).json()["code"] == "role_required"


def test_availability_validation(client, people) -> None:
    tk = people["tokens"][people["teacher"]]
    bad = {
        "windows": [
            {"weekday": "seg", "start": "08:00", "end": "10:00"},
            {"weekday": "seg", "start": "09:00", "end": "11:00"},
        ]
    }
    r = client.put("/v1/me/availability", json=bad, headers=auth(tk))
    assert r.status_code == 422 and r.json()["code"] == "invalid_availability"
    r = client.put(
        "/v1/me/availability",
        json={"windows": [{"weekday": "seg", "start": "8h", "end": "10:00"}]},
        headers=auth(tk),
    )
    assert r.status_code == 422
    ok = {"windows": [{"weekday": "qua", "start": "14:00", "end": "18:00"}]}
    assert (
        client.put("/v1/me/availability", json=ok, headers=auth(tk)).json()["windows"]
        == ok["windows"]
    )
    st = people["tokens"][people["s1"]]
    assert client.put("/v1/me/availability", json=ok, headers=auth(st)).status_code == 403


def test_teacher_profile_untouched_by_scheduling(client, google, people, admin) -> None:
    """Regressão: agenda e reservas não alteram aprovação/publicação nem o cadastro."""
    teacher, s1, tokens = people["teacher"], people["s1"], people["tokens"]
    before = admin.execute(
        "select * from public.teacher_profiles where user_id = %s", (teacher,)
    ).fetchone()
    connect(client, google, tokens[teacher])
    book(client, teacher, tokens[s1], first_slot(client, teacher, tokens[s1]))
    after = admin.execute(
        "select * from public.teacher_profiles where user_id = %s", (teacher,)
    ).fetchone()
    assert before == after
    r = client.get("/v1/me/teacher-profile", headers=auth(tokens[teacher])).json()
    assert r["verification_status"] == "approved" and r["subjects"] == ["matematica"]


# --------------------------------------------------------------------------- RLS e privilégios


def test_client_roles_cannot_reach_tokens_or_busy_function(as_user, anon, people) -> None:
    s1 = as_user(people["s1"])
    teacher = as_user(people["teacher"])
    for session in (s1, teacher, anon):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            session.rows("select * from private.google_calendar_credentials")
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            session.rows(
                "select * from private.teacher_busy_ranges(%s, now(), now() + interval '1 day')",
                (people["teacher"],),
            )
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        anon.rows("select * from public.lessons")  # anon não tem nem SELECT


def test_rls_on_lessons(as_user, commit_as, client, people) -> None:
    teacher, s1, s2, tokens = people["teacher"], people["s1"], people["s2"], people["tokens"]
    lesson = book(client, teacher, tokens[s1], first_slot(client, teacher, tokens[s1])).json()

    # Aluno não grava aula em nome de outro aluno.
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        as_user(s2).execute(
            "insert into public.lessons (teacher_id, student_id, subject_id, starts_at, ends_at, idempotency_key) "
            "select %s, %s, id, %s, %s, gen_random_uuid() from public.subjects where slug = 'matematica'",
            (teacher, s1, local_at(3), local_at(3) + timedelta(hours=1)),
        )
    # Participantes não escrevem campos do Google nem "descancelam".
    for uid in (teacher, s1):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            as_user(uid).execute(
                "update public.lessons set meet_url = 'https://meet.google.com/aaa-bbbb-ccc' where id = %s",
                (lesson["id"],),
            )
    assert (
        as_user(s2).execute(
            "update public.lessons set status = 'cancelled' where id = %s", (lesson["id"],)
        )
        == 0
    )
    commit_as(s1).execute(
        "update public.lessons set status = 'cancelled' where id = %s", (lesson["id"],)
    )
    with pytest.raises(psycopg.errors.CheckViolation):
        as_user(s1).execute(
            "update public.lessons set status = 'scheduled' where id = %s", (lesson["id"],)
        )
    # Visibilidade: só participantes.
    assert as_user(s2).rows("select id from public.lessons") == []
    assert len(as_user(teacher).rows("select id from public.lessons")) == 1


def test_db_blocks_overlap_and_server_fields_even_without_api(admin, people) -> None:
    """Exclusão no banco: mesmo um INSERT direto (sem a API) não cria conflito."""
    teacher, s1, s2 = people["teacher"], people["s1"], people["s2"]
    start = local_at(5)
    sql = (
        "insert into public.lessons (teacher_id, student_id, subject_id, starts_at, ends_at, "
        "idempotency_key, meet_url, is_test) select %s, %s, id, %s, %s, gen_random_uuid(), "
        "'https://meet.google.com/forjado-abc', true from public.subjects where slug = 'matematica' "
        "returning meet_url, calendar_sync_status::text as sync"
    )
    row = admin.execute(sql, (teacher, s1, start, start + timedelta(hours=1))).fetchone()
    assert row == {"meet_url": None, "sync": "pending"}  # campos do servidor forçados pelo trigger
    with pytest.raises(psycopg.errors.ExclusionViolation):
        admin.execute(
            sql, (teacher, s2, start + timedelta(minutes=30), start + timedelta(minutes=90))
        )
    with pytest.raises(psycopg.errors.CheckViolation):
        admin.execute("update public.lessons set is_test = false where teacher_id = %s", (teacher,))


def test_profile_visibility_is_limited(as_user, people, users) -> None:
    stranger = users.create("Desconhecido")
    s1 = as_user(people["s1"])
    names = {r["display_name"] for r in s1.rows("select display_name from public.profiles")}
    assert names == {"Aluno Um", "Prof Fictícia"}  # o próprio + professor publicado
    assert (
        as_user(stranger).rows("select id from public.profiles where id = %s", (people["s1"],))
        == []
    )
