"""Rotas de onboarding sem banco: autenticação, contratos, validação, 403/404/422/503 e CORS."""

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.auth.jwt import AuthenticatedUser
from app.errors import forbidden, not_found
from app.main import create_app
from app.schemas.me import MeResponse
from app.schemas.onboarding import (
    StudentProfileIn,
    StudentProfileOut,
    SubjectOut,
    TeacherProfileIn,
    TeacherProfileOut,
)
from app.services.onboarding import get_onboarding_service

NOW = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)

STUDENT = {
    "learning_goal": "Passar no ENEM",
    "education_level": "medio",
    "subjects": ["matematica", "fisica"],
    "difficulty_areas": ["exercicios"],
    "preferred_weekdays": ["seg", "qua"],
    "preferred_periods": ["noite"],
    "preferred_modality": "online",
    "budget_min_cents": 5000,
    "budget_max_cents": 8000,
}

TEACHER = {
    "bio": "Professora fictícia de matemática com foco em ENEM e vestibulares.",
    "subjects": ["matematica"],
    "specialties": "ENEM, cálculo I",
    "academic_background": "Licenciatura em Matemática",
    "experience": "3-5",
    "teaching_methods": ["exercicios", "pratica"],
    "methodology": "Aulas com listas comentadas.",
    "price_cents": 8000,
    "lesson_durations_minutes": [60, 45],
    "modality": "online",
    "available_weekdays": ["ter", "qui"],
    "available_periods": ["tarde", "noite"],
}


class FakeOnboarding:
    """Estado em memória por usuário (como o RLS: cada um só vê o seu)."""

    def __init__(self) -> None:
        self.roles: dict[uuid.UUID, set[str]] = {}
        self.students: dict[uuid.UUID, StudentProfileIn] = {}
        self.teachers: dict[uuid.UUID, TeacherProfileIn] = {}

    def _me(self, user: AuthenticatedUser) -> MeResponse:
        return MeResponse(
            id=user.id,
            email=user.email,
            display_name="Pessoa Fictícia",
            avatar_url=None,
            status="onboarding",
            roles=sorted(self.roles.get(user.id, set())),  # type: ignore[arg-type]
            created_at=NOW,
            updated_at=NOW,
        )

    def select_role(self, user, role):
        current = self.roles.setdefault(user.id, set())
        created = role not in current
        current.add(role)
        return self._me(user), created

    def _need(self, user, role):
        if role not in self.roles.get(user.id, set()):
            raise forbidden("role_required", "Escolha o perfil antes de continuar.")

    def get_student(self, user):
        self._need(user, "student")
        if user.id not in self.students:
            raise not_found("student_profile_not_found", "Cadastro de aluno ainda não salvo.")
        return self._student_out(self.students[user.id])

    def save_student(self, user, data):
        self._need(user, "student")
        self.students[user.id] = data
        return self._student_out(data)

    def _student_out(self, d: StudentProfileIn) -> StudentProfileOut:
        return StudentProfileOut(**d.model_dump(), created_at=NOW, updated_at=NOW)

    def get_teacher(self, user):
        self._need(user, "teacher")
        if user.id not in self.teachers:
            raise not_found("teacher_profile_not_found", "Cadastro de professor ainda não salvo.")
        return self._teacher_out(self.teachers[user.id])

    def save_teacher(self, user, data):
        self._need(user, "teacher")
        self.teachers[user.id] = data
        return self._teacher_out(data)

    def _teacher_out(self, d: TeacherProfileIn) -> TeacherProfileOut:
        return TeacherProfileOut(
            **d.model_dump(),
            lesson_duration_minutes=min(d.lesson_durations_minutes),
            verification_status="pending",
            is_published=False,
            published_at=None,
            created_at=NOW,
            updated_at=NOW,
        )

    def list_subjects(self):
        return [SubjectOut(slug="matematica", name="Matemática")]


@pytest.fixture
def fake() -> FakeOnboarding:
    return FakeOnboarding()


@pytest.fixture
def client(settings, verifier, fake) -> TestClient:
    app = create_app(settings, token_verifier=verifier)
    app.dependency_overrides[get_onboarding_service] = lambda: fake
    return TestClient(app)


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


PRIVATE = [
    ("post", "/v1/me/roles", {"role": "student"}),
    ("get", "/v1/me/student-profile", None),
    ("put", "/v1/me/student-profile", STUDENT),
    ("get", "/v1/me/teacher-profile", None),
    ("put", "/v1/me/teacher-profile", TEACHER),
]


# --------------------------------------------------------------------------- autenticação


