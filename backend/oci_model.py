"""
Rep quality / mistake scoring.
Prefers EC3D sequence classifiers under backend/models/, then OCI endpoint, then heuristic.
"""

from __future__ import annotations

import os
from collections import Counter
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import httpx

MODELS_DIR = Path(__file__).resolve().parent / "models"
MISTAKE_MODEL_PATH = MODELS_DIR / "mistake_classifier.joblib"
QUALITY_MODEL_PATH = MODELS_DIR / "rep_classifier.joblib"

# Maps MediaPipe session joint keys → EC3D base feature order
JOINT_TO_BASE = [
    ("leftKnee", "left_knee"),
    ("rightKnee", "right_knee"),
    ("leftHip", "left_hip"),
    ("rightHip", "right_hip"),
    ("backTilt", "back_tilt"),
    ("kneeAsymmetry", "knee_asym"),
    ("hipAsymmetry", "hip_asym"),
]

BASE_FEATURE_NAMES = [
    "left_knee",
    "right_knee",
    "left_hip",
    "right_hip",
    "back_tilt",
    "knee_asym",
    "hip_asym",
    "ankle_y_delta",
    "foot_spread",
    "shoulder_hip_y",
    "avg_knee",
    "hip_height",
    "torso_horiz",
]

# Align EC3D labels with live cue keys where possible
ERROR_ALIAS = {
    "knees_inward": "knee_cave",
    "not_low_enough": "shallow",
    "front_bent": "back_round",
    "feet_too_wide": "feet_too_wide",
    "knee_passes_toe": "knee_passes_toe",
    "arched_back": "arched_back",
    "hunch_back": "hunch_back",
    "other": "asymmetric",
}


def score_rep_quality(payload: dict[str, Any]) -> dict[str, Any]:
    endpoint = os.getenv("OCI_MODEL_ENDPOINT")
    if endpoint:
        try:
            return _call_oci_endpoint(endpoint, payload)
        except Exception:
            pass  # fall through to local EC3D models

    if MISTAKE_MODEL_PATH.exists():
        try:
            return _score_ec3d_mistake(payload)
        except Exception:
            pass

    if QUALITY_MODEL_PATH.exists():
        try:
            return _score_quality_model(payload)
        except Exception:
            pass

    return _heuristic_score(payload)


@lru_cache(maxsize=4)
def _load_bundle(path_str: str):
    import joblib

    return joblib.load(path_str)


def _score_ec3d_mistake(payload: dict[str, Any]) -> dict[str, Any]:
    import numpy as np

    bundle = _load_bundle(str(MISTAKE_MODEL_PATH))
    model = bundle["model"] if isinstance(bundle, dict) else bundle
    vec = _sequence_feature_vector(payload)
    X = np.array([vec])
    pred = model.predict(X)[0]
    conf = 0.65
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(X)[0]
        conf = float(max(proba))
    elif hasattr(model, "named_steps") and hasattr(model.named_steps.get("rf", None), "predict_proba"):
        proba = model.predict_proba(X)[0]
        conf = float(max(proba))

    if pred == "correct":
        return {
            "quality": "correct",
            "error_type": None,
            "confidence": conf,
            "source": "ec3d_mistake",
            "raw_label": "correct",
        }

    alias = ERROR_ALIAS.get(str(pred), str(pred))
    return {
        "quality": "incorrect",
        "error_type": alias,
        "confidence": conf,
        "source": "ec3d_mistake",
        "raw_label": str(pred),
    }


def _score_quality_model(payload: dict[str, Any]) -> dict[str, Any]:
    import numpy as np

    bundle = _load_bundle(str(QUALITY_MODEL_PATH))
    model = bundle["model"] if isinstance(bundle, dict) else bundle
    vec = _sequence_feature_vector(payload)
    X = np.array([vec])
    pred = model.predict(X)[0]
    conf = 0.65
    if hasattr(model, "predict_proba"):
        conf = float(max(model.predict_proba(X)[0]))

    if pred == "correct" or pred == 0:
        return {
            "quality": "correct",
            "error_type": None,
            "confidence": conf,
            "source": "ec3d_quality",
        }
    # fall back to heuristic error type when only binary quality available
    heur = _heuristic_score(payload)
    return {
        "quality": "incorrect",
        "error_type": heur.get("error_type") or "shallow",
        "confidence": conf,
        "source": "ec3d_quality",
    }


def _frame_base_vector(joints: dict[str, Any]) -> list[float]:
    left_knee = _f(joints, "leftKnee", 180.0)
    right_knee = _f(joints, "rightKnee", 180.0)
    left_hip = _f(joints, "leftHip", 180.0)
    right_hip = _f(joints, "rightHip", 180.0)
    back_tilt = _f(joints, "backTilt", 0.0)
    knee_asym = _f(joints, "kneeAsymmetry", abs(left_knee - right_knee))
    hip_asym = _f(joints, "hipAsymmetry", abs(left_hip - right_hip))
    hip_height = _f(joints, "hipY", 0.5)
    # Approximate extras not always present in browser payload
    ankle_y_delta = _f(joints, "ankleYDelta", 0.0)
    foot_spread = _f(joints, "footSpread", 0.0)
    shoulder_hip_y = _f(joints, "shoulderHipY", 0.25)
    avg_knee = 0.5 * (left_knee + right_knee)
    torso_horiz = abs(90.0 - back_tilt)
    return [
        left_knee,
        right_knee,
        left_hip,
        right_hip,
        back_tilt,
        knee_asym,
        hip_asym,
        ankle_y_delta,
        foot_spread,
        shoulder_hip_y,
        avg_knee,
        hip_height,
        torso_horiz,
    ]


def _sequence_feature_vector(payload: dict[str, Any]) -> list[float]:
    import numpy as np

    frames = payload.get("frames") or []
    if not frames:
        return [0.0] * (len(BASE_FEATURE_NAMES) * 4)

    rows = []
    for f in frames:
        joints = f.get("joints") or {}
        rows.append(_frame_base_vector(joints))
    arr = np.asarray(rows, dtype=np.float64)
    return np.concatenate(
        [arr.mean(axis=0), arr.std(axis=0), arr.min(axis=0), arr.max(axis=0)]
    ).tolist()


def _f(joints: dict[str, Any], key: str, default: float) -> float:
    v = joints.get(key)
    if v is None:
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _call_oci_endpoint(endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    token = os.getenv("OCI_MODEL_AUTH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    body = {"input": _sequence_feature_vector(payload)}
    with httpx.Client(timeout=10.0) as client:
        resp = client.post(endpoint, json=body, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    if "quality" in data:
        data["source"] = "oci_model_deployment"
        return data
    return {
        "quality": data.get("prediction", "correct"),
        "error_type": data.get("error_type"),
        "confidence": float(data.get("confidence", 0.7)),
        "source": "oci_model_deployment",
    }


def _heuristic_score(payload: dict[str, Any]) -> dict[str, Any]:
    frames = payload.get("frames") or []
    if not frames:
        return {
            "quality": "incorrect",
            "error_type": "shallow",
            "confidence": 0.4,
            "source": "heuristic",
        }

    errors = [f.get("errorType") for f in frames if f.get("errorType")]
    ratio = len(errors) / max(1, len(frames))
    if ratio > 0.15 and errors:
        top = Counter(errors).most_common(1)[0][0]
        return {
            "quality": "incorrect",
            "error_type": top,
            "confidence": min(0.9, 0.5 + ratio),
            "source": "heuristic",
        }
    return {
        "quality": "correct",
        "error_type": None,
        "confidence": 0.72,
        "source": "heuristic",
    }
