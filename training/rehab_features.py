"""Python mirror of frontend/lib/rehab/features.js (feature version 1), vectorized for training.

Keep identical to the JS; tests/parity_test.mjs compares both on the same reps.
"""

import numpy as np

FEATURE_VERSION = 1
N_RESAMPLE = 16
UP = np.array([0.0, -1.0, 0.0])
DEG = 180 / np.pi
SIGNAL_NAMES = [
    "knee_l", "knee_r", "hip_l", "hip_r", "elbow_l", "elbow_r", "shoulder_l", "shoulder_r",
    "rarm_side", "rarm_up", "rarm_fwd", "larm_side", "larm_up", "larm_fwd",
    "spine_side", "spine_fwd", "ear_shoulder_l", "ear_shoulder_r", "head_tilt",
    "knee_ankle_width", "ankle_hip_width", "heel_lift_l", "heel_lift_r", "knee_fwd_l", "knee_fwd_r",
    "torso_rotation",
]


def _dot(a, b):
    return np.sum(a * b, -1)


def _norm(a):
    return np.linalg.norm(a, axis=-1)


def _unit(a):
    return a / (_norm(a)[..., None] + 1e-9)


def _angle_between(u, v):
    return np.arccos(np.clip(_dot(u, v) / (_norm(u) * _norm(v) + 1e-9), -1, 1)) * DEG


def _angle_at(a, b, c):
    return _angle_between(a - b, c - b)


def frame_signals(P):
    """P: (T, 33, 3) world landmarks -> (T, 26)."""
    p = lambda i: P[:, i]
    hip = p(23) - p(24)
    L = _unit(hip - _dot(hip, UP)[:, None] * UP)
    F = np.cross(UP, L)
    body = lambda v: [_dot(v, L), _dot(v, UP), _dot(v, F)]
    sw = _norm(p(11) - p(12)) + 1e-9
    leg = (_norm(p(23) - p(25)) + _norm(p(25) - p(27)) + _norm(p(24) - p(26)) + _norm(p(26) - p(28))) / 2 + 1e-9
    spine = _unit((p(11) + p(12)) / 2 - (p(23) + p(24)) / 2)
    sl = p(11) - p(12)
    slh = _unit(sl - _dot(sl, UP)[:, None] * UP)
    rot = np.arctan2(_dot(np.cross(L, slh), UP), _dot(L, slh)) * DEG
    cols = [
        _angle_at(p(23), p(25), p(27)) / 180, _angle_at(p(24), p(26), p(28)) / 180,
        _angle_at(p(11), p(23), p(25)) / 180, _angle_at(p(12), p(24), p(26)) / 180,
        _angle_at(p(11), p(13), p(15)) / 180, _angle_at(p(12), p(14), p(16)) / 180,
        _angle_at(p(23), p(11), p(13)) / 180, _angle_at(p(24), p(12), p(14)) / 180,
        *body(_unit(p(16) - p(12))),
        *body(_unit(p(15) - p(11))),
        _dot(spine, L), _dot(spine, F),
        _norm(p(7) - p(11)) / sw, _norm(p(8) - p(12)) / sw,
        _angle_between(p(7) - p(8), sl) / 90,
        np.clip(_norm(p(25) - p(26)) / (_norm(p(27) - p(28)) + 1e-9), 0, 5),
        np.clip(_norm(p(27) - p(28)) / (_norm(p(23) - p(24)) + 1e-9), 0, 5),
        _dot(p(29) - p(31), UP) / leg, _dot(p(30) - p(32), UP) / leg,
        _dot(p(25) - p(31), F) / leg, _dot(p(26) - p(32), F) / leg,
        rot / 90,
    ]
    return np.stack(cols, axis=1)


def rep_features(P, feature_set="abs"):
    """P: (T, 33, 3) one rep -> features, same order as features.js repFeatures(frames, set).

    abs: absolute signals; delta: change from the rep's own start pose (no per-user calibration needed);
    abs+delta: both."""
    S = frame_signals(np.asarray(P, float))
    if feature_set == "abs+delta":
        return np.concatenate([_summarize(S), _summarize(S - S[:3].mean(axis=0))])
    return _summarize(S - S[:3].mean(axis=0) if feature_set == "delta" else S)


def _summarize(S):
    T = len(S)
    grid = np.linspace(0, T - 1, N_RESAMPLE)
    out = []
    for j in range(S.shape[1]):
        s = S[:, j]
        out.extend(np.interp(grid, np.arange(T), s))
        out.extend([s.min(), s.max(), s.mean()])
    return np.array(out)
