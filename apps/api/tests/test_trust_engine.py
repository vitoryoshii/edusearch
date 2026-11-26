"""Trust Engine sem banco: validadores, decisão, inspeção de conteúdo, dispatcher e endpoint."""

import hashlib
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.config import Settings
from app.main import create_app
from app.trust.dispatcher import VerificationDispatcher
from app.trust.engine import MANDATORY, VerificationDecisionEngine
from app.trust.inspection import (
    DocumentNotFoundError,
    InspectionUnavailableError,
    StorageDocumentInspector,
    inspect_bytes,
)
from app.trust.models import Evidence
from app.trust.providers import NotConfiguredAcademicRegistry, NotConfiguredIdentityProvider
from app.trust.validators import (
    AcademicValidator,
    DocumentValidator,
    FraudDetectionService,
    IdentityValidator,
    RegistrationValidator,
)

SECRET = "trust-dispatch-secret-for-tests-0123456789"
TERMS = "teacher-terms-2026-11"
PDF = b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16 + b"IEND\xaeB`\x82"


def _doc(kind: str, **extra: Any) -> dict[str, Any]:
    return {
        "kind": kind,
        "version": 1,
        "status": "quarantined",
        "inspection_status": "passed",
        "inspection_code": "inspection.content_verified",
        "detected_content_type": "application/pdf",
        "content_type": "application/pdf",
        "size_bytes": 1024,
        "signature_present": False,
        "duplicate_other_teachers": 0,
        "duplicate_own_kinds": 0,
        **extra,
    }


def context(**overrides: Any) -> dict[str, Any]:
    base = {
        "qualification_kind": "graduated",
        "institution_present": True,
        "qualification_present": True,
        "experience_length": 120,
        "curriculum_length": 120,
        "is_adult": True,
        "tax_id_kind": "cpf",
        "tax_id_last4_present": True,
        "terms_version": TERMS,
        "submissions_last_7_days": 1,
        "documents": [_doc("identity"), _doc("academic_proof")],
    }
    return base | overrides


class TrustedIdentity:
    """FIXTURE DE TESTE: provedor que comprova identidade. Não existe no código de produção."""

    name = "test-fixture"

    def verify_identity(self, context: dict[str, Any]) -> Evidence:
        return Evidence(
            "identity_validator",
            "identity.verified",
            "passed",
            "external_registry",
            "identity.verified_by_fixture",
        )


class TrustedRegistry:
    name = "test-fixture"

    def verify_issuer(self, context: dict[str, Any]) -> Evidence:
        return Evidence(
            "academic_validator",
            "academic.issuer_verified",
            "passed",
            "external_registry",
            "academic.verified_by_fixture",
        )


def evaluate(ctx: dict[str, Any], identity: Any = None, registry: Any = None) -> list[Evidence]:
    validators = [
        RegistrationValidator(TERMS),
        IdentityValidator(identity or NotConfiguredIdentityProvider()),
        DocumentValidator(),
        AcademicValidator(registry or NotConfiguredAcademicRegistry()),
        FraudDetectionService(),
    ]
    return [item for v in validators for item in v.validate(ctx)]


# ----------------------------------------------------------------------------- decisão


def test_without_trusted_sources_verification_stays_pending() -> None:
    decision = VerificationDecisionEngine().decide(evaluate(context()))
    assert decision.decision == "pending_external"
    assert "identity.trusted_source_unavailable" in decision.reasons
    assert "academic.trusted_source_unavailable" in decision.reasons


def test_approves_only_with_every_mandatory_requirement_proven() -> None:
    evidence = evaluate(context(), TrustedIdentity(), TrustedRegistry())
    assert VerificationDecisionEngine().decide(evidence).decision == "approved"
    assert {e.requirement for e in evidence} >= set(MANDATORY)


def test_self_declared_identity_never_counts_as_proof() -> None:
    class DeclaredIdentity(TrustedIdentity):
        def verify_identity(self, context: dict[str, Any]) -> Evidence:
            return Evidence(
                "identity_validator", "identity.verified", "passed", "self_declared", "x.declared"
            )

    evidence = evaluate(context(), DeclaredIdentity(), TrustedRegistry())
    assert VerificationDecisionEngine().decide(evidence).decision == "pending_external"


def test_missing_document_requests_changes() -> None:
    evidence = evaluate(context(documents=[_doc("identity")]), TrustedIdentity(), TrustedRegistry())
    decision = VerificationDecisionEngine().decide(evidence)
    assert decision.decision == "changes_requested"
    assert "document.academic_proof_missing" in decision.reasons


def test_outdated_terms_and_underage_request_changes() -> None:
    evidence = evaluate(context(terms_version="teacher-terms-2025-01", is_adult=False))
    decision = VerificationDecisionEngine().decide(evidence)
    assert decision.decision == "changes_requested"
    assert {"registration.terms_outdated", "registration.underage"} <= set(decision.reasons)


