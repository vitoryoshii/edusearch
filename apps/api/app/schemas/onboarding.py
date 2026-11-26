"""Contratos do onboarding: perfis de aluno e de professor e catálogo de disciplinas.

Vocabulário igual ao do frontend (apps/web/src/lib/onboarding.ts e src/lib/api/types.ts) e aos
enums do banco. Todos os modelos de entrada recusam campos desconhecidos (422): campos do
servidor (verificação, publicação, ids) nunca são aceitos.
"""

import re
import unicodedata
from datetime import date, datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.schemas.me import VerificationStatus

EducationLevel = Literal[
    "fundamental", "medio", "pre-vestibular", "graduacao", "concursos", "livre"
]
Weekday = Literal["seg", "ter", "qua", "qui", "sex", "sab", "dom"]
DayPeriod = Literal["manha", "tarde", "noite"]
Modality = Literal["online", "presencial", "hibrido"]
Difficulty = Literal["base", "exercicios", "pratica", "fala", "organizacao"]
TeachingMethod = Literal["pratica", "teorica", "exercicios", "conversacao", "projetos"]
ExperienceRange = Literal["menos-1", "1-3", "3-5", "5-mais"]
LessonDuration = Literal[30, 45, 60, 90]
TeacherQualificationKind = Literal["graduated", "specialist", "university_student", "tutor"]
TeacherCredentialStatus = Literal[
    "draft",
    "submitted",
    "pending_external",
    "under_review",
    "changes_requested",
    "approved",
    "rejected",
    "suspended",
]
TeacherDocumentKind = Literal["identity", "academic_proof", "curriculum"]
TeacherDocumentStatus = Literal["quarantined", "accepted", "rejected"]

_SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_CONTROL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f​-‏ -‮⁠-⁤﻿]")


def _clean_text(value: str) -> str:
    """NFC, sem caracteres de controle/direção (quebras de linha são permitidas), sem pontas."""
    value = unicodedata.normalize("NFC", value)
    if _CONTROL.search(value):
        raise ValueError("o texto não pode conter caracteres de controle")
    return value.strip()


def _unique(values: list) -> list:
    if len(set(values)) != len(values):
        raise ValueError("itens repetidos")
    return values


def _slugs(values: list[str]) -> list[str]:
    for v in values:
        if not _SLUG.match(v) or len(v) > 60:
            raise ValueError("disciplina inválida")
    return _unique(values)


Text = Annotated[str, AfterValidator(_clean_text)]
SubjectSlugs = Annotated[list[str], AfterValidator(_slugs)]


Difficulties = Annotated[list[Difficulty], Field(max_length=5), AfterValidator(_unique)]
TeachingMethods = Annotated[
    list[TeachingMethod], Field(min_length=1, max_length=5), AfterValidator(_unique)
]
Weekdays = Annotated[list[Weekday], Field(min_length=1, max_length=7), AfterValidator(_unique)]
DayPeriods = Annotated[list[DayPeriod], Field(min_length=1, max_length=3), AfterValidator(_unique)]
LessonDurations = Annotated[
    list[LessonDuration], Field(min_length=1, max_length=4), AfterValidator(_unique)
]


_STRICT = ConfigDict(extra="forbid")


# ------------------------------------------------------------------------------- aluno


class StudentProfileIn(BaseModel):
    """Perfil do aluno. Salvar = cadastro de aluno concluído."""

    model_config = _STRICT

    learning_goal: Annotated[Text, Field(min_length=3, max_length=200)]
    education_level: EducationLevel
    subjects: Annotated[SubjectSlugs, Field(min_length=1, max_length=20)]
    difficulty_areas: Difficulties = []
    preferred_weekdays: Weekdays
    preferred_periods: DayPeriods
    preferred_modality: Modality
    budget_min_cents: Annotated[int, Field(ge=0, le=10_000_000)] | None = None
    budget_max_cents: Annotated[int, Field(ge=0, le=10_000_000)] | None = None

    @model_validator(mode="after")
    def _budget(self) -> Self:
        lo, hi = self.budget_min_cents, self.budget_max_cents
        if lo is None and hi is None:
            raise ValueError("informe uma faixa de valor por aula")
        if lo is not None and hi is not None and lo > hi:
            raise ValueError("o valor mínimo não pode ser maior que o máximo")
        return self


class StudentProfileOut(BaseModel):
    learning_goal: str
    education_level: EducationLevel
    subjects: list[str]
    difficulty_areas: list[Difficulty]
    preferred_weekdays: list[Weekday]
    preferred_periods: list[DayPeriod]
    preferred_modality: Modality
    budget_min_cents: int | None
    budget_max_cents: int | None
    created_at: datetime
    updated_at: datetime


# ------------------------------------------------------------------------------- professor


