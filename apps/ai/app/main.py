from __future__ import annotations

import hashlib
import hmac
import math
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

import joblib
import numpy as np
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from sklearn.ensemble import IsolationForest

MODEL_ROOT = Path(os.getenv("MODEL_ROOT", "/var/lib/michel-ai"))
FEATURE_ORDER = ["hour_sin", "hour_cos", "capability_code", "quality"]


class Factor(BaseModel):
    feature: str
    contribution: float
    message: str


class ScoreRequest(BaseModel):
    home_id: str = Field(min_length=1, max_length=128)
    observed_at: datetime
    features: dict[str, float]


class ScoreResponse(BaseModel):
    home_id: str
    score: float = Field(ge=0, le=1)
    confidence: float = Field(ge=0, le=1)
    is_anomaly: bool
    model_version: str
    factors: list[Factor]


class TrainRequest(BaseModel):
    home_id: str = Field(min_length=1, max_length=128)
    days_covered: int = Field(ge=1)
    samples: list[dict[str, float]] = Field(min_length=96)


class TrainResponse(BaseModel):
    home_id: str
    model_version: str
    samples: int
    sha256: str
    active: bool


app = FastAPI(
    title="Michel AI",
    version="1.0.0",
    description=(
        "Local, explainable routine anomaly scoring. "
        "Michel Core remains the decision authority."
    ),
)


def require_secret(x_michel_secret: Annotated[str | None, Header()] = None) -> None:
    expected = os.getenv("AI_SHARED_SECRET")
    secret_file = os.getenv("AI_SHARED_SECRET_FILE")
    if not expected and secret_file:
        expected = Path(secret_file).read_text(encoding="utf-8").strip()
    expected = expected or "development-secret-change-me"
    if not x_michel_secret or not hmac.compare_digest(x_michel_secret, expected):
        raise HTTPException(status_code=401, detail="Invalid service credential")


def safe_home_id(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", value)


def model_path(home_id: str) -> Path:
    return MODEL_ROOT / safe_home_id(home_id) / "active.joblib"


def vector(features: dict[str, float]) -> np.ndarray:
    return np.asarray([float(features.get(name, 0.0)) for name in FEATURE_ORDER], dtype=float)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "michel-ai"}


@app.post("/v1/models/train", response_model=TrainResponse, dependencies=[Depends(require_secret)])
def train(request: TrainRequest) -> TrainResponse:
    if request.days_covered < 14:
        raise HTTPException(status_code=422, detail="At least 14 complete days are required")
    data = np.asarray([vector(sample) for sample in request.samples])
    model = IsolationForest(n_estimators=120, contamination="auto", random_state=42, n_jobs=1)
    model.fit(data)
    median = np.median(data, axis=0)
    mad = np.median(np.abs(data - median), axis=0)
    version = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    artifact = {
        "model": model,
        "median": median,
        "mad": mad,
        "version": version,
        "samples": len(data),
    }
    path = model_path(request.home_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return TrainResponse(
        home_id=request.home_id,
        model_version=version,
        samples=len(data),
        sha256=digest,
        active=True,
    )


@app.post(
    "/v1/anomalies/score", response_model=ScoreResponse, dependencies=[Depends(require_secret)]
)
def score(request: ScoreRequest) -> ScoreResponse:
    path = model_path(request.home_id)
    if not path.exists():
        return ScoreResponse(
            home_id=request.home_id,
            score=0,
            confidence=0.1,
            is_anomaly=False,
            model_version="learning",
            factors=[
                Factor(
                    feature="history",
                    contribution=0,
                    message="Michel apprend encore les habitudes de ce domicile.",
                )
            ],
        )
    artifact = joblib.load(path)
    row = vector(request.features)
    raw = float(artifact["model"].decision_function([row])[0])
    anomaly_score = 1 / (1 + math.exp(8 * raw))
    sample_confidence = min(1.0, float(artifact["samples"]) / (14 * 96))
    deviations = np.abs(row - artifact["median"]) / np.maximum(artifact["mad"] * 1.4826, 0.05)
    factors = [
        Factor(
            feature=FEATURE_ORDER[int(index)],
            contribution=round(float(deviations[int(index)]), 3),
            message=f"La caractéristique {FEATURE_ORDER[int(index)]} diffère du rythme habituel.",
        )
        for index in np.argsort(deviations)[::-1][:3]
        if deviations[int(index)] > 1
    ]
    if not factors:
        factors = [
            Factor(
                feature="routine",
                contribution=0,
                message="Le rythme observé reste proche des habitudes récentes.",
            )
        ]
    return ScoreResponse(
        home_id=request.home_id,
        score=round(anomaly_score, 4),
        confidence=round(sample_confidence, 4),
        is_anomaly=anomaly_score >= 0.85,
        model_version=str(artifact["version"]),
        factors=factors,
    )