def test_document_reused_by_other_account_goes_to_manual_review() -> None:
    docs = [_doc("identity", duplicate_other_teachers=1), _doc("academic_proof")]
    evidence = evaluate(context(documents=docs), TrustedIdentity(), TrustedRegistry())
    decision = VerificationDecisionEngine().decide(evidence)
    assert decision.decision == "manual_review"
    assert decision.reasons == ["fraud.document_reused_by_other_account"]


def test_same_file_for_identity_and_diploma_is_invalid() -> None:
    docs = [_doc("identity", duplicate_own_kinds=1), _doc("academic_proof", duplicate_own_kinds=1)]
    evidence = evaluate(context(documents=docs), TrustedIdentity(), TrustedRegistry())
    decision = VerificationDecisionEngine().decide(evidence)
    assert decision.decision == "changes_requested"
    assert "document.reused_across_kinds" in decision.reasons


def test_uninspected_document_cannot_be_approved() -> None:
    docs = [_doc("identity", inspection_status="pending"), _doc("academic_proof")]
    evidence = evaluate(context(documents=docs), TrustedIdentity(), TrustedRegistry())
    assert VerificationDecisionEngine().decide(evidence).decision == "pending_external"


def test_provider_error_is_unavailable_not_approved() -> None:
    class Broken(TrustedIdentity):
        def verify_identity(self, context: dict[str, Any]) -> Evidence:
            raise TimeoutError

    evidence = evaluate(context(), Broken(), TrustedRegistry())
    identity = next(e for e in evidence if e.requirement == "identity.verified")
    assert (identity.result, identity.reason_code) == ("unavailable", "identity.provider_error")
    assert VerificationDecisionEngine().decide(evidence).decision == "pending_external"


def test_tax_id_format_is_informative_only() -> None:
    evidence = evaluate(context())
    tax = next(e for e in evidence if e.requirement == "registration.tax_id_declared")
    assert tax.details == {"proves_identity": False}
    assert "registration.tax_id_declared" not in MANDATORY


# ----------------------------------------------------------------------------- inspeção


def test_inspection_detects_real_type_and_hash() -> None:
    result = inspect_bytes(PDF)
    assert result.ok and result.detected_content_type == "application/pdf"
    assert result.sha256 == hashlib.sha256(PDF).hexdigest()
    assert inspect_bytes(PNG).detected_content_type == "image/png"


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"", "inspection.empty"),
        (b"MZ\x90\x00 executavel renomeado para .pdf", "inspection.unknown_format"),
        (b"%PDF-1.7\nsem fim", "inspection.pdf_truncated"),
        (b"%PDF-1.7\n/Encrypt 1 0 R\n%%EOF", "inspection.pdf_encrypted"),
        (b"%PDF-1.7\n/OpenAction<</JavaScript(x)>>\n%%EOF", "inspection.pdf_active_content"),
        (b"\x89PNG\r\n\x1a\nsem-fim", "inspection.image_truncated"),
        (b"%PDF-" + b"0" * (10 * 1024 * 1024), "inspection.too_large"),
    ],
)
def test_inspection_rejects_invalid_content(data: bytes, code: str) -> None:
    result = inspect_bytes(data)
    assert (result.ok, result.code) == (False, code)


def test_pdf_signature_presence_is_detected_but_not_trusted() -> None:
    signed = b"%PDF-1.7\n<</Type/Sig/ByteRange[0 1 2 3]>>\n%%EOF"
    assert inspect_bytes(signed).signature_present is True


def test_storage_inspector_uses_owner_token_and_maps_errors() -> None:
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["authorization"]
        seen["url"] = str(request.url)
        if "missing" in request.url.path:
            return httpx.Response(404)
        if "down" in request.url.path:
            return httpx.Response(503)
        return httpx.Response(200, content=PDF)

    inspector = StorageDocumentInspector(
        "https://x.supabase.co", "sb_publishable_x", transport=httpx.MockTransport(handler)
    )
    assert inspector.inspect("u/a.pdf", "user-token").ok
    assert seen["auth"] == "Bearer user-token"
    assert "/storage/v1/object/authenticated/teacher-verification/u/a.pdf" in seen["url"]
    with pytest.raises(DocumentNotFoundError):
        inspector.inspect("u/missing.pdf", "user-token")
    with pytest.raises(InspectionUnavailableError):
        inspector.inspect("u/down.pdf", "user-token")


# ----------------------------------------------------------------------------- dispatcher


class _Result:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def fetchall(self) -> list[dict[str, Any]]:
        return self._rows

    def fetchone(self) -> dict[str, Any]:
        return self._rows[0]


