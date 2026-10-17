"""
PT Form Coach — FastAPI backend for OCI services.
Keypoints only — never video.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from oci_genai import generate_correction_cue
from oci_model import score_rep_quality
from oci_storage import list_sessions, write_session

load_dotenv()

app = FastAPI(
    title="PT Form Coach API",
    description="Bridges the browser coach to OCI Object Storage, Model Deployment, and GenAI. "
    "Accepts keypoints only — never video.",
    version="0.1.0",
)

origins = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class JointFrame(BaseModel):
    phase: str
    joints: dict[str, Any]
    errorType: Optional[str] = None


class SessionPayload(BaseModel):
    patient_id: str
    timestamp: Optional[str] = None
    exercise: str = "squat"
    baseline: Optional[dict[str, Any]] = None
    reps: list[dict[str, Any]] = Field(default_factory=list)


class ScoreRepPayload(BaseModel):
    patient_id: str
    exercise: str = "squat"
    rep_number: int = 1
    frames: list[JointFrame] = Field(default_factory=list)


class CueRequest(BaseModel):
    error_type: str
    baseline: float
    current: float
    language: str = "en"


@app.get("/")
def root():
    """Browser-friendly landing so http://127.0.0.1:8001 is not a bare 404."""
    return {
        "service": "PT Form Coach API",
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
        "note": "This is the backend API. Open the app at http://localhost:3000",
        "endpoints": {
            "GET /health": "liveness check",
            "POST /score-rep": "EC3D rep quality / mistake score",
            "POST /sessions": "save keypoint session",
            "GET /sessions": "list sessions",
            "POST /generate-cue": "plain language cue",
        },
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "pt-form-coach",
        "note": "keypoints only — never video",
        "time": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/sessions")
def create_session(payload: SessionPayload):
    """Persist a session keypoint log to OCI Object Storage."""
    data = payload.model_dump()
    if not data.get("timestamp"):
        data["timestamp"] = datetime.now(timezone.utc).isoformat()
    try:
        result = write_session(data)
        return {"ok": True, **result}
    except Exception as exc:  # noqa: BLE001 — surface for demo debugging
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/sessions")
def get_sessions(patient_id: Optional[str] = Query(default=None)):
    try:
        sessions = list_sessions(patient_id)
        return {"sessions": sessions}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/score-rep")
def score_rep(payload: ScoreRepPayload):
    """Call OCI Model Deployment rep quality classifier (with local fallback)."""
    try:
        return score_rep_quality(payload.model_dump())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/generate-cue")
def generate_cue(req: CueRequest):
    """OCI GenAI plain-language correction cue (local template fallback)."""
    try:
        text, source = generate_correction_cue(
            error_type=req.error_type,
            baseline=req.baseline,
            current=req.current,
            language=req.language,
        )
        return {"cue": text, "source": source}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)
