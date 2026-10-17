"""
Train exercise + mistake classifiers on EC3D (Data/data_3D.pickle).

Exports:
  backend/models/exercise_classifier.joblib
  backend/models/mistake_classifier.joblib
  frontend/public/models/exercise_weights.json  (runs in browser)

Label map (EC3D paper Table 1, lab codes observed in pickle):
  1 correct | 2 feet_too_wide | 3 knees_inward | 4 not_low_enough
  5 front_bent | 6 knee_passes_toe | 7 arched_back | 8 hunch_back
"""

from __future__ import annotations

import json
import pickle
import sys
from collections import defaultdict
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "Data" / "data_3D.pickle"
OUT_BACKEND = ROOT / "backend" / "models"
OUT_FRONTEND = ROOT / "frontend" / "public" / "models"

# NTU-style 25-joint indices
J = {
    "spine": 0,
    "mid_spine": 1,
    "neck": 2,
    "head": 3,
    "l_shoulder": 4,
    "r_shoulder": 8,
    "l_hip": 12,
    "l_knee": 13,
    "l_ankle": 14,
    "l_foot": 15,
    "r_hip": 16,
    "r_knee": 17,
    "r_ankle": 18,
    "r_foot": 19,
}

EXERCISE_MAP = {
    "SQUAT": "squat",
    "Lunges": "lunge",
    "Plank": "plank",
}

MISTAKE_MAP = {
    1: "correct",
    2: "feet_too_wide",
    3: "knees_inward",
    4: "not_low_enough",
    5: "front_bent",
    6: "knee_passes_toe",
    7: "arched_back",
    8: "hunch_back",
    10: "other",
}

