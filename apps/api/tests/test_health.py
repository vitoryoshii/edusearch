from fastapi.testclient import TestClient

from app import __version__
from app.main import create_app


def test_health_returns_ok(settings) -> None:
    response = TestClient(create_app(settings)).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "edusearch-api", "version": __version__}


def test_health_does_not_require_auth_or_database(settings) -> None:
    settings.supabase_url = None
    response = TestClient(create_app(settings)).get("/health")
    assert response.status_code == 200


def test_cors_allows_local_frontend(settings) -> None:
    client = TestClient(create_app(settings))
    response = client.get("/health", headers={"Origin": "http://localhost:5174"})
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5174"