class TeacherProfileIn(BaseModel):
    """Perfil profissional. Salvar = cadastro concluído; aprovação/publicação são do servidor."""

    model_config = _STRICT

    headline: Annotated[Text, Field(min_length=3, max_length=120)] | None = None
    bio: Annotated[Text, Field(min_length=30, max_length=600)]
    subjects: Annotated[SubjectSlugs, Field(min_length=1, max_length=20)]
    specialties: Annotated[Text, Field(max_length=200)] | None = None
    academic_background: Annotated[Text, Field(min_length=3, max_length=200)]
    experience: ExperienceRange
    teaching_methods: TeachingMethods
    methodology: Annotated[Text, Field(max_length=400)] | None = None
    price_cents: Annotated[int, Field(ge=2000, le=100_000)]
    lesson_durations_minutes: LessonDurations
    modality: Modality
    available_weekdays: Weekdays
    available_periods: DayPeriods

    @model_validator(mode="after")
    def _empty_optional_text(self) -> Self:
        # Texto opcional vazio vira null (nada é gravado como string vazia).
        for name in ("headline", "specialties", "methodology"):
            if getattr(self, name) == "":
                setattr(self, name, None)
        return self


class TeacherProfileOut(BaseModel):
    headline: str | None
    bio: str
    subjects: list[str]
    specialties: str | None
    academic_background: str
    experience: ExperienceRange
    teaching_methods: list[TeachingMethod]
    methodology: str | None
    price_cents: int
    lesson_durations_minutes: list[int]
    lesson_duration_minutes: int = Field(description="Duração principal: a menor das oferecidas.")
    modality: Modality
    available_weekdays: list[Weekday]
    available_periods: list[DayPeriod]
    verification_status: VerificationStatus = Field(description="Somente leitura (servidor).")
    is_published: bool = Field(description="Somente leitura (servidor).")
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime


# --------------------------------------------------------------------- credenciamento


class TeacherVerificationIn(BaseModel):
    """Declaração privada do professor; nunca aceita estado de revisão ou publicação."""

    model_config = _STRICT

    qualification_kind: TeacherQualificationKind
    birth_date: date
    institution: Annotated[Text, Field(min_length=2, max_length=160)]
    qualification: Annotated[Text, Field(min_length=2, max_length=200)]
    professional_experience: Annotated[Text, Field(min_length=10, max_length=2000)]
    curriculum_summary: Annotated[Text, Field(min_length=10, max_length=4000)]
    financial_tax_id_kind: Literal["cpf", "cnpj"]
    financial_tax_id_last4: Annotated[str, Field(pattern=r"^[0-9]{4}$")]
    terms_version: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9._-]{0,79}$")]


class TeacherVerificationDocumentIn(BaseModel):
    """Registra metadados de um objeto já enviado ao bucket privado do próprio titular."""

    model_config = _STRICT

    document_kind: TeacherDocumentKind
    storage_path: Annotated[
        str,
        Field(
            min_length=42,
            max_length=160,
            pattern=r"^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|png|jpe?g)$",
        ),
    ]


class TeacherVerificationDocumentOut(BaseModel):
    document_kind: TeacherDocumentKind
    version: int
    status: TeacherDocumentStatus
    uploaded_at: datetime


class TeacherVerificationOut(BaseModel):
    status: TeacherCredentialStatus
    qualification_kind: TeacherQualificationKind
    institution: str
    qualification: str
    submitted_at: datetime | None
    review_reason: str | None
    terms_version: str
    terms_accepted_at: datetime
    documents: list[TeacherVerificationDocumentOut]


class TrustEvidenceOut(BaseModel):
    validator: str
    requirement: str
    mandatory: bool
    result: Literal["passed", "failed", "unavailable", "inconclusive"]
    source: str
    reason_code: str
    observed_at: datetime


class TrustDecisionOut(BaseModel):
    id: UUID
    decision: str
    reasons: list[str]
    actor_kind: Literal["service", "human"]
    rules_version: str | None
    decided_at: datetime
    contestable: bool


class TrustContestationOut(BaseModel):
    status: Literal["open", "resolved"]
    created_at: datetime
    resolution: str | None
    resolved_at: datetime | None


class TrustDocumentOut(BaseModel):
    kind: TeacherDocumentKind
    version: int
    status: TeacherDocumentStatus
    inspection_status: Literal["pending", "passed", "failed"]
    inspection_code: str | None
    review_reason: str | None
    uploaded_at: datetime


class TeacherVerificationProgressOut(BaseModel):
    """Progresso real: evidências e decisão do motor. Sem percentuais estimados."""

    status: TeacherCredentialStatus
    review_reason: str | None
    submitted_at: datetime | None
    processing: bool
    decision: TrustDecisionOut | None
    evidence: list[TrustEvidenceOut]
    contestation: TrustContestationOut | None
    documents: list[TrustDocumentOut]


class TeacherVerificationContestIn(BaseModel):
    model_config = _STRICT

    reason: Annotated[Text, Field(min_length=20, max_length=2000)]


# ------------------------------------------------------------------------------- catálogo


class SubjectOut(BaseModel):
    slug: str
    name: str