@pytest.mark.parametrize(("method", "path", "body"), PRIVATE)
def test_private_routes_require_token(client, method, path, body) -> None:
    r = client.request(method, path, json=body)
    assert r.status_code == 401
    assert r.json()["code"] == "not_authenticated"


@pytest.mark.parametrize(("method", "path", "body"), PRIVATE)
def test_private_routes_reject_forged_token(client, make_token, other_key, method, path, body):
    r = client.request(method, path, json=body, headers=auth(make_token(key=other_key)))
    assert r.status_code == 401
    assert r.json()["code"] == "invalid_token"


def test_subjects_is_public(client) -> None:
    r = client.get("/v1/subjects")
    assert r.status_code == 200
    assert r.json() == [{"slug": "matematica", "name": "Matemática"}]


# --------------------------------------------------------------------------- papel


def test_select_role_is_idempotent(client, make_token) -> None:
    token = make_token()
    first = client.post("/v1/me/roles", json={"role": "student"}, headers=auth(token))
    assert first.status_code == 201
    assert first.json()["roles"] == ["student"]
    again = client.post("/v1/me/roles", json={"role": "student"}, headers=auth(token))
    assert again.status_code == 200
    assert again.json()["roles"] == ["student"]


@pytest.mark.parametrize(
    "body",
    [
        {"role": "admin"},
        {"role": "service_role"},
        {"role": "STUDENT"},
        {"role": ["student"]},
        {},
        {"role": "student", "user_id": str(uuid.uuid4())},
        {"role": "teacher", "is_admin": True},
    ],
)
def test_select_role_rejects_anything_but_student_or_teacher(client, make_token, fake, body):
    r = client.post("/v1/me/roles", json=body, headers=auth(make_token()))
    assert r.status_code == 422
    assert fake.roles == {}


# --------------------------------------------------------------------------- aluno


def test_student_profile_requires_role_then_not_found_then_saved(client, make_token) -> None:
    token = make_token()
    r = client.get("/v1/me/student-profile", headers=auth(token))
    assert (r.status_code, r.json()["code"]) == (403, "role_required")
    r = client.put("/v1/me/student-profile", json=STUDENT, headers=auth(token))
    assert (r.status_code, r.json()["code"]) == (403, "role_required")

    client.post("/v1/me/roles", json={"role": "student"}, headers=auth(token))
    r = client.get("/v1/me/student-profile", headers=auth(token))
    assert (r.status_code, r.json()["code"]) == (404, "student_profile_not_found")

    r = client.put("/v1/me/student-profile", json=STUDENT, headers=auth(token))
    assert r.status_code == 200, r.text
    assert client.get("/v1/me/student-profile", headers=auth(token)).json()["subjects"] == [
        "matematica",
        "fisica",
    ]


def test_student_profiles_are_per_token(client, make_token) -> None:
    a, b = make_token(), make_token()
    for t in (a, b):
        client.post("/v1/me/roles", json={"role": "student"}, headers=auth(t))
    client.put("/v1/me/student-profile", json=STUDENT, headers=auth(a))
    r = client.get("/v1/me/student-profile", headers=auth(b))
    assert r.status_code == 404


@pytest.mark.parametrize(
    "change",
    [
        {"learning_goal": "ab"},
        {"learning_goal": "x" * 201},
        {"learning_goal": "Objetivo‮invertido"},
        {"education_level": "doutorado"},
        {"subjects": []},
        {"subjects": ["matematica", "matematica"]},
        {"subjects": ["Matemática"]},
        {"subjects": ["../x"]},
        {"difficulty_areas": ["preguica"]},
        {"preferred_weekdays": []},
        {"preferred_weekdays": ["monday"]},
        {"preferred_periods": ["madrugada"]},
        {"preferred_modality": "ead"},
        {"budget_min_cents": None, "budget_max_cents": None},
        {"budget_min_cents": 9000, "budget_max_cents": 5000},
        {"budget_min_cents": -1},
        {"budget_max_cents": 12.5},
        {"user_id": str(uuid.uuid4())},
        {"student_id": str(uuid.uuid4())},
        {"created_at": "2020-01-01T00:00:00Z"},
    ],
)
def test_student_payload_validation(client, make_token, fake, change) -> None:
    token = make_token()
    client.post("/v1/me/roles", json={"role": "student"}, headers=auth(token))
    r = client.put("/v1/me/student-profile", json={**STUDENT, **change}, headers=auth(token))
    assert r.status_code == 422, change
    assert r.json()["code"] == "validation_error"
    assert fake.students == {}


