"""Fase 5 com banco real (edusearch_api + RLS) e AbacatePay FALSO (sem rede, sem dinheiro).

Cobre: checkout Pix (valor/comissão do servidor), idempotência, conflito, webhook autenticado,
forjado, duplicado e simultâneo, expiração e pagamento tardio, cancelamento antes/depois do
pagamento, falha do Google após pagamento, rede instável na criação, split habilitado e
indisponível, conciliação e RLS das tabelas financeiras.
"""

import base64
import hashlib
import hmac
import json
import threading
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.abacatepay import AbacatePayClient
from app.db import Database
from app.google_calendar import GoogleCalendarClient
from app.main import create_app
from tests.db.test_scheduling_db import (  # noqa: F401 — fixtures reutilizadas
    FULL_WEEK,
    FakeGoogle,
    auth,
    cipher,
    connect,
    google,
    publish,
)
from tests.test_onboarding_api import STUDENT, TEACHER

SECRET = "w" * 48
PUBLIC_KEY = "chave-publica-hmac-de-teste"
VALID_CPF = "52998224725"


class FakeAbacate:
    """AbacatePay em memória: cobranças por externalId (idempotência documentada)."""

    def __init__(self) -> None:
        self.charges: dict[str, dict] = {}
        self.by_external: dict[str, str] = {}
        self.creates = 0
        self.down = False
        self.timeout_after_create = False
        self.split_enabled = True
        self.sub_accounts: dict[str, dict] = {}
        self.sub_account_by_tax: dict[tuple[bool, str], str] = {}
        self.transfers: dict[str, dict] = {}
        self.withdraw_calls = 0
        self.withdraw_timeout = False
        self.withdraw_rejected = False
        self.last_create_body: dict | None = None

    def _ok(self, data) -> httpx.Response:
        return httpx.Response(200, json={"data": data, "success": True, "error": None})

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            return httpx.Response(503, json={"data": None, "success": False, "error": "x"})
        path = request.url.path.removeprefix("/v2")
        q = parse_qs(urlsplit(str(request.url)).query)
        dev_mode = (
            request.headers.get("Authorization", "").removeprefix("Bearer ").startswith("abc_dev_")
        )
        if path == "/transparents/create":
            body = json.loads(request.content)
            self.last_create_body = body
            data = body["data"]
            if data.get("splits") and not self.split_enabled:
                return httpx.Response(
                    400,
                    json={
                        "data": None,
                        "success": False,
                        "error": "Split para subcontas não está habilitado para esta loja",
                    },
                )
            ext = data["externalId"]
            if (
                ext in self.by_external
                and self.charges[self.by_external[ext]]["status"] == "PENDING"
            ):
                charge = self.charges[self.by_external[ext]]
            else:
                self.creates += 1
                cid = f"pix_char_{uuid.uuid4().hex[:16]}"
                charge = {
                    "id": cid,
                    "amount": data["amount"],
                    "status": "PENDING",
                    "devMode": dev_mode,
                    "brCode": f"00020126PIX{cid}",
                    "brCodeBase64": "data:image/png;base64,iVBORw0KGgo=",
                    "platformFee": 80,
                    "receiptUrl": None,
                    "metadata": data.get("metadata"),
                    "expiresAt": (
                        datetime.now(UTC) + timedelta(seconds=data["expiresIn"])
                    ).isoformat(),
                }
                self.charges[cid] = charge
                self.by_external[ext] = cid
            if self.timeout_after_create:
                self.timeout_after_create = False
                raise httpx.ReadTimeout("criou, mas a resposta não chegou")
            return self._ok(charge)
        if path == "/transparents/check":
            c = self.charges.get(q["id"][0])
            if c is None:
                return httpx.Response(
                    400, json={"data": None, "success": False, "error": "Pix QR Code not found"}
                )
            return self._ok({"id": c["id"], "status": c["status"], "expiresAt": c["expiresAt"]})
        if path == "/transparents/simulate-payment":
            c = self.charges[q["id"][0]]
            c["status"] = "PAID"
            return self._ok(c)
        if path == "/sub-accounts/create":
            body = json.loads(request.content)
            if not self.split_enabled:
                return httpx.Response(
                    400, json={"data": None, "success": False, "error": "Função não habilitada"}
                )
            tax = body["taxId"]
            key = (dev_mode, tax)
            sacc = self.sub_account_by_tax.setdefault(key, f"sacc_{uuid.uuid4().hex[:20]}")
            account = self.sub_accounts.setdefault(
                sacc,
                {
                    "id": sacc,
                    "name": body["name"],
                    "taxId": tax,
                    "externalId": body["externalId"],
                    "devMode": dev_mode,
                    "balance": {"available": 0, "blocked": 0},
                },
            )
            return self._ok(account)
        if path == "/sub-accounts/get":
            account = self.sub_accounts.get(q["id"][0])
            if account is None or account["devMode"] != dev_mode:
                return httpx.Response(
                    400, json={"data": None, "success": False, "error": "Subconta não encontrada"}
                )
            return self._ok(account)
        if path == "/sub-accounts/withdraw":
            body = json.loads(request.content)
            account = self.sub_accounts.get(body["id"])
            if account is None or account["devMode"] != dev_mode:
                return httpx.Response(
                    400, json={"data": None, "success": False, "error": "Subconta não encontrada"}
                )
            if self.withdraw_rejected:
                return httpx.Response(
                    400, json={"data": None, "success": False, "error": "Saldo insuficiente"}
                )
            ext = body["externalId"]
            transfer = self.transfers.get(ext)
            if transfer is None:
                self.withdraw_calls += 1
                transfer = {
                    "id": f"tran_{uuid.uuid4().hex[:16]}",
                    "externalId": ext,
                    "amount": body["amount"],
                    "status": "PENDING",
                    "platformFee": 80,
                }
                self.transfers[ext] = transfer
            if self.withdraw_timeout:
                self.withdraw_timeout = False
                raise httpx.ReadTimeout("resultado de saque desconhecido")
            return self._ok(transfer)
        return httpx.Response(404)

    def pay(self, charge_id: str) -> None:
        self.charges[charge_id]["status"] = "PAID"


_OMIT = object()


