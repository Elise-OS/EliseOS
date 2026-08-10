import os

from fastapi.testclient import TestClient

os.environ["AI_SHARED_SECRET"] = "test-secret-for-michel-ai"

from app.main import app  # noqa: E402

client = TestClient(app)


def test_health_is_public() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_score_requires_service_secret() -> None:
    response = client.post(
        "/v1/anomalies/score",
        json={"home_id": "home", "observed_at": "2026-08-03T08:00:00Z", "features": {}},
    )
    assert response.status_code == 401


def test_cold_start_never_claims_anomaly(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr("app.main.MODEL_ROOT", tmp_path)
    response = client.post(
        "/v1/anomalies/score",
        headers={"x-michel-secret": "test-secret-for-michel-ai"},
        json={"home_id": "new-home", "observed_at": "2026-08-03T08:00:00Z", "features": {}},
    )
    assert response.status_code == 200
    assert response.json()["model_version"] == "learning"
    assert response.json()["is_anomaly"] is False