@pytest.mark.parametrize(
    "missing", ["learning_goal", "education_level", "subjects", "preferred_modality"]
)
def test_student_required_fields(client, make_token, missing) -> None:
    token = make_token()
    client.post("/v1/me/roles", json={"role": "student"}, headers=auth(token))
    body = {k: v for k, v in STUDENT.items() if k != missing}
    assert client.put("/v1/me/student-profile", json=body, headers=auth(token)).status_code == 422


def test_student_budget_open_ranges_are_accepted(client, make_token) -> None:
    token = make_token()
    client.post("/v1/me/roles", json={"role": "student"}, headers=auth(token))
    for lo, hi in [(None, 5000), (12000, None)]:
        body = {**STUDENT, "budget_min_cents": lo, "budget_max_cents": hi}
        assert (
            client.put("/v1/me/student-profile", json=body, headers=auth(token)).status_code == 200
        )


# --------------------------------------------------------------------------- professor


def test_teacher_profile_flow_is_pending_and_unpublished(client, make_token) -> None:
    token = make_token()
    client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(token))
    r = client.put("/v1/me/teacher-profile", json=TEACHER, headers=auth(token))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verification_status"] == "pending"
    assert body["is_published"] is False
    assert body["lesson_duration_minutes"] == 45


@pytest.mark.parametrize(
    "change",
    [
        {"verification_status": "approved"},
        {"is_published": True},
        {"published_at": "2026-01-01T00:00:00Z"},
        {"verified_at": "2026-01-01T00:00:00Z"},
        {"user_id": str(uuid.uuid4())},
        {"lesson_duration_minutes": 30},
        {"bio": "curta demais"},
        {"bio": "x" * 601},
        {"price_cents": 1999},
        {"price_cents": 100001},
        {"price_cents": "80,00"},
        {"lesson_durations_minutes": []},
        {"lesson_durations_minutes": [50]},
        {"lesson_durations_minutes": [60, 60]},
        {"teaching_methods": []},
        {"teaching_methods": ["hipnose"]},
        {"experience": "10-mais"},
        {"academic_background": "x"},
        {"specialties": "x" * 201},
        {"methodology": "x" * 401},
        {"available_weekdays": []},
        {"available_periods": []},
        {"subjects": []},
    ],
)
def test_teacher_payload_validation(client, make_token, fake, change) -> None:
    token = make_token()
    client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(token))
    r = client.put("/v1/me/teacher-profile", json={**TEACHER, **change}, headers=auth(token))
    assert r.status_code == 422, change
    assert fake.teachers == {}


def test_teacher_empty_optional_texts_become_null(client, make_token) -> None:
    token = make_token()
    client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(token))
    body = {**TEACHER, "specialties": "   ", "methodology": ""}
    r = client.put("/v1/me/teacher-profile", json=body, headers=auth(token))
    assert r.status_code == 200
    assert r.json()["specialties"] is None and r.json()["methodology"] is None


def test_student_role_cannot_use_teacher_endpoints(client, make_token) -> None:
    token = make_token()
    client.post("/v1/me/roles", json={"role": "student"}, headers=auth(token))
    r = client.put("/v1/me/teacher-profile", json=TEACHER, headers=auth(token))
    assert (r.status_code, r.json()["code"]) == (403, "role_required")


# --------------------------------------------------------------------------- falhas e CORS


def test_database_not_configured_is_503(settings, verifier, make_token) -> None:
    c = TestClient(create_app(settings, token_verifier=verifier))
    assert c.get("/v1/subjects").status_code == 503
    r = c.post("/v1/me/roles", json={"role": "student"}, headers=auth(make_token()))
    assert (r.status_code, r.json()["code"]) == (503, "database_unavailable")


@pytest.mark.parametrize("method", ["POST", "PUT", "GET"])
def test_cors_allows_implemented_methods(client, method) -> None:
    r = client.options(
        "/v1/me/roles",
        headers={
            "Origin": "https://app.edusearch.com.br",
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert r.status_code == 200


@pytest.mark.parametrize("method", ["PATCH", "TRACE"])
def test_cors_rejects_unimplemented_methods(client, method) -> None:
    r = client.options(
        "/v1/me/roles",
        headers={"Origin": "https://app.edusearch.com.br", "Access-Control-Request-Method": method},
    )
    assert r.status_code == 400


def test_cors_allows_delete_for_calendar_disconnect(client) -> None:
    # Fase 3A: DELETE /v1/me/google-calendar (desconectar a agenda) é o único DELETE da API.
    r = client.options(
        "/v1/me/google-calendar",
        headers={
            "Origin": "https://app.edusearch.com.br",
            "Access-Control-Request-Method": "DELETE",
        },
    )
    assert r.status_code == 200
    r = client.options(
        "/v1/me/google-calendar",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "DELETE"},
    )
    assert r.status_code == 400