FEATURE_NAMES = [
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


def angle(a, b, c):
    ba = a - b
    bc = c - b
    nba = np.linalg.norm(ba)
    nbc = np.linalg.norm(bc)
    if nba < 1e-8 or nbc < 1e-8:
        return 180.0
    cos = np.clip(np.dot(ba, bc) / (nba * nbc), -1.0, 1.0)
    return float(np.degrees(np.arccos(cos)))


def back_tilt(shoulder_mid, hip_mid):
    d = hip_mid - shoulder_mid
    # angle from vertical (y axis up in many mocap; EC3D appears y-up-ish)
    # use angle between torso vector and world up [0,1,0]
    up = np.array([0.0, 1.0, 0.0])
    n = np.linalg.norm(d)
    if n < 1e-8:
        return 0.0
    cos = np.clip(np.dot(d / n, up), -1.0, 1.0)
    return float(np.degrees(np.arccos(cos)))


def frame_features(pose_3x25: np.ndarray) -> np.ndarray:
    """pose: (3, 25) xyz."""
    p = pose_3x25.T  # (25, 3)

    def j(name):
        return p[J[name]]

    lk = angle(j("l_hip"), j("l_knee"), j("l_ankle"))
    rk = angle(j("r_hip"), j("r_knee"), j("r_ankle"))
    lh = angle(j("l_shoulder"), j("l_hip"), j("l_knee"))
    rh = angle(j("r_shoulder"), j("r_hip"), j("r_knee"))
    sh_mid = 0.5 * (j("l_shoulder") + j("r_shoulder"))
    hip_mid = 0.5 * (j("l_hip") + j("r_hip"))
    bt = back_tilt(sh_mid, hip_mid)
    ankle_y_delta = abs(j("l_ankle")[1] - j("r_ankle")[1])
    foot_spread = abs(j("l_ankle")[0] - j("r_ankle")[0])
    shoulder_hip_y = abs(sh_mid[1] - hip_mid[1])
    torso_horiz = abs(90.0 - bt)  # closer to 0 => more horizontal

    return np.array(
        [
            lk,
            rk,
            lh,
            rh,
            bt,
            abs(lk - rk),
            abs(lh - rh),
            ankle_y_delta,
            foot_spread,
            shoulder_hip_y,
            0.5 * (lk + rk),
            hip_mid[1],
            torso_horiz,
        ],
        dtype=np.float64,
    )


def aggregate_sequence_features(frame_feats: np.ndarray) -> np.ndarray:
    """Mean + std + min + max over frames → sequence vector."""
    if frame_feats.ndim != 2 or len(frame_feats) == 0:
        return np.zeros(len(FEATURE_NAMES) * 4, dtype=np.float64)
    return np.concatenate(
        [
            frame_feats.mean(axis=0),
            frame_feats.std(axis=0),
            frame_feats.min(axis=0),
            frame_feats.max(axis=0),
        ]
    )


SEQ_FEATURE_NAMES = (
    [f"{n}_mean" for n in FEATURE_NAMES]
    + [f"{n}_std" for n in FEATURE_NAMES]
    + [f"{n}_min" for n in FEATURE_NAMES]
    + [f"{n}_max" for n in FEATURE_NAMES]
)


def load_sequences(path: Path):
    with open(path, "rb") as f:
        data = pickle.load(f)
    labels = data["labels"]
    poses = data["poses"]  # (N, 3, 25)

    seq_frames = defaultdict(list)
    for i, row in enumerate(labels):
        act, sub, lab, rep, _frame = row
        key = (str(act), str(sub), int(lab), int(rep))
        seq_frames[key].append(i)

    X, y_ex, y_mist, groups = [], [], [], []
    X_seq, y_mist_seq, y_ex_seq, groups_seq = [], [], [], []

    for (act, sub, lab, rep), idxs in seq_frames.items():
        if act not in EXERCISE_MAP:
            continue
        idxs = sorted(idxs)
        # sample up to 12 frames evenly through the sequence
        pick = np.linspace(0, len(idxs) - 1, num=min(12, len(idxs)), dtype=int)
        feats = []
        for pi in pick:
            fi = idxs[pi]
            feat = frame_features(poses[fi])
            if not np.isfinite(feat).all():
                continue
            feats.append(feat)
            X.append(feat)
            y_ex.append(EXERCISE_MAP[act])
            y_mist.append(MISTAKE_MAP.get(lab, "other"))
            groups.append(sub)

        if feats:
            seq_feat = aggregate_sequence_features(np.vstack(feats))
            X_seq.append(seq_feat)
            y_mist_seq.append(MISTAKE_MAP.get(lab, "other"))
            y_ex_seq.append(EXERCISE_MAP[act])
            groups_seq.append(sub)

    return (
        np.vstack(X),
        np.array(y_ex),
        np.array(y_mist),
        np.array(groups),
        np.vstack(X_seq),
        np.array(y_mist_seq),
        np.array(y_ex_seq),
        np.array(groups_seq),
    )


def train_classifier(X, y, groups, name: str):
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42)
    train_idx, test_idx = next(splitter.split(X, y, groups))
    Xtr, Xte = X[train_idx], X[test_idx]
    ytr, yte = y[train_idx], y[test_idx]

    clf = Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "rf",
                RandomForestClassifier(
                    n_estimators=200,
                    max_depth=12,
                    min_samples_leaf=2,
                    class_weight="balanced_subsample",
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    clf.fit(Xtr, ytr)
    pred = clf.predict(Xte)
    print(f"\n=== {name} ===")
    print(classification_report(yte, pred, zero_division=0))
    return clf


def export_logistic_js(X, y, groups, path: Path):
    """Browser-friendly multinomial logistic weights for exercise ID."""
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42)
    train_idx, test_idx = next(splitter.split(X, y, groups))
    pipe = Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "lr",
                LogisticRegression(
                    max_iter=2000,
                    class_weight="balanced",
                    random_state=42,
                ),
            ),
        ]
    )
    pipe.fit(X[train_idx], y[train_idx])
    acc = pipe.score(X[test_idx], y[test_idx])
    print(f"Logistic exercise accuracy (JS export): {acc:.3f}")

    scaler = pipe.named_steps["scaler"]
    lr = pipe.named_steps["lr"]
    classes = list(lr.classes_)
    payload = {
        "type": "multinomial_logistic",
        "feature_names": FEATURE_NAMES,
        "classes": classes,
        "mean": scaler.mean_.tolist(),
        "scale": scaler.scale_.tolist(),
        "coef": lr.coef_.tolist(),  # (n_classes, n_features)
        "intercept": lr.intercept_.tolist(),
        "accuracy_holdout": float(acc),
        "dataset": "EC3D",
        "note": "Trained on Data/data_3D.pickle for browser exercise detection",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {path}")
    return payload


def main():
    if not DATA.exists():
        raise SystemExit(f"Missing dataset: {DATA}")

    print(f"Loading {DATA} …")
    X, y_ex, y_mist, groups, X_seq, y_mist_seq, y_ex_seq, groups_seq = load_sequences(DATA)
    print(f"Frame samples: {len(X)} | exercises: {dict(zip(*np.unique(y_ex, return_counts=True)))}")
    print(f"Sequences: {len(X_seq)} | mistakes: {dict(zip(*np.unique(y_mist_seq, return_counts=True)))}")

    OUT_BACKEND.mkdir(parents=True, exist_ok=True)

    ex_clf = train_classifier(X, y_ex, groups, "Exercise classifier (frame)")
    joblib.dump(
        {"model": ex_clf, "features": FEATURE_NAMES, "task": "exercise"},
        OUT_BACKEND / "exercise_classifier.joblib",
    )
    print(f"Wrote {OUT_BACKEND / 'exercise_classifier.joblib'}")

    mist_clf = train_classifier(
        X_seq, y_mist_seq, groups_seq, "Mistake classifier (sequence)"
    )
    joblib.dump(
        {
            "model": mist_clf,
            "features": SEQ_FEATURE_NAMES,
            "base_features": FEATURE_NAMES,
            "task": "mistake_sequence",
            "aggregation": "mean_std_min_max",
        },
        OUT_BACKEND / "mistake_classifier.joblib",
    )
    print(f"Wrote {OUT_BACKEND / 'mistake_classifier.joblib'}")

    # Also keep exercise-conditioned binary quality (correct vs incorrect)
    y_quality = np.array(["correct" if m == "correct" else "incorrect" for m in y_mist_seq])
    q_clf = train_classifier(X_seq, y_quality, groups_seq, "Quality binary (sequence)")
    joblib.dump(
        {
            "model": q_clf,
            "features": SEQ_FEATURE_NAMES,
            "base_features": FEATURE_NAMES,
            "task": "quality_sequence",
        },
        OUT_BACKEND / "rep_classifier.joblib",
    )
    print(f"Wrote {OUT_BACKEND / 'rep_classifier.joblib'}")

    export_logistic_js(X, y_ex, groups, OUT_FRONTEND / "exercise_weights.json")
    print("\nDone.")


if __name__ == "__main__":
    main()
