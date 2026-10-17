"""
Keypoint normalization helpers for UI-PRMD / session feature vectors.
"""

from __future__ import annotations

import numpy as np

FEATURE_KEYS = [
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


def frames_to_vector(frames: list[dict]) -> np.ndarray:
    """Average joint metrics across a rep into a fixed-length feature vector."""
    acc = {k: [] for k in FEATURE_KEYS}
    for f in frames:
        joints = f.get("joints") or f
        for k in FEATURE_KEYS:
            v = joints.get(k)
            if v is not None:
                acc[k].append(float(v))
    vec = np.array(
        [np.mean(acc[k]) if acc[k] else 0.0 for k in FEATURE_KEYS],
        dtype=np.float32,
    )
    return vec


def normalize_vector(vec: np.ndarray, mean: np.ndarray | None = None, std: np.ndarray | None = None):
    if mean is None or std is None:
        return vec
    std_safe = np.where(std < 1e-6, 1.0, std)
    return (vec - mean) / std_safe