def webhook_body(
    charge: dict,
    *,
    event="transparent.completed",
    event_id=None,
    paid=None,
    amount=_OMIT,
    omit_paid=False,
    dev=True,
) -> bytes:
    """Formato OFICIAL da v2: nos exemplos da documentação, ``paidAmount`` vem sempre ``null``."""
    transparent = {
        "id": charge["id"],
        "externalId": None,
        "amount": charge["amount"] if amount is _OMIT else amount,
        "customerFee": None,
        "paidAmount": paid,
        "platformFee": 80,
        "status": "PAID",
        "devMode": dev,
        "metadata": {},
    }
    if amount is None:
        del transparent["amount"]
    if omit_paid:
        del transparent["paidAmount"]
    return json.dumps(
        {
            "id": event_id or f"evt_{uuid.uuid4().hex}",
            "event": event,
            "apiVersion": 2,
            "devMode": dev,
            "data": {"transparent": transparent, "customer": None, "payerInformation": None},
        }
    ).encode()


def post_webhook(client, body: bytes, *, secret=SECRET, key=PUBLIC_KEY, via_query=False):
    sig = base64.b64encode(hmac.new(key.encode(), body, hashlib.sha256).digest()).decode()
    headers = {
        "Content-Type": "application/json",
        "X-Webhook-Signature": sig,
        "User-Agent": "AbacatePay/1.0",
    }
    url = "/v1/payments/webhooks/abacatepay"
    if via_query:
        url += f"?webhookSecret={secret}"
    else:
        headers["X-Webhook-Secret"] = secret
    return client.post(url, content=body, headers=headers)


@pytest.fixture
def abacate() -> FakeAbacate:
    return FakeAbacate()


