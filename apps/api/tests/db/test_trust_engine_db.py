"""Trust Engine com banco real (descartável): fila, evidências, decisão, elegibilidade e contestação.

Provedores "confiáveis" usados aqui são FIXTURES DE TESTE (tests/test_trust_engine.py); o código de
produção só conhece adaptadores não configurados, que nunca aprovam.
"""

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.db import Database
from app.main import create_app
from app.trust.dispatcher import VerificationDispatcher
from app.trust.inspection import InspectionResult, inspect_bytes
from app.trust.providers import NotConfiguredAcademicRegistry, NotConfiguredIdentityProvider
from tests.db.test_onboarding_db import VERIFICATION, auth
from tests.test_onboarding_api import TEACHER
from tests.test_trust_engine import TrustedIdentity, TrustedRegistry

RULES = "trust-rules-2026.11-v1"
TRUST_TABLES = (
    "private.teacher_verification_jobs",
    "private.teacher_verification_evidence",
    "private.teacher_verification_decisions",
    "private.teacher_verification_contestations",
    "private.trust_rule_requirements",
    "private.teacher_credential_legacy_review",
)


class FakeInspector:
    """Substitui o download do Storage: devolve a inspeção de bytes fixos por caminho."""

    def __init__(self) -> None:
        self.content: dict[str, bytes] = {}

    def inspect(self, storage_path: str, user_token: str) -> InspectionResult:
        return inspect_bytes(self.content[storage_path])


@pytest.fixture
def database(api_database_url):
    return Database(api_database_url, min_size=0, max_size=4, connect_timeout=5)


@pytest.fixture
def client(settings, verifier, database):
    with TestClient(create_app(settings, token_verifier=verifier, database=database)) as c:
        c.app.state.document_inspector = FakeInspector()
        yield c


def dispatcher(database, *, trusted: bool) -> VerificationDispatcher:
    return VerificationDispatcher(
        database,
        identity_provider=TrustedIdentity() if trusted else NotConfiguredIdentityProvider(),
        academic_registry=TrustedRegistry() if trusted else NotConfiguredAcademicRegistry(),
        terms_version="teacher-terms-2026-11",
    )


def _pdf(seed: str) -> bytes:
    return b"%PDF-1.7\n% " + seed.encode() + b"\n%%EOF\n"


def upload(client, admin, teacher: uuid.UUID, token: str, kind: str, data: bytes) -> Any:
    """Simula o upload ao Storage (objeto do titular) e registra pela API com inspeção real."""
    path = f"{teacher}/{uuid.uuid4()}.pdf"
    admin.execute(
        "insert into storage.objects (bucket_id, name, owner_id, metadata) values "
        "('teacher-verification', %s, %s, %s)",
        (path, str(teacher), Jsonb({"mimetype": "application/pdf", "size": len(data)})),
    )
    client.app.state.document_inspector.content[path] = data
    return client.post(
        "/v1/me/teacher-verification/documents",
        json={"document_kind": kind, "storage_path": path},
        headers=auth(token),
    )


def teacher_with_dossier(client, users, make_token) -> tuple[uuid.UUID, str]:
    teacher = users.create("Prof Trust", email_confirmed=True)
    token = make_token(teacher)
    client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(token))
    assert (
        client.put("/v1/me/teacher-profile", json=TEACHER, headers=auth(token)).status_code == 200
    )
    saved = client.put("/v1/me/teacher-verification", json=VERIFICATION, headers=auth(token))
    assert saved.status_code == 200, saved.text
    return teacher, token


def submitted_teacher(client, users, make_token, admin, *, seed: str | None = None):
    teacher, token = teacher_with_dossier(client, users, make_token)
    seed = seed or teacher.hex
    for kind in ("identity", "academic_proof"):
        r = upload(client, admin, teacher, token, kind, _pdf(f"{seed}-{kind}"))
        assert r.status_code == 201, r.text
    submitted = client.post("/v1/me/teacher-verification/submit", headers=auth(token))
    assert submitted.status_code == 200, submitted.text
    return teacher, token