class FakeDatabase:
    def __init__(self, jobs: dict[str, Any], failure_result: str = "retry") -> None:
        self.jobs = jobs
        self.failure_result = failure_result
        self.recorded: list[tuple[Any, ...]] = []
        self.failed: list[tuple[Any, ...]] = []

    @contextmanager
    def service_transaction(self) -> Iterator["FakeDatabase"]:
        yield self

    def execute(self, sql: str, params: tuple[Any, ...]) -> _Result:
        if "teacher_verification_claim" in sql:
            return _Result([{"id": job} for job in self.jobs])
        if "job_context" in sql:
            ctx = self.jobs[params[0]]
            if isinstance(ctx, Exception):
                raise ctx
            return _Result([{"ctx": ctx}])
        if "record_decision" in sql:
            self.recorded.append(params)
            return _Result(
                [{"outcome": params[3] if params[3] != "manual_review" else "under_review"}]
            )
        if "job_failed" in sql:
            self.failed.append(params)
            return _Result([{"result": self.failure_result}])
        raise AssertionError(sql)


def _dispatcher(db: FakeDatabase, **kwargs: Any) -> VerificationDispatcher:
    return VerificationDispatcher(
        db,  # type: ignore[arg-type]
        identity_provider=NotConfiguredIdentityProvider(),
        academic_registry=NotConfiguredAcademicRegistry(),
        terms_version=TERMS,
        **kwargs,
    )


def test_dispatch_records_evidence_and_requeues_failures() -> None:
    db = FakeDatabase({"a": context(), "b": RuntimeError("boom")})
    summary = _dispatcher(db).dispatch(10)
    assert (summary["claimed"], summary["pending_external"], summary["retried"]) == (2, 1, 1)
    job, rules, evidence, decision, reasons = db.recorded[0]
    assert (job, rules, decision) == ("a", "trust-rules-2026.11-v1", "pending_external")
    assert {item["requirement"] for item in evidence.obj} >= set(MANDATORY)
    assert db.failed == [("b", "processing_error")]


def test_dispatch_never_approves_without_providers() -> None:
    db = FakeDatabase({f"j{i}": context() for i in range(5)})
    _dispatcher(db).dispatch(10)
    assert {params[3] for params in db.recorded} == {"pending_external"}


def test_dispatch_respects_time_budget() -> None:
    ticks = iter([0.0, 0.0, 100.0, 100.0])
    db = FakeDatabase({"a": context(), "b": context()})
    summary = _dispatcher(db, budget_seconds=5, clock=lambda: next(ticks)).dispatch(10)
    assert (summary["pending_external"], summary["deferred"]) == (1, 1)


def test_exhausted_job_is_counted_as_failed() -> None:
    db = FakeDatabase({"a": RuntimeError("boom")}, failure_result="failed")
    assert _dispatcher(db).dispatch(10)["failed"] == 1


# ----------------------------------------------------------------------------- endpoint


def _client(settings: Settings, database: Any = None) -> TestClient:
    return TestClient(create_app(settings, database=database, check_connection_role=False))


def test_endpoint_rejects_missing_or_wrong_secret(settings: Settings) -> None:
    settings.trust_dispatch_secret = SecretStr(SECRET)
    client = _client(settings, FakeDatabase({}))
    assert client.post("/v1/internal/trust/dispatch").status_code == 401
    wrong = client.post("/v1/internal/trust/dispatch", headers={"X-Trust-Dispatch-Secret": "x"})
    assert wrong.status_code == 401


def test_endpoint_does_not_accept_notifications_secret(settings: Settings) -> None:
    settings.trust_dispatch_secret = SecretStr(SECRET)
    settings.notifications_dispatch_secret = SecretStr("notifications-secret-0123456789abcdef")
    response = _client(settings, FakeDatabase({})).post(
        "/v1/internal/trust/dispatch",
        headers={"X-Notifications-Dispatch-Secret": "notifications-secret-0123456789abcdef"},
    )
    assert response.status_code == 401


def test_endpoint_is_closed_without_configured_secret(settings: Settings) -> None:
    client = _client(settings, FakeDatabase({}))
    response = client.post("/v1/internal/trust/dispatch", headers={"X-Trust-Dispatch-Secret": ""})
    assert response.status_code == 401


def test_endpoint_without_database_is_unavailable(settings: Settings) -> None:
    settings.trust_dispatch_secret = SecretStr(SECRET)
    response = _client(settings).post(
        "/v1/internal/trust/dispatch", headers={"X-Trust-Dispatch-Secret": SECRET}
    )
    assert response.status_code == 503


def test_endpoint_dispatches_with_valid_secret(settings: Settings) -> None:
    settings.trust_dispatch_secret = SecretStr(SECRET)
    response = _client(settings, FakeDatabase({"a": context()})).post(
        "/v1/internal/trust/dispatch", headers={"X-Trust-Dispatch-Secret": SECRET}
    )
    assert response.status_code == 200
    assert response.json()["pending_external"] == 1


def test_short_dispatch_secret_is_rejected_at_startup() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, trust_dispatch_secret="curto")


def test_only_unconfigured_providers_exist() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, trust_identity_provider="fake")


def test_dossier_summary_document_key_maps_to_public_contract() -> None:
    from app.services.onboarding import _document_out

    out = _document_out(
        {
            "kind": "identity",
            "version": 1,
            "status": "quarantined",
            "uploaded_at": "2026-11-26T00:00:00Z",
        }
    )
    assert out.document_kind == "identity"
