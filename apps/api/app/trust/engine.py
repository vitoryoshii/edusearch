"""VerificationDecisionEngine: aplica as regras versionadas às evidências.

As regras espelham ``private.trust_rule_requirements``; o banco reconfere a aprovação, então uma
divergência aqui nunca produz aprovação indevida (o registro falha e o job volta à fila).
"""

from collections.abc import Iterable

from app.trust.models import Decision, Evidence, Source

RULES_VERSION = "trust-rules-2026.11-v1"

# requisito obrigatório -> origens aceitas como comprovação
MANDATORY: dict[str, frozenset[Source]] = {
    "registration.terms_current": frozenset({"self_declared"}),
    "registration.profile_complete": frozenset({"self_declared"}),
    "registration.adult": frozenset({"self_declared", "external_registry"}),
    "document.identity_valid": frozenset({"file_analysis"}),
    "document.academic_valid": frozenset({"file_analysis"}),
    "identity.verified": frozenset({"external_registry", "digital_signature"}),
    "academic.issuer_verified": frozenset({"external_registry", "digital_signature"}),
    "fraud.no_duplicate_documents": frozenset({"internal_registry"}),
}
# Falhas que indicam possível fraude não são devolvidas ao professor como "corrija": vão para
# auditoria humana excepcional.
_FRAUD_REQUIREMENTS = frozenset({"fraud.no_duplicate_documents"})


class VerificationDecisionEngine:
    rules_version = RULES_VERSION

    def decide(self, evidence: Iterable[Evidence]) -> Decision:
        by_requirement = {item.requirement: item for item in evidence}
        failed: list[Evidence] = []
        unproven: list[str] = []
        for requirement, sources in MANDATORY.items():
            item = by_requirement.get(requirement)
            if item is None:
                unproven.append("rules.requirement_not_evaluated")
            elif item.result == "failed":
                failed.append(item)
            elif item.result != "passed" or item.source not in sources:
                unproven.append(item.reason_code)

        fraud = [item.reason_code for item in failed if item.requirement in _FRAUD_REQUIREMENTS]
        if fraud:
            return Decision("manual_review", fraud)
        if failed:
            return Decision("changes_requested", [item.reason_code for item in failed])
        if unproven:
            return Decision("pending_external", sorted(set(unproven)))
        return Decision("approved", ["verification.all_requirements_proven"])
