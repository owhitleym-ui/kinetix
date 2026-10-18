"""Kinetix coach API — bridges the browser to OCI Generative AI (with local fallbacks)."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from oci_genai import generate_chat, generate_cue, generate_summary
from oci_storage import list_sessions, write_session

load_dotenv()

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:8801,http://localhost:8801",
    ).split(",")
    if o.strip()
]

app = FastAPI(
    title="Kinetix Coach API",
    description="Per-rep cues, mid-session Q&A, and end-of-set summaries via OCI GenAI.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CueRequest(BaseModel):
    exercise: str = ""
    rep: int = 0
    label: str = ""
    short: str = ""
    cue: str = ""
    good: bool = False
    probs: dict[str, float] | None = None
    reps_done: int = 0
    reps_target: int = 0


class ChatMessage(BaseModel):
    role: str = "user"
    content: str = ""


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    session_context: dict[str, Any] = Field(default_factory=dict)


class SummaryRequest(BaseModel):
    session_context: dict[str, Any] = Field(default_factory=dict)


class SessionPayload(BaseModel):
    patient_id: str
    timestamp: Optional[str] = None
    exercise: str = ""
    reps: list[dict[str, Any]] = Field(default_factory=list)
    model_config = {"extra": "allow"}  # keep whatever session context the browser sends


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "kinetix-coach", "status": "ok"}


@app.post("/coach/cue")
def coach_cue(body: CueRequest) -> dict[str, str]:
    text, source = generate_cue(body.model_dump())
    return {"text": text, "source": source}


@app.post("/coach/chat")
def coach_chat(body: ChatRequest) -> dict[str, str]:
    history = [m.model_dump() for m in body.history]
    reply, source = generate_chat(body.message, history, body.session_context)
    return {"reply": reply, "source": source}


@app.post("/coach/summary")
def coach_summary(body: SummaryRequest) -> dict[str, Any]:
    result, source = generate_summary(body.session_context)
    return {**result, "source": source}


@app.post("/sessions")
def create_session(payload: SessionPayload) -> dict[str, Any]:
    """Save a session log (rep results / keypoints only, never video) to OCI Object Storage."""
    data = payload.model_dump()
    data["timestamp"] = data.get("timestamp") or datetime.now(timezone.utc).isoformat()
    try:
        return {"ok": True, **write_session(data)}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/sessions")
def get_sessions(patient_id: Optional[str] = Query(default=None)) -> dict[str, Any]:
    try:
        return {"sessions": list_sessions(patient_id)}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("API_PORT", "8000"))
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=True)
