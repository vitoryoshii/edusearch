"""VerificationDispatcher: consome a fila persistente do Trust Engine.

Fila com lease (SKIP LOCKED), idempotência por submissão, retry com backoff e recuperação de jobs
interrompidos ficam no banco. Aqui: montar o contexto, rodar os validadores, decidir e registrar.
O orçamento de tempo mantém cada chamada abaixo do limite da função serverless; jobs não
processados continuam com lease e são recuperados na próxima execução.
"""

import logging
import time
from collections.abc import Callable
from typing import Any

from psycopg.types.json import Jsonb

from app.db import BaseDatabase
from app.trust.engine import VerificationDecisionEngine
from app.trust.providers import AcademicRegistry, IdentityProvider
from app.trust.validators import (
    AcademicValidator,
    CurriculumAnalyzer,
    DocumentValidator,
    FraudDetectionService,
    IdentityValidator,
    RegistrationValidator,
)

logger = logging.getLogger("edusearch.trust")

LEASE_SECONDS = 300


class VerificationDispatcher:
    def __init__(
        self,
        database: BaseDatabase,
        *,
        identity_provider: IdentityProvider,
        academic_registry: AcademicRegistry,
        terms_version: str,
        budget_seconds: float = 8.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._db = database
        self._validators = [
            RegistrationValidator(terms_version),
            IdentityValidator(identity_provider),
            DocumentValidator(),
            AcademicValidator(academic_registry),
            CurriculumAnalyzer(),
            FraudDetectionService(),
        ]
        self._engine = VerificationDecisionEngine()
        self._budget = budget_seconds
        self._clock = clock

    def _process(self, job_id: Any) -> str:
        with self._db.service_transaction() as conn:
            context = conn.execute(
                "select private.teacher_verification_job_context(%s) as ctx", (job_id,)
            ).fetchone()["ctx"]
        if context is None:
            return "skipped"
        evidence = [item for v in self._validators for item in v.validate(context)]
        decision = self._engine.decide(evidence)
        with self._db.service_transaction() as conn:
            return str(
                conn.execute(
                    "select private.teacher_verification_record_decision("
                    "%s, %s, %s, %s::private.trust_decision, %s) as outcome",
                    (
                        job_id,
                        self._engine.rules_version,
                        Jsonb([item.as_json() for item in evidence]),
                        decision.decision,
                        decision.reasons,
                    ),
                ).fetchone()["outcome"]
            )

    def dispatch(self, batch_size: int) -> dict[str, int]:
        started = self._clock()
        with self._db.service_transaction() as conn:
            rows = conn.execute(
                "select id from private.teacher_verification_claim(%s, %s)",
                (batch_size, LEASE_SECONDS),
            ).fetchall()
        summary = {
            "claimed": len(rows),
            "approved": 0,
            "changes_requested": 0,
            "pending_external": 0,
            "under_review": 0,
            "superseded": 0,
            "retried": 0,
            "failed": 0,
            "deferred": 0,
        }
        for row in rows:
            if self._clock() - started > self._budget:
                # Mantém o lease: a recuperação de jobs interrompidos o reprocessa depois.
                summary["deferred"] += 1
                continue
            try:
                outcome = self._process(row["id"])
            except Exception as exc:  # noqa: BLE001 — a falha volta à fila com backoff
                logger.warning("Trust Engine: falha no job (%s)", exc.__class__.__name__)
                with self._db.service_transaction() as conn:
                    result = conn.execute(
                        "select private.teacher_verification_job_failed(%s, %s) as result",
                        (row["id"], "processing_error"),
                    ).fetchone()["result"]
                summary["failed" if result == "failed" else "retried"] += 1
                continue
            if outcome in summary:
                summary[outcome] += 1
        return summary
