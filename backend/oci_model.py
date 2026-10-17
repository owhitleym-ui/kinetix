"""
OCI Model Deployment client for rep quality classification.
Uses a local heuristic / sklearn model when the endpoint is not configured.
"""

from __future__ import annotations

import os
from collections import Counter
from pathlib import Path
from typing import Any

import httpx

LOCAL_MODEL_PATH = Path(__file__).resolve().parent / "models" / "rep_classifier.joblib"


def score_rep_quality(payload: dict[str, Any]) -> dict[str, Any]:
    endpoint = os.getenv("OCI_MODEL_ENDPOINT")
    if endpoint:
        return _call_oci_endpoint(endpoint, payload)
    if LOCAL_MODEL_PATH.exists():
        return _score_local_model(payload)
    return _heuristic_score(payload)


def _call_oci_endpoint(endpoint: str, payload: dict[str, Any]) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    # Optional OCI auth token / tenancy headers for MD endpoint
    token = os.getenv("OCI_MODEL_AUTH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    features = _flatten_features(payload)
    body = {"input": features}
    with httpx.Client(timeout=10.0) as client:
        resp = client.post(endpoint, json=body, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    # Normalize common response shapes
    if "quality" in data:
        data["source"] = "oci_model_deployment"
        return data
    return {
        "quality": data.get("prediction", "correct"),
        "error_type": data.get("error_type"),
        "confidence": float(data.get("confidence", 0.7)),
        "source": "oci_model_deployment",
    }


def _score_local_model(payload: dict[str, Any]) -> dict[str, Any]:
    import joblib
    import numpy as np

    clf = joblib.load(LOCAL_MODEL_PATH)
    feats = np.array([_flatten_features(payload)])
    pred = clf.predict(feats)[0]
    proba = max(clf.predict_proba(feats)[0]) if hasattr(clf, "predict_proba") else 0.7
    if pred == "correct" or pred == 0:
        return {
            "quality": "correct",
            "error_type": None,
            "confidence": float(proba),
            "source": "local_model",
        }
    error = pred if isinstance(pred, str) and pred != "incorrect" else "shallow"
    return {
        "quality": "incorrect",
        "error_type": error,
        "confidence": float(proba),
        "source": "local_model",
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


def _flatten_features(payload: dict[str, Any]) -> list[float]:
    """Average joint metrics across frames into a fixed-length vector."""
    keys = [
        "leftKnee",
        "rightKnee",
        "leftHip",
        "rightHip",
        "backTilt",
        "leftKneeCave",
        "rightKneeCave",
        "kneeAsymmetry",
        "hipAsymmetry",
    ]
    frames = payload.get("frames") or []
    if not frames:
        return [0.0] * len(keys)

    acc = {k: [] for k in keys}
    for f in frames:
        joints = f.get("joints") or {}
        for k in keys:
            v = joints.get(k)
            if v is not None:
                try:
                    acc[k].append(float(v))
                except (TypeError, ValueError):
                    pass
    return [sum(acc[k]) / len(acc[k]) if acc[k] else 0.0 for k in keys]