def state(admin, teacher: uuid.UUID) -> dict:
    return admin.execute(
        "select v.status::text as dossier, tp.verification_status::text as profile, "
        "tp.is_published from private.teacher_verifications v "
        "join public.teacher_profiles tp on tp.user_id = v.teacher_id where v.teacher_id = %s",
        (teacher,),
    ).fetchone()


def last_decision(admin, teacher: uuid.UUID) -> dict:
    return admin.execute(
        "select decision::text, actor_kind::text, service_name, actor_id, rules_version, reasons "
        "from private.teacher_verification_decisions where teacher_id = %s "
        "order by decided_at desc limit 1",
        (teacher,),
    ).fetchone()


def run_only(database, admin, teacher: uuid.UUID, *, trusted: bool) -> None:
    """Processa somente o job deste professor (isola de jobs de outros testes)."""
    admin.execute(
        "update private.teacher_verification_jobs set next_attempt_at = now() + interval '1 hour' "
        "where teacher_id <> %s and status = 'pending'",
        (teacher,),
    )
    dispatcher(database, trusted=trusted).dispatch(25)


# ------------------------------------------------------------------------- privilégios


def test_trust_tables_and_functions_are_private(admin) -> None:
    for table in TRUST_TABLES:
        row = admin.execute(
            "select has_table_privilege('anon', %s, 'select') as anon, "
            "has_table_privilege('authenticated', %s, 'select') as auth, "
            "has_table_privilege('edusearch_api', %s, 'select') as api",
            (table, table, table),
        ).fetchone()
        assert row == {"anon": False, "auth": False, "api": False}, table
    for fn in (
        "private.teacher_verification_claim(integer,integer)",
        "private.teacher_verification_record_decision(uuid,text,jsonb,private.trust_decision,text[])",
        "private.teacher_verification_job_context(uuid)",
        "private.admin_trust_resolve_contestation(uuid,uuid,text,text,uuid)",
    ):
        row = admin.execute(
            "select has_function_privilege('authenticated', %s, 'execute') as auth, "
            "has_function_privilege('anon', %s, 'execute') as anon, "
            "has_function_privilege('edusearch_api', %s, 'execute') as api",
            (fn, fn, fn),
        ).fetchone()
        assert row == {"auth": False, "anon": False, "api": True}, fn


