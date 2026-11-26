"""Validadores do Trust Engine. Determinísticos, sem IA e sem dados pessoais nas evidências.

Cada validador recebe o contexto derivado do dossiê (private.teacher_verification_job_context, que
não expõe data de nascimento nem dígitos fiscais) e devolve evidências estruturadas.
"""

from typing import Any

from app.trust.models import Evidence
from app.trust.providers import AcademicRegistry, IdentityProvider


def _documents(context: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {doc["kind"]: doc for doc in context.get("documents") or []}


class RegistrationValidator:
    """Validação cadastral: termos, perfil profissional, idade declarada e documento fiscal."""

    name = "registration_validator"

    def __init__(self, current_terms_version: str) -> None:
        self._terms = current_terms_version

    def validate(self, context: dict[str, Any]) -> list[Evidence]:
        terms_ok = context.get("terms_version") == self._terms
        complete = bool(
            context.get("qualification_kind")
            and context.get("institution_present")
            and context.get("qualification_present")
            and int(context.get("experience_length") or 0) >= 10
            and int(context.get("curriculum_length") or 0) >= 10
        )
        tax_declared = bool(context.get("tax_id_kind") and context.get("tax_id_last4_present"))
        return [
            Evidence(
                self.name,
                "registration.terms_current",
                "passed" if terms_ok else "failed",
                "self_declared",
                "registration.terms_accepted" if terms_ok else "registration.terms_outdated",
                {"required_version": self._terms},
            ),
            Evidence(
                self.name,
                "registration.profile_complete",
                "passed" if complete else "failed",
                "self_declared",
                "registration.profile_complete" if complete else "registration.profile_incomplete",
            ),
            Evidence(
                self.name,
                "registration.adult",
                "passed" if context.get("is_adult") else "failed",
                "self_declared",
                "registration.adult_declared"
                if context.get("is_adult")
                else "registration.underage",
            ),
            # Formato/declaração do CPF/CNPJ não comprova identidade: por isso é informativo.
            Evidence(
                self.name,
                "registration.tax_id_declared",
                "passed" if tax_declared else "inconclusive",
                "self_declared",
                "registration.tax_id_format_only"
                if tax_declared
                else "registration.tax_id_missing",
                {"proves_identity": False},
            ),
        ]


class DocumentValidator:
    """Validação documental baseada na inspeção real do conteúdo feita no registro do arquivo."""

    name = "document_validator"
    _REQUIRED = {"identity": "document.identity_valid", "academic_proof": "document.academic_valid"}

    def _check(self, requirement: str, kind: str, doc: dict[str, Any] | None) -> Evidence:
        prefix = "document." + ("identity" if kind == "identity" else kind)
        if doc is None:
            return Evidence(self.name, requirement, "failed", "file_analysis", f"{prefix}_missing")
        if doc.get("inspection_status") == "pending":
            return Evidence(
                self.name,
                requirement,
                "unavailable",
                "file_analysis",
                "document.inspection_unavailable",
            )
        if doc.get("inspection_status") != "passed":
            return Evidence(
                self.name,
                requirement,
                "failed",
                "file_analysis",
                str(doc.get("inspection_code") or "document.inspection_failed"),
            )
        if doc.get("detected_content_type") != doc.get("content_type"):
            return Evidence(
                self.name, requirement, "failed", "file_analysis", "document.content_mismatch"
            )
        if int(doc.get("duplicate_own_kinds") or 0) > 0:
            return Evidence(
                self.name, requirement, "failed", "file_analysis", "document.reused_across_kinds"
            )
        return Evidence(
            self.name,
            requirement,
            "passed",
            "file_analysis",
            "document.content_verified",
            {
                "detected_content_type": doc.get("detected_content_type"),
                "size_bytes": doc.get("size_bytes"),
                "version": doc.get("version"),
            },
        )

    def validate(self, context: dict[str, Any]) -> list[Evidence]:
        docs = _documents(context)
        evidence = [self._check(req, kind, docs.get(kind)) for kind, req in self._REQUIRED.items()]
        curriculum = docs.get("curriculum")
        if curriculum is None:
            evidence.append(
                Evidence(
                    self.name,
                    "document.curriculum_valid",
                    "inconclusive",
                    "file_analysis",
                    "document.curriculum_not_provided",
                )
            )
        else:
            evidence.append(self._check("document.curriculum_valid", "curriculum", curriculum))
        return evidence


class IdentityValidator:
    name = "identity_validator"

    def __init__(self, provider: IdentityProvider) -> None:
        self._provider = provider

    def validate(self, context: dict[str, Any]) -> list[Evidence]:
        try:
            return [self._provider.verify_identity(context)]
        except Exception:  # noqa: BLE001 — indisponibilidade externa nunca vira aprovação
            return [
                Evidence(
                    self.name,
                    "identity.verified",
                    "unavailable",
                    "external_registry",
                    "identity.provider_error",
                    {"provider": self._provider.name},
                )
            ]


class AcademicValidator:
    name = "academic_validator"

    def __init__(self, registry: AcademicRegistry) -> None:
        self._registry = registry

    def validate(self, context: dict[str, Any]) -> list[Evidence]:
        try:
            issuer = self._registry.verify_issuer(context)
        except Exception:  # noqa: BLE001
            issuer = Evidence(
                self.name,
                "academic.issuer_verified",
                "unavailable",
                "external_registry",
                "academic.provider_error",
                {"provider": self._registry.name},
            )
        academic = _documents(context).get("academic_proof") or {}
        # Presença de assinatura embutida NÃO é validação da cadeia ICP-Brasil: fica informativa.
        signature = Evidence(
            self.name,
            "academic.digital_signature",
            "inconclusive",
            "digital_signature" if academic.get("signature_present") else "file_analysis",
            "academic.signature_present_not_validated"
            if academic.get("signature_present")
            else "academic.signature_absent",
        )
        return [issuer, signature]


class CurriculumAnalyzer:
    """Análise determinística da experiência declarada. Não usa IA nem envia dados a terceiros."""

    name = "curriculum_analyzer"

    def validate(self, context: dict[str, Any]) -> list[Evidence]:
        experience = int(context.get("experience_length") or 0)
        summary = int(context.get("curriculum_length") or 0)
        return [
            Evidence(
                self.name,
                "curriculum.experience_described",
                "passed" if experience >= 80 else "inconclusive",
                "self_declared",
                "curriculum.experience_described"
                if experience >= 80
                else "curriculum.experience_brief",
            ),
            Evidence(
                self.name,
                "curriculum.summary_described",
                "passed" if summary >= 80 else "inconclusive",
                "self_declared",
                "curriculum.summary_described" if summary >= 80 else "curriculum.summary_brief",
            ),
        ]


class FraudDetectionService:
    """Sinais internos: reutilização de arquivos por outra conta e volume de reenvios."""

    name = "fraud_detection_service"

    def validate(self, context: dict[str, Any]) -> list[Evidence]:
        reused = any(
            int(doc.get("duplicate_other_teachers") or 0) > 0
            for doc in context.get("documents") or []
        )
        velocity = int(context.get("submissions_last_7_days") or 0)
        return [
            Evidence(
                self.name,
                "fraud.no_duplicate_documents",
                "failed" if reused else "passed",
                "internal_registry",
                "fraud.document_reused_by_other_account" if reused else "fraud.no_duplicates_found",
            ),
            Evidence(
                self.name,
                "fraud.submission_velocity",
                "inconclusive" if velocity > 5 else "passed",
                "internal_registry",
                "fraud.high_submission_velocity" if velocity > 5 else "fraud.normal_velocity",
                {"submissions_last_7_days": velocity},
            ),
        ]
