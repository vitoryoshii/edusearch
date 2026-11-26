"""Adaptadores de fontes externas de verificação.

Nenhuma fonte externa está integrada na V1. Os adaptadores abaixo existem para que uma integração
real (ex.: base oficial de identidade, registro de diplomas digitais do emissor) seja conectada sem
alterar o motor. Enquanto não houver integração homologada, eles respondem "unavailable" — nunca
"passed". Implementações de teste ficam somente em ``tests/``.
"""

from typing import Any, Protocol

from app.trust.models import Evidence


class IdentityProvider(Protocol):
    name: str

    def verify_identity(self, context: dict[str, Any]) -> Evidence: ...


class AcademicRegistry(Protocol):
    name: str

    def verify_issuer(self, context: dict[str, Any]) -> Evidence: ...


class NotConfiguredIdentityProvider:
    name = "none"

    def verify_identity(self, context: dict[str, Any]) -> Evidence:
        return Evidence(
            validator="identity_validator",
            requirement="identity.verified",
            result="unavailable",
            source="external_registry",
            reason_code="identity.trusted_source_unavailable",
            details={"provider": self.name},
        )


class NotConfiguredAcademicRegistry:
    name = "none"

    def verify_issuer(self, context: dict[str, Any]) -> Evidence:
        return Evidence(
            validator="academic_validator",
            requirement="academic.issuer_verified",
            result="unavailable",
            source="external_registry",
            reason_code="academic.trusted_source_unavailable",
            details={"provider": self.name},
        )


def build_identity_provider(name: str) -> IdentityProvider:
    if name == "none":
        return NotConfiguredIdentityProvider()
    raise ValueError(f"provedor de identidade não implementado: {name}")


def build_academic_registry(name: str) -> AcademicRegistry:
    if name == "none":
        return NotConfiguredAcademicRegistry()
    raise ValueError(f"registro acadêmico não implementado: {name}")