def test_teacher_cannot_tamper_with_status_or_decisions(
    client, users, make_token, admin, as_user
) -> None:
    teacher, _ = teacher_with_dossier(client, users, make_token)
    for query in (
        "update private.teacher_verifications set status = 'approved'",
        "update public.teacher_profiles set verification_status = 'approved'",
        "insert into private.teacher_verification_decisions (teacher_id, decision, actor_kind, "
        "service_name) values (auth.uid(), 'approved', 'service', 'trust_engine')",
        "select private.teacher_verification_record_decision(gen_random_uuid(), "
        f"'{RULES}', '[]'::jsonb, 'approved', '{{}}')",
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            as_user(teacher).execute(query)
    # A API também não aceita estado vindo do cliente.
    body = VERIFICATION | {"status": "approved"}
    token = make_token(teacher)
    assert (
        client.put("/v1/me/teacher-verification", json=body, headers=auth(token)).status_code == 422
    )
    assert state(admin, teacher)["dossier"] == "draft"


# ------------------------------------------------------------------------- documentos


def test_document_content_is_inspected_and_duplicates_detected(
    client, users, make_token, admin
) -> None:
    teacher, token = teacher_with_dossier(client, users, make_token)
    data = _pdf(f"{teacher}-id")
    assert upload(client, admin, teacher, token, "identity", data).status_code == 201
    row = admin.execute(
        "select sha256, detected_content_type, inspection_status from "
        "private.teacher_verification_documents where teacher_id = %s",
        (teacher,),
    ).fetchone()
    assert row == {
        "sha256": hashlib.sha256(data).hexdigest(),
        "detected_content_type": "application/pdf",
        "inspection_status": "passed",
    }
    # Mesmo arquivo de novo (outro objeto): duplicidade detectada pelo hash.
    again = upload(client, admin, teacher, token, "academic_proof", data)
    assert (again.status_code, again.json()["code"]) == (409, "document_already_registered")
    # Executável renomeado para .pdf: recusado pelo conteúdo, não pelo MIME declarado.
    fake = upload(client, admin, teacher, token, "academic_proof", b"MZ\x90\x00binario")
    assert (fake.status_code, fake.json()["code"]) == (422, "document_content_rejected")


def test_documents_are_isolated_between_teachers(client, users, make_token, admin, as_user) -> None:
    a, token_a = teacher_with_dossier(client, users, make_token)
    b, token_b = teacher_with_dossier(client, users, make_token)
    assert upload(client, admin, a, token_a, "identity", _pdf(f"{a}-iso")).status_code == 201
    path_a = admin.execute(
        "select storage_path from private.teacher_verification_documents where teacher_id = %s",
        (a,),
    ).fetchone()["storage_path"]
    stolen = client.post(
        "/v1/me/teacher-verification/documents",
        json={"document_kind": "identity", "storage_path": path_a},
        headers=auth(token_b),
    )
    assert (stolen.status_code, stolen.json()["code"]) == (422, "invalid_document_path")
    visible = as_user(b).rows(
        "select name from storage.objects where bucket_id = 'teacher-verification'"
    )
    assert path_a not in {r["name"] for r in visible}
    assert path_a in {
        r["name"]
        for r in as_user(a).rows(
            "select name from storage.objects where bucket_id = 'teacher-verification'"
        )
    }


# ------------------------------------------------------------------------- decisões


def test_without_trusted_sources_dossier_stays_pending_and_unpublished(
    client, users, make_token, admin, database
) -> None:
    teacher, token = submitted_teacher(client, users, make_token, admin)
    run_only(database, admin, teacher, trusted=False)
    assert state(admin, teacher) == {
        "dossier": "pending_external",
        "profile": "pending",
        "is_published": False,
    }
    decision = last_decision(admin, teacher)
    assert (decision["decision"], decision["actor_kind"], decision["service_name"]) == (
        "pending_external",
        "service",
        "trust_engine",
    )
    assert decision["actor_id"] is None and decision["rules_version"] == RULES
    progress = client.get("/v1/me/teacher-verification/progress", headers=auth(token)).json()
    by_req = {e["requirement"]: e for e in progress["evidence"]}
    assert by_req["identity.verified"]["result"] == "unavailable"
    assert by_req["document.identity_valid"]["result"] == "passed"
    assert progress["decision"]["contestable"] is True


def test_automatic_approval_with_sufficient_evidence_publishes(
    client, users, make_token, admin, database
) -> None:
    teacher, _ = submitted_teacher(client, users, make_token, admin)
    run_only(database, admin, teacher, trusted=True)
    assert state(admin, teacher) == {
        "dossier": "approved",
        "profile": "approved",
        "is_published": True,
    }
    assert last_decision(admin, teacher)["decision"] == "approved"
    docs = admin.execute(
        "select status::text, reviewer_id, reviewed_by_service from "
        "private.teacher_verification_documents where teacher_id = %s",
        (teacher,),
    ).fetchall()
    assert all(
        d == {"status": "accepted", "reviewer_id": None, "reviewed_by_service": "trust_engine"}
        for d in docs
    )
    outbox = admin.execute(
        "select template_alias from private.notification_outbox where recipient_user_id = %s",
        (teacher,),
    ).fetchall()
    assert {r["template_alias"] for r in outbox} >= {
        "edusearch-credenciamento-recebido-v1",
        "edusearch-credenciamento-aprovado-v1",
    }


def _claim_job(admin, teacher) -> uuid.UUID:
    admin.execute(
        "update private.teacher_verification_jobs set status = 'processing', locked_at = now(), "
        "attempts = 1 where teacher_id = %s",
        (teacher,),
    )
    return admin.execute(
        "select id from private.teacher_verification_jobs where teacher_id = %s", (teacher,)
    ).fetchone()["id"]


def _evidence(requirement: str, source: str, result: str = "passed") -> dict:
    return {
        "validator": "identity_validator",
        "requirement": requirement,
        "result": result,
        "source": source,
        "reason_code": "test.evidence",
        "details": {},
        "observed_at": datetime.now(UTC).isoformat(),
    }


@pytest.mark.parametrize(
    "evidence",
    [
        [],  # nenhuma evidência
        [_evidence("identity.verified", "self_declared")],  # identidade apenas declarada
        [_evidence(r, "external_registry") for r in ("identity.verified",)],  # incompleto
    ],
)
def test_database_refuses_approval_without_proven_requirements(
    client, users, make_token, admin, evidence
) -> None:
    teacher, _ = submitted_teacher(client, users, make_token, admin)
    job = _claim_job(admin, teacher)
    with pytest.raises(psycopg.errors.RaiseException, match="trust_approval_requirements_unmet"):
        admin.execute(
            "select private.teacher_verification_record_decision(%s, %s, %s, 'approved', '{}')",
            (job, RULES, Jsonb(evidence)),
        )
    assert state(admin, teacher)["dossier"] == "submitted"


def test_automated_rejection_is_not_allowed(client, users, make_token, admin) -> None:
    teacher, _ = submitted_teacher(client, users, make_token, admin)
    job = _claim_job(admin, teacher)
    with pytest.raises(
        psycopg.errors.InvalidParameterValue, match="trust_decision_not_automatable"
    ):
        admin.execute(
            "select private.teacher_verification_record_decision(%s, %s, '[]', 'rejected', '{}')",
            (job, RULES),
        )


def test_missing_documents_return_dossier_to_teacher(
    client, users, make_token, admin, database
) -> None:
    teacher, _ = submitted_teacher(client, users, make_token, admin)
    reviewer = users.create("Revisor")
    admin.execute(
        "update private.teacher_verification_documents set status = 'rejected', "
        "reviewed_at = now(), reviewer_id = %s "
        "where teacher_id = %s and document_kind = 'academic_proof'",
        (reviewer, teacher),
    )
    run_only(database, admin, teacher, trusted=True)
    assert state(admin, teacher)["dossier"] == "changes_requested"
    assert "document.academic_proof_missing" in last_decision(admin, teacher)["reasons"]
    submitted_at = admin.execute(
        "select submitted_at from private.teacher_verifications where teacher_id = %s", (teacher,)
    ).fetchone()["submitted_at"]
    assert submitted_at is None


def test_document_reused_by_other_account_goes_to_manual_review(
    client, users, make_token, admin, database
) -> None:
    shared = f"shared-{uuid.uuid4().hex}"
    first, _ = submitted_teacher(client, users, make_token, admin, seed=shared)
    second, _ = submitted_teacher(client, users, make_token, admin, seed=shared)
    run_only(database, admin, second, trusted=True)
    assert state(admin, second)["dossier"] == "under_review"
    assert last_decision(admin, second)["decision"] == "manual_review"
    assert state(admin, first)["dossier"] == "submitted"


def test_job_is_superseded_when_dossier_already_moved(
    client, users, make_token, admin, database
) -> None:
    teacher, _ = submitted_teacher(client, users, make_token, admin)
    admin.execute(
        "update private.teacher_verifications set status = 'under_review' where teacher_id = %s",
        (teacher,),
    )
    run_only(database, admin, teacher, trusted=True)
    job = admin.execute(
        "select status::text, error_code from private.teacher_verification_jobs "
        "where teacher_id = %s",
        (teacher,),
    ).fetchone()
    assert job == {"status": "completed", "error_code": "submission_superseded"}
    assert state(admin, teacher)["dossier"] == "under_review"


# ------------------------------------------------------------------------- fila


def test_concurrent_claims_never_share_a_job(
    client, users, make_token, admin, api_database_url
) -> None:
    teacher, _ = submitted_teacher(client, users, make_token, admin)
    job = admin.execute(
        "select id from private.teacher_verification_jobs where teacher_id = %s", (teacher,)
    ).fetchone()["id"]
    with (
        psycopg.connect(api_database_url) as first,
        psycopg.connect(api_database_url) as second,
    ):
        a = {
            r[0]
            for r in first.execute("select id from private.teacher_verification_claim(25, 300)")
        }
        b = {
            r[0]
            for r in second.execute("select id from private.teacher_verification_claim(25, 300)")
        }
        assert job in a | b
        assert not (a & b)
        first.rollback()
        second.rollback()


def test_interrupted_job_is_recovered_after_lease(client, users, make_token, admin) -> None:
    teacher, _ = submitted_teacher(client, users, make_token, admin)
    admin.execute(
        "update private.teacher_verification_jobs set status = 'processing', attempts = 1, "
        "locked_at = now() - interval '10 minutes' where teacher_id = %s",
        (teacher,),
    )
    claimed = admin.execute("select teacher_id from private.teacher_verification_claim(25, 300)")
    assert teacher in {r["teacher_id"] for r in claimed.fetchall()}


def test_claim_never_exceeds_attempt_limit(client, users, make_token, admin) -> None:
    teacher, _ = submitted_teacher(client, users, make_token, admin)
    admin.execute(
        "update private.teacher_verification_jobs set attempts = 10 where teacher_id = %s",
        (teacher,),
    )
    claimed = admin.execute("select teacher_id from private.teacher_verification_claim(25, 300)")
    assert teacher not in {r["teacher_id"] for r in claimed.fetchall()}
    job = admin.execute(
        "select status::text, error_code from private.teacher_verification_jobs "
        "where teacher_id = %s",
        (teacher,),
    ).fetchone()
    assert job == {"status": "failed", "error_code": "attempts_exhausted"}
    assert state(admin, teacher)["dossier"] == "submitted"


def test_failed_job_is_requeued_with_backoff_and_sanitized(
    client, users, make_token, admin
) -> None:
    teacher, _ = submitted_teacher(client, users, make_token, admin)
    job = _claim_job(admin, teacher)
    result = admin.execute(
        "select private.teacher_verification_job_failed(%s, 'Invalid Code!') as r", (job,)
    ).fetchone()["r"]
    row = admin.execute(
        "select status::text, error_code, next_attempt_at > now() as delayed "
        "from private.teacher_verification_jobs where id = %s",
        (job,),
    ).fetchone()
    assert result == "retry"
    assert row == {"status": "pending", "error_code": "unexpected_error", "delayed": True}


# ------------------------------------------------------------------ elegibilidade comercial


def test_publication_without_credential_is_blocked(client, users, make_token, admin) -> None:
    teacher, _ = teacher_with_dossier(client, users, make_token)
    for assignment in (
        "verification_status = 'approved', verified_at = now()",
        "verification_status = 'approved', verified_at = now(), is_published = true, "
        "published_at = now()",
    ):
        with pytest.raises(psycopg.errors.RaiseException, match="teacher_credential_required"):
            admin.execute(
                f"update public.teacher_profiles set {assignment} where user_id = %s",  # noqa: S608
                (teacher,),
            )


def test_uncredentialed_teacher_is_not_searchable_nor_bookable(
    client, users, make_token, admin, as_user
) -> None:
    teacher, _ = submitted_teacher(client, users, make_token, admin)
    student = users.create("Aluna", email_confirmed=True)
    users.grant_role(student, "student")
    # A busca pública e o perfil público passam pela RLS de teacher_profiles (is_published).
    visible = as_user(student).rows(
        "select user_id from public.teacher_profiles where user_id = %s", (teacher,)
    )
    assert visible == []
    starts = datetime.now(UTC) + timedelta(days=3)
    subject = admin.execute("select id from public.subjects order by id limit 1").fetchone()["id"]
    with admin.transaction():
        admin.execute(
            "select set_config('request.jwt.claims', %s, true)",
            (json.dumps({"sub": str(student), "role": "authenticated"}),),
        )
        with (
            pytest.raises(psycopg.errors.RaiseException, match="teacher_not_found"),
            admin.transaction(),
        ):
            admin.execute(
                "select * from private.payment_create_hold(%s, %s::smallint, %s, %s, %s, 'sandbox', 900)",
                (teacher, subject, starts, starts + timedelta(hours=1), uuid.uuid4()),
            )


# ------------------------------------------------------------------- contestação e Admin


def grant_admin(admin, user_id, role="operations_admin") -> None:
    admin.execute("update public.profiles set status = 'active' where id = %s", (user_id,))
    admin.execute(
        "insert into private.admin_memberships (user_id, role) values (%s, %s::private.admin_role)",
        (user_id, role),
    )


def test_contestation_and_human_review_never_approve(
    client, users, make_token, admin, database
) -> None:
    teacher, token = submitted_teacher(client, users, make_token, admin)
    run_only(database, admin, teacher, trusted=False)
    short = client.post(
        "/v1/me/teacher-verification/contest", json={"reason": "curto"}, headers=auth(token)
    )
    assert short.status_code == 422
    reason = "Meu diploma é digital e pode ser validado no portal do emissor."
    contested = client.post(
        "/v1/me/teacher-verification/contest", json={"reason": reason}, headers=auth(token)
    )
    assert contested.status_code == 200, contested.text
    assert contested.json()["status"] == "under_review"
    assert contested.json()["contestation"]["status"] == "open"
    again = client.post(
        "/v1/me/teacher-verification/contest", json={"reason": reason}, headers=auth(token)
    )
    assert again.json()["code"] == "contestation_not_allowed"

    operator = users.create("Operações", email_confirmed=True)
    grant_admin(admin, operator)
    headers = auth(make_token(operator))
    overview = client.get("/v1/admin/trust", headers=headers)
    assert overview.status_code == 200, overview.text
    contestation = next(
        c for c in overview.json()["contestations"] if c["teacher_id"] == str(teacher)
    )
    approve = client.post(
        f"/v1/admin/trust/contestations/{contestation['id']}/resolve",
        headers=headers,
        json={"resolution": "approve", "justification": "Tentativa de aprovação manual"},
    )
    assert approve.status_code == 422
    detail = client.get(f"/v1/admin/trust/teachers/{teacher}", headers=headers).json()
    assert "birth_date" not in json.dumps(detail) and "storage_path" not in json.dumps(detail)
    assert detail["jobs"][0]["evidence"]

    reprocess = client.post(
        f"/v1/admin/trust/contestations/{contestation['id']}/resolve",
        headers=headers,
        json={"resolution": "reprocess", "justification": "Reprocessar com as regras atuais"},
    )
    assert reprocess.status_code == 200, reprocess.text
    assert state(admin, teacher)["dossier"] == "submitted"
    jobs = admin.execute(
        "select count(*) as n from private.teacher_verification_jobs where teacher_id = %s",
        (teacher,),
    ).fetchone()["n"]
    assert jobs == 2
    run_only(database, admin, teacher, trusted=False)
    assert state(admin, teacher) == {
        "dossier": "pending_external",
        "profile": "pending",
        "is_published": False,
    }


def test_admin_rejection_after_contest_is_human_and_audited(
    client, users, make_token, admin, database
) -> None:
    teacher, token = submitted_teacher(client, users, make_token, admin)
    run_only(database, admin, teacher, trusted=False)
    reason = "Solicito revisão: os documentos enviados são autênticos e legíveis."
    client.post("/v1/me/teacher-verification/contest", json={"reason": reason}, headers=auth(token))
    contestation = admin.execute(
        "select id from private.teacher_verification_contestations where teacher_id = %s",
        (teacher,),
    ).fetchone()["id"]
    operator = users.create("Operações", email_confirmed=True)
    grant_admin(admin, operator)
    support = users.create("Suporte", email_confirmed=True)
    grant_admin(admin, support, "support_admin")
    denied = client.post(
        f"/v1/admin/trust/contestations/{contestation}/resolve",
        headers=auth(make_token(support)),
        json={"resolution": "reject", "justification": "Sem permissão"},
    )
    assert denied.status_code == 403
    rejected = client.post(
        f"/v1/admin/trust/contestations/{contestation}/resolve",
        headers=auth(make_token(operator)),
        json={"resolution": "reject", "justification": "Documento ilegível após revisão"},
    )
    assert rejected.status_code == 200, rejected.text
    assert state(admin, teacher) == {
        "dossier": "rejected",
        "profile": "rejected",
        "is_published": False,
    }
    decision = last_decision(admin, teacher)
    assert (decision["decision"], decision["actor_kind"], decision["actor_id"]) == (
        "rejected",
        "human",
        operator,
    )
    audit = admin.execute(
        "select action from private.admin_audit_log where actor_id = %s and resource_id = %s",
        (operator, teacher),
    ).fetchall()
    assert "trust.contestation_resolved" in {r["action"] for r in audit}
