"""Tipos do Trust Engine: evidência estruturada e decisão."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

Result = Literal["passed", "failed", "unavailable", "inconclusive"]
Source = Literal[
    "self_declared", "file_analysis", "internal_registry", "digital_signature", "external_registry"
]
DecisionKind = Literal["approved", "changes_requested", "pending_external", "manual_review"]


def now_utc() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class Evidence:
    """Uma evidência: quem verificou, qual requisito, resultado, origem, motivo e quando."""

    validator: str
    requirement: str
    result: Result
    source: Source
    reason_code: str
    details: dict[str, Any] = field(default_factory=dict)
    observed_at: datetime = field(default_factory=now_utc)

    def as_json(self) -> dict[str, Any]:
        return {
            "validator": self.validator,
            "requirement": self.requirement,
            "result": self.result,
            "source": self.source,
            "reason_code": self.reason_code,
            "details": self.details,
            "observed_at": self.observed_at.isoformat(),
        }


@dataclass(frozen=True)
class Decision:
    decision: DecisionKind
    reasons: list[str]
