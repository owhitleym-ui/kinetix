"""Kinetix coach API — bridges the browser to OCI Generative AI (with local fallbacks)."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from oci_genai import generate_chat, generate_cue, generate_summary
from oci_storage import list_sessions, write_session

load_dotenv()

# Node TTS on the same VM (nginx often sends /tts here under HTTPS)
TTS_UPSTREAM = os.getenv("TTS_UPSTREAM", "http://127.0.0.1:3002").rstrip("/")

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:8801,http://localhost:8801,https://kinetix-six-drab.vercel.app",
    ).split(",")
    if o.strip()
]
# Vercel preview + production (*.vercel.app). Add custom domains via CORS_ORIGINS.
CORS_ORIGIN_REGEX = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"https://([a-z0-9-]+\.)*vercel\.app",
)

app = FastAPI(
    title="Kinetix Coach API",
    description="Per-rep cues, mid-session Q&A, and end-of-set summaries via OCI GenAI.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX or None,
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


@app.get("/tts/health")
def tts_health() -> dict[str, Any]:
    """Proxy TTS health so Vercel can check voice via the public API host."""
    try:
        with urllib.request.urlopen(f"{TTS_UPSTREAM}/health", timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"tts_unreachable: {exc}") from exc


@app.post("/tts")
async def tts_proxy(request: Request) -> Response:
    """Forward neural TTS to voice-feedback on :3002 (fixes Vercel → OCI HTTPS /tts)."""
    body = await request.body()
    req = urllib.request.Request(
        f"{TTS_UPSTREAM}/tts",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            audio = resp.read()
            return Response(
                content=audio,
                media_type=resp.headers.get("Content-Type", "audio/mpeg"),
                headers={"Cache-Control": "no-store"},
            )
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise HTTPException(status_code=exc.code, detail=detail or "tts_upstream_error") from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"tts_unreachable: {exc}") from exc


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