@pytest.fixture
def make_client(settings, verifier, api_database_url, google, cipher, abacate):
    clients: list[TestClient] = []

    def _make(stage: str = "sandbox", split: bool = False, withdrawals: bool = False) -> TestClient:
        api_key = "abc_prod_teste" if stage == "production" else "abc_dev_teste"
        s = settings.model_copy(
            update={
                "scheduling_stage": "testing",
                "google_oauth_redirect_uri": "https://app.example.com/conta/agenda/google/retorno",
                "payments_stage": stage,
                # Só habilita a configuração de produção no processo de teste: não cria cobrança.
                "payments_production_approved": stage == "production",
                "abacatepay_api_key": __import__("pydantic").SecretStr(api_key),
                "abacatepay_webhook_secret": __import__("pydantic").SecretStr(SECRET),
                "abacatepay_webhook_public_key": __import__("pydantic").SecretStr(PUBLIC_KEY),
                "abacatepay_split_enabled": split,
                "subaccount_withdrawals_enabled": withdrawals,
            }
        )
        gcal = GoogleCalendarClient(
            client_id="cid.apps.googleusercontent.com",
            client_secret="segredo-de-teste",
            redirect_uri=s.google_oauth_redirect_uri,
            transport=httpx.MockTransport(google),
        )
        gateway = AbacatePayClient(api_key, transport=httpx.MockTransport(abacate))
        database = Database(api_database_url, min_size=0, max_size=4, connect_timeout=5)
        app = create_app(
            s,
            token_verifier=verifier,
            database=database,
            google_calendar=gcal,
            token_cipher=cipher,
            payment_gateway=gateway,
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


@pytest.fixture
def people(users, make_token, client, admin):
    teacher, s1, s2 = (
        users.create("Prof Paga"),
        users.create("Aluno Pagante"),
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
        client.post("/v1/me/roles", json={"role": "student"}, headers=auth(tokens[s]))
        client.put("/v1/me/student-profile", json=STUDENT, headers=auth(tokens[s]))
    assert (
        client.put(
            "/v1/me/availability", json={"windows": FULL_WEEK}, headers=auth(tokens[teacher])
        ).status_code
        == 200
    )
    publish(admin, teacher)
    return {"teacher": teacher, "s1": s1, "s2": s2, "tokens": tokens}


def slot(
    client,
    people,
    token_of="s1",  # noqa: S107
    skip=0,
    duration=60,
) -> str:
    r = client.get(
        f"/v1/teachers/{people['teacher']}/slots?duration={duration}&days=3",
        headers=auth(people["tokens"][people[token_of]]),
    )
    assert r.status_code == 200, r.text
    return r.json()["slots"][skip]


def checkout(client, people, starts_at, *, who="s1", key=None, **extra):
    body = {
        "teacher_id": str(people["teacher"]),
        "subject": "matematica",
        "starts_at": starts_at,
        "duration_minutes": 60,
        "idempotency_key": str(key or uuid.uuid4()),
        **extra,
    }
    return client.post(
        "/v1/payments/checkout", json=body, headers=auth(people["tokens"][people[who]])
    )


def charge_of(abacate, payment) -> dict:
    return abacate.charges[abacate.by_external[payment["id"]]]


# --------------------------------------------------------------------------- checkout


def test_checkout_freezes_server_price_and_commission(client, people, abacate) -> None:
    r = checkout(client, people, slot(client, people))
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["status"] == "pending" and p["environment"] == "sandbox"
    assert (p["amount_cents"], p["commission_cents"], p["teacher_share_cents"]) == (
        8000,
        1200,
        6800,
    )
    assert (
        p["commission_bps"] == 1500
        and p["commission_policy_version"] == "v1"
        and p["br_code"].startswith("00020126")
        and p["br_code_image"].startswith("data:image/png")
    )
    assert abacate.last_create_body["data"]["amount"] == 8000
    assert abacate.last_create_body["data"]["externalId"] == p["id"]
    assert p["lesson"]["status"] == "awaiting_payment"
    # O app não pode mandar valor, comissão ou recebedor.
    for field in ({"amount_cents": 1}, {"commission_bps": 0}, {"sub_account_id": "sacc_x"}):
        assert checkout(client, people, slot(client, people, skip=2), **field).status_code == 422


def test_double_click_and_conflicts(client, people, abacate) -> None:
    s = slot(client, people)
    key = uuid.uuid4()
    first = checkout(client, people, s, key=key).json()
    again = checkout(client, people, s, key=key)
    assert again.status_code == 200 and again.json()["id"] == first["id"]
    assert abacate.creates == 1  # um Pix só
    # O horário em pagamento está bloqueado para outro aluno (e some dos horários livres).
    r = checkout(client, people, s, who="s2")
    assert r.status_code == 409 and r.json()["code"] == "slot_unavailable"
    assert (
        s
        not in client.get(
            f"/v1/teachers/{people['teacher']}/slots?days=3",
            headers=auth(people["tokens"][people["s2"]]),
        ).json()["slots"]
    )
    # Teste e pago disputam o mesmo horário: a reserva de teste também é recusada.
    r = client.post(
        "/v1/lessons",
        json={
            "teacher_id": str(people["teacher"]),
            "subject": "matematica",
            "starts_at": s,
            "duration_minutes": 60,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth(people["tokens"][people["s2"]]),
    )
    assert r.status_code == 409


def test_payments_off_and_role_checks(make_client, people) -> None:
    off = make_client(stage="off")
    r = off.post("/v1/payments/checkout", json={}, headers=auth(people["tokens"][people["s1"]]))
    assert r.status_code in (403, 422)
    s = slot(off, people)
    r = off.post(
        "/v1/payments/checkout",
        json={
            "teacher_id": str(people["teacher"]),
            "subject": "matematica",
            "starts_at": s,
            "duration_minutes": 60,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth(people["tokens"][people["s1"]]),
    )
    assert r.status_code == 403 and r.json()["code"] == "payments_disabled"


# --------------------------------------------------------------------------- webhook


def test_webhook_confirms_once_and_creates_meet(client, people, abacate, google, admin) -> None:
    connect(client, google, people["tokens"][people["teacher"]])
    p = checkout(client, people, slot(client, people)).json()
    charge = charge_of(abacate, p)
    abacate.pay(charge["id"])
    body = webhook_body(charge)
    r = post_webhook(client, body)
    assert r.status_code == 200 and r.json()["outcome"] == "confirmed"
    paid = client.get(
        f"/v1/payments/{p['id']}", headers=auth(people["tokens"][people["s1"]])
    ).json()
    assert paid["status"] == "paid" and paid["lesson"]["status"] == "scheduled"
    assert paid["lesson"]["meet_url"].startswith("https://meet.google.com/")
    assert paid["br_code"] is None  # Pix deixa de ser exibido depois de pago
    # Reentrega do MESMO evento e evento novo para a mesma cobrança: nada repetido.
    assert post_webhook(client, body).json()["outcome"] == "duplicate"
    assert post_webhook(client, webhook_body(charge)).json()["outcome"] == "already_processed"
    assert len(google.events) == 1
    audit = admin.execute(
        "select count(*) as n from private.payment_audit_log where intent_id = %s and to_status = 'paid'",
        (p["id"],),
    ).fetchone()
    assert audit["n"] >= 1


def test_forged_and_wrong_environment_webhooks(client, people, abacate) -> None:
    p = checkout(client, people, slot(client, people)).json()
    charge = charge_of(abacate, p)
    body = webhook_body(charge)
    assert post_webhook(client, body, key="chave-falsa").status_code == 401
    assert post_webhook(client, body, secret="x" * 48).status_code == 401
    unsigned = client.post(
        "/v1/payments/webhooks/abacatepay", content=body, headers={"X-Webhook-Secret": SECRET}
    )
    assert unsigned.status_code == 401
    assert (
        post_webhook(client, webhook_body(charge, dev=False)).json()["outcome"]
        == "wrong_environment"
    )
    assert post_webhook(client, webhook_body(charge, paid=1)).json()["outcome"] == "amount_mismatch"
    assert (
        client.get(f"/v1/payments/{p['id']}", headers=auth(people["tokens"][people["s1"]])).json()[
            "status"
        ]
        == "pending"
    )
    # Segredo pela query (alternativa documentada) também vale.
    abacate.pay(charge["id"])
    assert (
        post_webhook(client, webhook_body(charge), via_query=True).json()["outcome"] == "confirmed"
    )


def test_teacher_finance_is_aggregated_and_private(client, people, abacate) -> None:
    """O painel deriva o professor do JWT; aluno não escolhe nem lê outro financeiro."""
    p = checkout(client, people, slot(client, people)).json()
    charge = charge_of(abacate, p)
    abacate.pay(charge["id"])
    assert post_webhook(client, webhook_body(charge)).json()["outcome"] == "confirmed"

    teacher = client.get(
        "/v1/me/teacher-finance?period=30d", headers=auth(people["tokens"][people["teacher"]])
    )
    assert teacher.status_code == 200
    data = teacher.json()
    assert data["environment"] == "sandbox"
    assert data["commission_bps"] == 1500
    assert data["summary"] == {
        "gross_cents": 8000,
        "commission_cents": 1200,
        "teacher_share_cents": 6800,
        "gateway_fee_cents": 80,
        "paid_lessons": 1,
        "pending_lessons": 0,
        "cancelled_lessons": 0,
        "refunded_lessons": 0,
    }
    assert len(data["payments"]) == 1 and data["payments"][0]["role"] == "teacher"
    assert data["payout_account"]["status"] == "split_unavailable"
    student = client.get(
        "/v1/me/teacher-finance?period=30d", headers=auth(people["tokens"][people["s1"]])
    )
    assert student.status_code == 403 and student.json()["code"] == "role_required"


def test_commission_progress_is_private_versioned_and_freezes_existing_charges(
    client, make_client, people, admin, users, make_token
) -> None:
    """A API deriva professor/ambiente; demo-v2 só afeta cobranças FUTURAS quando ativada no teste."""
    token = auth(people["tokens"][people["teacher"]])
    initial = client.get("/v1/me/commission-progress", headers=token)
    assert initial.status_code == 200
    assert initial.json() == {
        "environment": "sandbox",
        "policy_version": "v1",
        "progression_active": False,
        "current_level": 0,
        "current_rate_bps": 1500,
        "next_rate_bps": None,
        "eligible_paid_lessons": 0,
        "next_level_paid_lessons": None,
        "lessons_remaining": None,
        "evaluation_days": 90,
        "eligibility": "no_next_level",
        "simulation_amount_cents": 10000,
        "simulation_commission_cents": 1500,
        "simulation_teacher_share_cents": 8500,
    }

    old = checkout(client, people, slot(client, people)).json()
    assert (old["commission_policy_version"], old["commission_bps"]) == ("v1", 1500)
    with pytest.raises(psycopg.errors.CheckViolation):
        admin.execute(
            "insert into public.commission_policy_tiers "
            "(policy_version, environment, tier, min_eligible_paid_lessons, commission_bps) "
            "values ('demo-v2', 'sandbox', 99, 99, 999)"
        )
    # Dez eventos pagos persistidos e distintos habilitam a primeira faixa somente no fixture inativo.
    for _ in range(10):
        admin.execute(
            """
            insert into public.payment_intents (
              student_id, teacher_id, amount_cents, commission_bps, commission_cents,
              teacher_share_cents, environment, status, idempotency_key, expires_at,
              paid_at, paid_amount_cents
            ) values (%s, %s, 8000, 1500, 1200, 6800, 'sandbox', 'paid', %s,
                      now() + interval '15 minutes', now(), 8000)
            """,
            (uuid.uuid4(), people["teacher"], uuid.uuid4()),
        )
    # Cancelamento e reembolso são eventos persistidos, mas não tornam uma aula elegível.
    for status in ("cancelled", "refunded"):
        admin.execute(
            """
            insert into public.payment_intents (
              student_id, teacher_id, amount_cents, commission_bps, commission_cents,
              teacher_share_cents, environment, status, idempotency_key, expires_at,
              paid_at, paid_amount_cents
            ) values (%s, %s, 8000, 1500, 1200, 6800, 'sandbox', %s::public.payment_status, %s,
                      now() + interval '15 minutes', case when %s = 'refunded' then now() else null end,
                      case when %s = 'refunded' then 8000 else null end)
            """,
            (uuid.uuid4(), people["teacher"], status, uuid.uuid4(), status, status),
        )
    # Esta alteração representa operação privilegiada de homologação; não há rota de admin.
    admin.execute(
        "update public.commission_policies set is_active = false, retired_at = now() "
        "where version = 'v1' and environment = 'sandbox'"
    )
    admin.execute(
        "update public.commission_policies set is_active = true, activated_at = now(), retired_at = null "
        "where version = 'demo-v2' and environment = 'sandbox'"
    )
    try:
        progressed = client.get("/v1/me/commission-progress", headers=token)
        assert progressed.status_code == 200
        assert progressed.json() == {
            "environment": "sandbox",
            "policy_version": "demo-v2",
            "progression_active": True,
            "current_level": 1,
            "current_rate_bps": 1400,
            "next_rate_bps": 1250,
            "eligible_paid_lessons": 10,
            "next_level_paid_lessons": 25,
            "lessons_remaining": 15,
            "evaluation_days": 90,
            "eligibility": "eligible",
            "simulation_amount_cents": 10000,
            "simulation_commission_cents": 1400,
            "simulation_teacher_share_cents": 8600,
        }
        # Libera a reserva de fixture: a disponibilidade é otimista durante um Pix pendente.
        cancelled = client.post(
            f"/v1/lessons/{old['lesson']['id']}/cancel",
            headers=auth(people["tokens"][people["s1"]]),
        )
        assert cancelled.status_code == 200, cancelled.text
        new_response = checkout(client, people, slot(client, people))
        assert new_response.status_code == 201, new_response.text
        new = new_response.json()
        assert (new["commission_policy_version"], new["commission_bps"]) == ("demo-v2", 1400)
        assert (new["commission_cents"], new["teacher_share_cents"]) == (1120, 6880)
        # A cobrança anterior segue imutável mesmo depois da troca de política.
        old_again = client.get(
            f"/v1/payments/{old['id']}", headers=auth(people["tokens"][people["s1"]])
        ).json()
        assert (old_again["commission_policy_version"], old_again["commission_bps"]) == ("v1", 1500)

        other_teacher = users.create("Outra Professora")
        users.grant_role(other_teacher, "teacher")
        other = client.get("/v1/me/commission-progress", headers=auth(make_token(other_teacher)))
        assert other.status_code == 200 and other.json()["eligible_paid_lessons"] == 0
        assert other.json()["current_rate_bps"] == 1500

        # Production usa a política v1, e pagamentos Sandbox não vazam para a métrica dela.
        production = make_client("production").get("/v1/me/commission-progress", headers=token)
        assert production.status_code == 200
        assert production.json()["environment"] == "production"
        assert production.json()["policy_version"] == "v1"
        assert production.json()["eligible_paid_lessons"] == 0
    finally:
        # Não deixa a fixture de demonstração ativa para os testes seguintes.
        admin.execute(
            "update public.commission_policies set is_active = false, retired_at = now() "
            "where version = 'demo-v2' and environment = 'sandbox'"
        )
        admin.execute(
            "update public.commission_policies set is_active = true, activated_at = now(), retired_at = null "
            "where version = 'v1' and environment = 'sandbox'"
        )
    audit = admin.execute(
        "select count(*) as n from private.commission_policy_audit_log "
        "where policy_version in ('v1', 'demo-v2') and environment = 'sandbox'"
    ).fetchone()
    assert audit["n"] >= 4


def test_teacher_finance_isolated_by_server_environment(
    client, make_client, people, abacate, admin
) -> None:
    """O mesmo professor não mistura histórico Sandbox/Production, nem escolhe o ambiente."""
    sandbox = checkout(client, people, slot(client, people)).json()
    charge = charge_of(abacate, sandbox)
    abacate.pay(charge["id"])
    assert post_webhook(client, webhook_body(charge)).json()["outcome"] == "confirmed"

    # Registro artificial apenas no banco descartável para provar o limite entre os ambientes.
    admin.execute(
        """
        insert into public.payment_intents (
          student_id, teacher_id, amount_cents, commission_bps, commission_cents,
          teacher_share_cents, environment, status, idempotency_key, expires_at,
          paid_at, paid_amount_cents, gateway_fee_cents
        ) values (%s, %s, 10000, 1500, 1500, 8500, 'production', 'paid', %s,
                  now() + interval '15 minutes', now(), 10000, 125)
        """,
        (uuid.uuid4(), people["teacher"], uuid.uuid4()),
    )

    token = auth(people["tokens"][people["teacher"]])
    sandbox_view = client.get("/v1/me/teacher-finance?period=30d", headers=token)
    assert sandbox_view.status_code == 200
    sandbox_data = sandbox_view.json()
    assert sandbox_data["environment"] == "sandbox"
    assert sandbox_data["summary"]["gross_cents"] == 8000
    assert sandbox_data["summary"]["gateway_fee_cents"] == 80
    assert [payment["environment"] for payment in sandbox_data["payments"]] == ["sandbox"]

    # O processo de produção aqui só lê o mesmo banco descartável; não aciona gateway ou cobrança.
    production_client = make_client("production", split=True)
    production_view = production_client.get("/v1/me/teacher-finance?period=30d", headers=token)
    assert production_view.status_code == 200
    production_data = production_view.json()
    assert production_data["environment"] == "production"
    assert production_data["summary"]["gross_cents"] == 10000
    assert production_data["summary"]["commission_cents"] == 1500
    assert production_data["summary"]["teacher_share_cents"] == 8500
    assert production_data["summary"]["gateway_fee_cents"] == 125
    assert [payment["environment"] for payment in production_data["payments"]] == ["production"]


def test_simultaneous_confirmations_are_serialized(
    client, people, abacate, api_database_url
) -> None:
    p = checkout(client, people, slot(client, people)).json()
    charge = charge_of(abacate, p)
    results: list[str] = []

    def confirm() -> None:
        with psycopg.connect(api_database_url) as conn:
            row = conn.execute(
                "select outcome from private.payment_confirm(%s, %s, 'webhook')",
                (charge["id"], 8000),
            ).fetchone()
            results.append(row[0])

    threads = [threading.Thread(target=confirm) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == ["already_processed"] * 3 + ["confirmed"]


# --------------------------------------------------------------------------- expiração e atraso


def expire(admin, payment_id) -> None:
    admin.execute(
        "update public.payment_intents set expires_at = now() - interval '1 minute' where id = %s",
        (payment_id,),
    )


def test_expired_hold_frees_slot_and_late_payment_is_honored_if_free(
    client, people, abacate, admin
) -> None:
    s = slot(client, people)
    p = checkout(client, people, s).json()
    expire(admin, p["id"])
    # Consultar os horários varre as reservas vencidas: o horário volta a ficar livre.
    assert (
        s
        in client.get(
            f"/v1/teachers/{people['teacher']}/slots?days=3",
            headers=auth(people["tokens"][people["s2"]]),
        ).json()["slots"]
    )
    assert (
        client.get(f"/v1/payments/{p['id']}", headers=auth(people["tokens"][people["s1"]])).json()[
            "status"
        ]
        == "expired"
    )
    charge = charge_of(abacate, p)
    abacate.pay(charge["id"])
    assert post_webhook(client, webhook_body(charge)).json()["outcome"] == "confirmed_late"
    assert (
        client.get(f"/v1/payments/{p['id']}", headers=auth(people["tokens"][people["s1"]])).json()[
            "lesson"
        ]["status"]
        == "scheduled"
    )


def test_late_payment_after_slot_taken_creates_refund_request(
    client, people, abacate, admin
) -> None:
    s = slot(client, people)
    p = checkout(client, people, s).json()
    expire(admin, p["id"])
    slot(client, people)  # varre a expiração
    assert checkout(client, people, s, who="s2").status_code == 201  # outro aluno pega o horário
    charge = charge_of(abacate, p)
    abacate.pay(charge["id"])
    assert post_webhook(client, webhook_body(charge)).json()["outcome"] == "paid_slot_lost"
    got = client.get(f"/v1/payments/{p['id']}", headers=auth(people["tokens"][people["s1"]])).json()
    assert got["status"] == "paid" and got["lesson"]["status"] == "expired"
    assert got["refund"] == {
        "status": "requested",
        "reason": "late_payment_slot_taken",
        "created_at": got["refund"]["created_at"],
    }


# --------------------------------------------------------------------------- cancelamento


def test_cancel_before_and_after_payment(client, people, abacate) -> None:
    tk = people["tokens"][people["s1"]]
    p = checkout(client, people, slot(client, people)).json()
    assert (
        client.post(f"/v1/lessons/{p['lesson']['id']}/cancel", headers=auth(tk)).status_code == 200
    )
    assert client.get(f"/v1/payments/{p['id']}", headers=auth(tk)).json()["status"] == "cancelled"
    # Pagou mesmo assim (o Pix ainda valia): pago + reembolso solicitado, aula não volta.
    charge = charge_of(abacate, p)
    abacate.pay(charge["id"])
    assert post_webhook(client, webhook_body(charge)).json()["outcome"] == "paid_after_cancel"
    got = client.get(f"/v1/payments/{p['id']}", headers=auth(tk)).json()
    assert got["status"] == "paid" and got["refund"]["reason"] == "paid_after_cancel"

    q = checkout(client, people, slot(client, people, skip=3)).json()
    c2 = charge_of(abacate, q)
    abacate.pay(c2["id"])
    post_webhook(client, webhook_body(c2))
    assert (
        client.post(f"/v1/lessons/{q['lesson']['id']}/cancel", headers=auth(tk)).status_code == 200
    )
    got = client.get(f"/v1/payments/{q['id']}", headers=auth(tk)).json()
    assert (
        got["status"] == "paid"
        and got["refund"]["status"] == "requested"
        and got["refund"]["reason"] == "lesson_cancelled"
    )
    # Cancelar de novo não cria segunda solicitação.
    assert (
        client.post(f"/v1/lessons/{q['lesson']['id']}/cancel", headers=auth(tk)).status_code == 409
    )


# --------------------------------------------------------------------------- falhas


def test_google_failure_after_payment_keeps_payment(client, people, abacate, google) -> None:
    connect(client, google, people["tokens"][people["teacher"]])
    google.calendar_down = True
    p = checkout(client, people, slot(client, people)).json()
    charge = charge_of(abacate, p)
    abacate.pay(charge["id"])
    assert post_webhook(client, webhook_body(charge)).json()["outcome"] == "confirmed"
    got = client.get(f"/v1/payments/{p['id']}", headers=auth(people["tokens"][people["s1"]])).json()
    assert got["status"] == "paid" and got["lesson"]["status"] == "scheduled"
    assert got["lesson"]["calendar_sync_status"] == "failed"
    google.calendar_down = False
    r = client.post(
        f"/v1/lessons/{p['lesson']['id']}/calendar-sync",
        headers=auth(people["tokens"][people["teacher"]]),
    )
    assert r.json()["calendar_sync_status"] == "synced"


def test_gateway_timeout_after_create_does_not_duplicate(client, people, abacate) -> None:
    abacate.timeout_after_create = True
    r = checkout(client, people, slot(client, people))
    assert (
        r.status_code == 201 and r.json()["charge_pending"] is True and r.json()["br_code"] is None
    )
    got = client.get(
        f"/v1/payments/{r.json()['id']}", headers=auth(people["tokens"][people["s1"]])
    ).json()
    assert got["charge_pending"] is False and got["br_code"]  # recuperada pelo mesmo externalId
    assert abacate.creates == 1


def test_gateway_down_then_rejected(client, people, abacate) -> None:
    abacate.down = True
    p = checkout(client, people, slot(client, people)).json()
    assert p["charge_pending"] is True
    abacate.down = False
    assert client.get(
        f"/v1/payments/{p['id']}", headers=auth(people["tokens"][people["s1"]])
    ).json()["br_code"]


def test_simulation_and_reconciliation(client, people, abacate, google, admin) -> None:
    connect(client, google, people["tokens"][people["teacher"]])
    p = checkout(client, people, slot(client, people)).json()
    r = client.post(
        f"/v1/payments/{p['id']}/simulate", headers=auth(people["tokens"][people["s1"]])
    )
    assert r.status_code == 200 and r.json()["status"] == "paid"
    assert r.json()["lesson"]["meet_url"]
    assert (
        client.post(
            f"/v1/payments/{p['id']}/simulate", headers=auth(people["tokens"][people["s2"]])
        ).status_code
        == 404
    )
    # Conciliação: pago no gateway sem webhook → a consulta do servidor confirma.
    q = checkout(client, people, slot(client, people, skip=3)).json()
    abacate.pay(charge_of(abacate, q)["id"])
    # Antes de 5 s da última consulta o servidor não bate no gateway (limite por cobrança).
    tk = auth(people["tokens"][people["s1"]])
    assert client.get(f"/v1/payments/{q['id']}", headers=tk).json()["status"] == "pending"
    admin.execute(
        "update public.payment_intents set last_checked_at = now() - interval '1 minute' "
        "where id = %s",
        (q["id"],),
    )
    assert (
        client.get(f"/v1/payments/{q['id']}", headers=auth(people["tokens"][people["s1"]])).json()[
            "status"
        ]
        == "paid"
    )


# --------------------------------------------------------------------------- split


def test_split_with_authorized_sub_account(make_client, people, abacate, admin) -> None:
    c = make_client(split=True)
    tk = people["tokens"][people["teacher"]]
    assert c.get("/v1/me/payout-account", headers=auth(tk)).json()["status"] == "not_configured"
    r = c.put(
        "/v1/me/payout-account",
        json={"legal_name": "Prof Paga", "tax_id": "529.982.247-25"},
        headers=auth(tk),
    )
    assert r.status_code == 200 and r.json() == {
        **r.json(),
        "status": "active",
        "tax_id_last4": "4725",
    }
    stored = admin.execute(
        "select * from public.teacher_payout_accounts where teacher_id = %s and environment = 'sandbox'",
        (people["teacher"],),
    ).fetchone()
    assert VALID_CPF not in json.dumps(stored, default=str)  # só os 4 últimos dígitos
    p = checkout(c, people, slot(c, people)).json()
    assert abacate.last_create_body["data"]["splits"] == [
        {"subAccountId": stored["sub_account_id"], "amount": 6800}
    ]
    assert p["split_status"] == "pending"
    charge = charge_of(abacate, p)
    abacate.pay(charge["id"])
    post_webhook(c, webhook_body(charge))
    assert (
        c.get(f"/v1/payments/{p['id']}", headers=auth(people["tokens"][people["s1"]])).json()[
            "split_status"
        ]
        == "pending"
    )


def test_split_unavailable_is_recorded_without_fake_payout(make_client, people, abacate) -> None:
    c = make_client(split=True)
    abacate.split_enabled = False
    tk = people["tokens"][people["teacher"]]
    r = c.put(
        "/v1/me/payout-account",
        json={"legal_name": "Prof Paga", "tax_id": VALID_CPF},
        headers=auth(tk),
    )
    assert r.status_code == 409 and r.json()["code"] == "split_unavailable"
    p = checkout(c, people, slot(c, people)).json()
    assert p["split_status"] == "unavailable" and "splits" not in abacate.last_create_body["data"]
    assert (
        make_client(split=False).get("/v1/me/payout-account", headers=auth(tk)).json()["status"]
        == "split_unavailable"
    )


def test_production_split_requires_environment_bound_sub_account(
    make_client, people, abacate, admin
) -> None:
    sandbox = make_client("sandbox", split=True)
    production = make_client("production", split=True)
    token = auth(people["tokens"][people["teacher"]])
    payload = {"legal_name": "Prof Paga", "tax_id": VALID_CPF}

    assert sandbox.put("/v1/me/payout-account", json=payload, headers=token).status_code == 200
    assert production.put("/v1/me/payout-account", json=payload, headers=token).status_code == 200
    accounts = admin.execute(
        "select environment::text as environment, sub_account_id "
        "from public.teacher_payout_accounts where teacher_id = %s order by environment",
        (people["teacher"],),
    ).fetchall()
    assert [row["environment"] for row in accounts] == ["production", "sandbox"]
    assert accounts[0]["sub_account_id"] != accounts[1]["sub_account_id"]

    payment = checkout(production, people, slot(production, people)).json()
    assert abacate.last_create_body["data"]["splits"] == [
        {"subAccountId": accounts[0]["sub_account_id"], "amount": 6800}
    ]
    assert charge_of(abacate, payment)["devMode"] is False


def test_production_never_falls_back_to_unsplit_pix(make_client, people, abacate, admin) -> None:
    client = make_client("production", split=True)
    teacher_token = auth(people["tokens"][people["teacher"]])
    assert (
        client.put(
            "/v1/me/payout-account",
            json={"legal_name": "Prof Paga", "tax_id": VALID_CPF},
            headers=teacher_token,
        ).status_code
        == 200
    )
    abacate.split_enabled = False
    response = checkout(client, people, slot(client, people))
    assert response.status_code == 503 and response.json()["code"] == "split_required"
    assert abacate.last_create_body["data"]["splits"]  # a única tentativa continha split
    assert not abacate.charges
    row = admin.execute(
        "select split_status::text as split_status from public.payment_intents order by created_at desc limit 1"
    ).fetchone()
    assert row["split_status"] == "failed"


def test_production_blocks_pix_without_validated_sub_account(make_client, people, abacate) -> None:
    client = make_client("production", split=True)
    response = checkout(client, people, slot(client, people))
    assert response.status_code == 503 and response.json()["code"] == "payout_account_required"
    assert abacate.last_create_body is None and not abacate.charges


# --------------------------------------------------------------------------- saques


def transfer_webhook_body(
    transfer: dict, *, event: str = "transfer.completed", event_id: str | None = None
) -> bytes:
    status = "COMPLETE" if event == "transfer.completed" else "FAILED"
    return json.dumps(
        {
            "id": event_id or f"evt_{uuid.uuid4().hex}",
            "event": event,
            "apiVersion": 2,
            "devMode": False,
            "data": {"transfer": {**transfer, "status": status, "method": "PIX"}},
        }
    ).encode()


def configure_production_payout(client, people, abacate) -> str:
    token = auth(people["tokens"][people["teacher"]])
    response = client.put(
        "/v1/me/payout-account",
        json={"legal_name": "Prof Paga", "tax_id": VALID_CPF},
        headers=token,
    )
    assert response.status_code == 200, response.text
    account = next(a for a in abacate.sub_accounts.values() if a["devMode"] is False)
    account["balance"] = {"available": 5_000, "blocked": 300}
    return token


def test_withdrawals_are_gated_by_stage_and_operational_flag(make_client, people, abacate) -> None:
    payload = {"amount_cents": 100, "idempotency_key": str(uuid.uuid4())}
    sandbox = make_client("sandbox", split=True, withdrawals=True)
    assert (
        sandbox.post(
            "/v1/me/withdrawals", json=payload, headers=auth(people["tokens"][people["teacher"]])
        ).json()["code"]
        == "withdrawals_disabled"
    )
    production = make_client("production", split=True, withdrawals=False)
    assert (
        production.post(
            "/v1/me/withdrawals", json=payload, headers=auth(people["tokens"][people["teacher"]])
        ).json()["code"]
        == "withdrawals_disabled"
    )
    assert not abacate.transfers


def test_withdrawal_idempotency_balance_and_transfer_webhooks(make_client, people, abacate) -> None:
    client = make_client("production", split=True, withdrawals=True)
    token = configure_production_payout(client, people, abacate)
    assert client.get("/v1/me/payout-balance", headers=token).json() == {
        "environment": "production",
        "available_cents": 5_000,
        "blocked_cents": 300,
        "withdrawals_enabled": True,
    }
    too_much = client.post(
        "/v1/me/withdrawals",
        json={"amount_cents": 5_001, "idempotency_key": str(uuid.uuid4())},
        headers=token,
    )
    assert too_much.status_code == 409 and too_much.json()["code"] == "insufficient_balance"

    key = uuid.uuid4()
    first = client.post(
        "/v1/me/withdrawals",
        json={"amount_cents": 1_000, "idempotency_key": str(key)},
        headers=token,
    )
    assert first.status_code == 200 and first.json()["status"] == "pending"
    again = client.post(
        "/v1/me/withdrawals",
        json={"amount_cents": 1_000, "idempotency_key": str(key)},
        headers=token,
    )
    assert again.status_code == 200 and abacate.withdraw_calls == 1
    conflict = client.post(
        "/v1/me/withdrawals",
        json={"amount_cents": 1_001, "idempotency_key": str(key)},
        headers=token,
    )
    assert (
        conflict.status_code == 409 and conflict.json()["code"] == "withdrawal_idempotency_conflict"
    )

    transfer = next(iter(abacate.transfers.values()))
    body = transfer_webhook_body(transfer)
    assert post_webhook(client, body).json()["outcome"] == "completed"
    assert post_webhook(client, body).json()["outcome"] == "duplicate"
    # Um evento posterior não regride uma transferência já concluída.
    assert (
        post_webhook(client, transfer_webhook_body(transfer, event="transfer.failed")).json()[
            "outcome"
        ]
        == "already_processed"
    )
    history = client.get("/v1/me/withdrawals", headers=token).json()
    assert len(history) == 1 and history[0]["status"] == "completed"


def test_withdrawal_timeout_and_concurrent_retries_keep_one_order(
    make_client, people, abacate, admin
) -> None:
    client = make_client("production", split=True, withdrawals=True)
    token = configure_production_payout(client, people, abacate)
    key = uuid.uuid4()
    payload = {"amount_cents": 1_000, "idempotency_key": str(key)}
    abacate.withdraw_timeout = True
    first = client.post("/v1/me/withdrawals", json=payload, headers=token)
    assert first.status_code == 200 and first.json()["status"] == "pending"

    responses = []

    def retry() -> None:
        responses.append(client.post("/v1/me/withdrawals", json=payload, headers=token))

    threads = [threading.Thread(target=retry) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert [response.status_code for response in responses] == [200, 200]
    assert abacate.withdraw_calls == 1  # externalId persistido, nunca uma segunda ordem
    rows = admin.execute(
        "select id, external_id, gateway_transfer_id from public.withdrawal_requests "
        "where teacher_id=%s and environment='production'",
        (people["teacher"],),
    ).fetchall()
    assert len(rows) == 1 and rows[0]["gateway_transfer_id"] is not None


def test_known_withdrawal_rejection_is_final_for_the_same_key(make_client, people, abacate) -> None:
    client = make_client("production", split=True, withdrawals=True)
    token = configure_production_payout(client, people, abacate)
    abacate.withdraw_rejected = True
    payload = {"amount_cents": 1_000, "idempotency_key": str(uuid.uuid4())}
    rejected = client.post("/v1/me/withdrawals", json=payload, headers=token)
    assert rejected.status_code == 503 and rejected.json()["code"] == "withdrawal_gateway_error"
    assert client.get("/v1/me/withdrawals", headers=token).json()[0]["status"] == "failed"
    assert client.post("/v1/me/withdrawals", json=payload, headers=token).status_code == 200
    assert abacate.withdraw_calls == 0


# --------------------------------------------------------------------------- RLS e isolamento


def test_financial_tables_are_read_only_and_private(
    client, people, abacate, as_user, admin
) -> None:
    p = checkout(client, people, slot(client, people)).json()
    s1, s2, teacher = as_user(people["s1"]), as_user(people["s2"]), as_user(people["teacher"])
    for stmt in (
        "update public.payment_intents set status = 'paid'",
        "insert into public.payment_intents (lesson_id, student_id, teacher_id, amount_cents, commission_cents, teacher_share_cents, environment, idempotency_key, expires_at) values (null, gen_random_uuid(), gen_random_uuid(), 100, 15, 85, 'sandbox', gen_random_uuid(), now())",
        "update public.refund_requests set status = 'completed'",
        "update public.teacher_payout_accounts set sub_account_id = 'sacc_hack1234'",
        "select private.payment_confirm('x', 1, 'x')",
        "select * from private.payment_webhook_events",
        "select * from public.commission_policies",
        "select * from public.commission_policy_tiers",
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            s1.execute(stmt)
    # Aluno não confirma a aula mudando o status (só pode cancelar).
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        s1.execute(
            "update public.lessons set status = 'scheduled' where id = %s", (p["lesson"]["id"],)
        )
    assert s2.rows("select id from public.payment_intents") == []
    assert len(teacher.rows("select id from public.payment_intents")) == 1
    assert (
        client.get(
            f"/v1/payments/{p['id']}", headers=auth(people["tokens"][people["s2"]])
        ).status_code
        == 404
    )
    tview = client.get(
        f"/v1/payments/{p['id']}", headers=auth(people["tokens"][people["teacher"]])
    ).json()
    assert tview["role"] == "teacher" and tview["br_code"] is None
    hist = client.get("/v1/me/payments", headers=auth(people["tokens"][people["s2"]])).json()
    assert hist == []


def test_test_lessons_unchanged_and_immutable(client, people, admin) -> None:
    r = client.post(
        "/v1/lessons",
        json={
            "teacher_id": str(people["teacher"]),
            "subject": "matematica",
            "starts_at": slot(client, people),
            "duration_minutes": 60,
            "idempotency_key": str(uuid.uuid4()),
        },
        headers=auth(people["tokens"][people["s1"]]),
    )
    assert r.status_code == 201 and r.json()["is_test"] is True and r.json()["payment"] is None
    with pytest.raises(psycopg.errors.CheckViolation):
        admin.execute("update public.lessons set is_test = false where id = %s", (r.json()["id"],))


# --------------------------------------------------------------------------- valor pago no webhook


def audit_actors(admin, payment_id) -> list[tuple[str, str]]:
    rows = admin.execute(
        "select actor, to_status from private.payment_audit_log where intent_id = %s "
        "order by created_at",
        (payment_id,),
    ).fetchall()
    return [(r["actor"], r["to_status"]) for r in rows]


def webhook_outcome(admin, event_id: str) -> str:
    row = admin.execute(
        "select outcome from private.payment_webhook_events where event_id = %s", (event_id,)
    ).fetchone()
    return row["outcome"]


@pytest.mark.parametrize(
    "variant",
    [
        {"paid": None},  # formato real do sandbox: paidAmount null + amount
        {"omit_paid": True},  # paidAmount ausente + amount
        {"paid": "charge"},  # paidAmount preenchido
    ],
    ids=["paidAmount-null", "paidAmount-ausente", "paidAmount-valor"],
)
def test_webhook_confirms_directly_with_actor_webhook(
    client, people, abacate, google, admin, variant
) -> None:
    connect(client, google, people["tokens"][people["teacher"]])
    p = checkout(client, people, slot(client, people)).json()
    charge = charge_of(abacate, p)
    abacate.pay(charge["id"])
    kwargs = dict(variant)
    if kwargs.get("paid") == "charge":
        kwargs["paid"] = charge["amount"]
    event_id = f"evt_{uuid.uuid4().hex}"
    # Nenhuma consulta ao pagamento entre a criação e o webhook: a confirmação NÃO vem da conciliação.
    assert post_webhook(client, webhook_body(charge, event_id=event_id, **kwargs)).json() == {
        "received": True,
        "outcome": "confirmed",
    }
    assert webhook_outcome(admin, event_id) == "confirmed"
    actors = audit_actors(admin, p["id"])
    assert ("webhook", "paid") in actors and all(a != "reconcile" for a, _ in actors)
    row = admin.execute(
        "select p.status::text as status, l.status::text as lesson, "
        "l.calendar_sync_status::text as sync from public.payment_intents p "
        "join public.lessons l on l.id = p.lesson_id where p.id = %s",
        (p["id"],),
    ).fetchone()
    assert row == {"status": "paid", "lesson": "scheduled", "sync": "synced"}


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({"paid": "8000"}, "invalid_amount"),  # string não é trocada por amount
        ({"paid": True}, "invalid_amount"),
        ({"paid": 0}, "invalid_amount"),
        ({"paid": -8000}, "invalid_amount"),
        ({"paid": 8000.0}, "invalid_amount"),
        ({"paid": None, "amount": None}, "invalid_amount"),  # nenhum valor
        ({"paid": None, "amount": "8000"}, "invalid_amount"),
        ({"paid": None, "amount": 0}, "invalid_amount"),
        ({"paid": 7999}, "amount_mismatch"),
        ({"paid": None, "amount": 8001}, "amount_mismatch"),
    ],
)
def test_webhook_rejects_missing_invalid_or_divergent_amount(
    client, people, abacate, admin, kwargs, expected
) -> None:
    p = checkout(client, people, slot(client, people)).json()
    charge = charge_of(abacate, p)
    assert charge["amount"] == 8000
    assert post_webhook(client, webhook_body(charge, **kwargs)).json()["outcome"] == expected
    status = admin.execute(
        "select status::text as s from public.payment_intents where id = %s", (p["id"],)
    ).fetchone()["s"]
    assert status == "pending"  # nada confirmado
    # Uma entrega válida posterior (outro evento) ainda confirma.
    assert post_webhook(client, webhook_body(charge)).json()["outcome"] == "confirmed"


def test_concurrent_webhook_deliveries(client, people, abacate) -> None:
    p = checkout(client, people, slot(client, people)).json()
    charge = charge_of(abacate, p)
    abacate.pay(charge["id"])
    same = webhook_body(charge)
    bodies = [same, same, webhook_body(charge), webhook_body(charge)]
    outcomes: list[str] = []

    def deliver(body: bytes) -> None:
        outcomes.append(post_webhook(client, body).json()["outcome"])

    threads = [threading.Thread(target=deliver, args=(b,)) for b in bodies]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert outcomes.count("confirmed") == 1
    assert outcomes.count("duplicate") == 1  # o mesmo evento entregue duas vezes
    assert outcomes.count("already_processed") == 2
