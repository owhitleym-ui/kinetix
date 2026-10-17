"""
Train exercise + mistake classifiers on synthetic lower-back data only:
  Data/synthetic_lowerback_3D.pickle  (bird_dog, side_plank)

Exports:
  backend/models/exercise_classifier.joblib
  backend/models/mistake_classifier.joblib
  backend/models/rep_classifier.joblib
  frontend/public/models/exercise_weights.json
"""

from __future__ import annotations

import json
import pickle
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
DATA_LOWERBACK = ROOT / "Data" / "synthetic_lowerback_3D.pickle"
OUT_BACKEND = ROOT / "backend" / "models"
OUT_FRONTEND = ROOT / "frontend" / "public" / "models"

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
    "bird_dog": "bird_dog",
    "side_plank": "side_plank",
}

LOWERBACK_MISTAKES = {
    "correct",
    "leg_too_high",
    "lumbar_hyperextension",
    "trunk_rotation",
    "lateral_hip_shift",
    "head_lifting",
    "hip_sag",
    "pelvic_rotation",
    "shoulder_collapse",
    "head_tilt",
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

SEQ_FEATURE_NAMES = (
    [f"{n}_mean" for n in FEATURE_NAMES]
    + [f"{n}_std" for n in FEATURE_NAMES]
    + [f"{n}_min" for n in FEATURE_NAMES]
    + [f"{n}_max" for n in FEATURE_NAMES]
)


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
    up = np.array([0.0, 1.0, 0.0])
    n = np.linalg.norm(d)
    if n < 1e-8:
        return 0.0
    cos = np.clip(np.dot(d / n, up), -1.0, 1.0)
    return float(np.degrees(np.arccos(cos)))


def frame_features(pose_3x25: np.ndarray) -> np.ndarray:
    p = pose_3x25.T

    def j(name):
        return p[J[name]]

    lk = angle(j("l_hip"), j("l_knee"), j("l_ankle"))
    rk = angle(j("r_hip"), j("r_knee"), j("r_ankle"))
    lh = angle(j("l_shoulder"), j("l_hip"), j("l_knee"))
    rh = angle(j("r_shoulder"), j("r_hip"), j("r_knee"))
    sh_mid = 0.5 * (j("l_shoulder") + j("r_shoulder"))
    hip_mid = 0.5 * (j("l_hip") + j("r_hip"))
    bt = back_tilt(sh_mid, hip_mid)
    return np.array(
        [
            lk,
            rk,
            lh,
            rh,
            bt,
            abs(lk - rk),
            abs(lh - rh),
            abs(j("l_ankle")[1] - j("r_ankle")[1]),
            abs(j("l_ankle")[0] - j("r_ankle")[0]),
            abs(sh_mid[1] - hip_mid[1]),
            0.5 * (lk + rk),
            hip_mid[1],
            abs(90.0 - bt),
        ],
        dtype=np.float64,
    )


def aggregate_sequence_features(frame_feats: np.ndarray) -> np.ndarray:
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


def load_lowerback_sequences(path: Path):
    with open(path, "rb") as f:
        data = pickle.load(f)
    coords = data["coords"]
    sequences = data["sequences"]

    X, y_ex, y_mist, groups = [], [], [], []
    X_seq, y_mist_seq, y_ex_seq, groups_seq = [], [], [], []

    for seq in sequences:
        key = seq.get("exercise_key")
        if key not in EXERCISE_MAP:
            continue
        label = str(seq.get("label", "other"))
        if label not in LOWERBACK_MISTAKES:
            label = "other"
        sub = str(seq.get("subject_id", "lb0"))
        start, end = int(seq["start"]), int(seq["end"])
        n = max(1, end - start)
        pick = np.linspace(start, end - 1, num=min(12, n), dtype=int)
        feats = []
        for fi in pick:
            feat = frame_features(coords[fi])
            if not np.isfinite(feat).all():
                continue
            feats.append(feat)
            X.append(feat)
            y_ex.append(EXERCISE_MAP[key])
            y_mist.append(label)
            groups.append(sub)

        if feats:
            X_seq.append(aggregate_sequence_features(np.vstack(feats)))
            y_mist_seq.append(label)
            y_ex_seq.append(EXERCISE_MAP[key])
            groups_seq.append(sub)

    if not X:
        raise SystemExit(f"No samples loaded from {path}")

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


def export_logistic_js(
    X,
    y,
    groups,
    path: Path,
    dataset_note: str = "bird_dog, side_plank",
    task: str = "exercise",
):
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
    print(f"Logistic {task} accuracy (JS export): {acc:.3f}")

    scaler = pipe.named_steps["scaler"]
    lr = pipe.named_steps["lr"]
    payload = {
        "type": "multinomial_logistic",
        "task": task,
        "feature_names": FEATURE_NAMES,
        "classes": list(lr.classes_),
        "mean": scaler.mean_.tolist(),
        "scale": scaler.scale_.tolist(),
        "coef": lr.coef_.tolist(),
        "intercept": lr.intercept_.tolist(),
        "accuracy_holdout": float(acc),
        "dataset": "synthetic_lowerback_3D",
        "classes_note": dataset_note,
        "note": "Trained only on Data/synthetic_lowerback_3D.pickle",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {path}")
    return payload


def main():
    if not DATA_LOWERBACK.exists():
        raise SystemExit(f"Missing dataset: {DATA_LOWERBACK}")

    print(f"Loading {DATA_LOWERBACK} (synthetic lower-back only) …")
    X, y_ex, y_mist, groups, X_seq, y_mist_seq, y_ex_seq, groups_seq = load_lowerback_sequences(
        DATA_LOWERBACK
    )
    print(f"Frame samples: {len(X)} | exercises: {dict(zip(*np.unique(y_ex, return_counts=True)))}")
    print(f"Sequences: {len(X_seq)} | mistakes: {dict(zip(*np.unique(y_mist_seq, return_counts=True)))}")

    OUT_BACKEND.mkdir(parents=True, exist_ok=True)

    ex_clf = train_classifier(X, y_ex, groups, "Exercise classifier (frame)")
    joblib.dump(
        {"model": ex_clf, "features": FEATURE_NAMES, "task": "exercise", "dataset": "synthetic_lowerback"},
        OUT_BACKEND / "exercise_classifier.joblib",
    )

    mist_clf = train_classifier(X_seq, y_mist_seq, groups_seq, "Mistake classifier (sequence)")
    joblib.dump(
        {
            "model": mist_clf,
            "features": SEQ_FEATURE_NAMES,
            "base_features": FEATURE_NAMES,
            "task": "mistake_sequence",
            "dataset": "synthetic_lowerback",
        },
        OUT_BACKEND / "mistake_classifier.joblib",
    )

    y_quality = np.array(["correct" if m == "correct" else "incorrect" for m in y_mist_seq])
    q_clf = train_classifier(X_seq, y_quality, groups_seq, "Quality binary (sequence)")
    joblib.dump(
        {
            "model": q_clf,
            "features": SEQ_FEATURE_NAMES,
            "base_features": FEATURE_NAMES,
            "task": "quality_sequence",
            "dataset": "synthetic_lowerback",
        },
        OUT_BACKEND / "rep_classifier.joblib",
    )

    export_logistic_js(
        X,
        y_ex,
        groups,
        OUT_FRONTEND / "exercise_weights.json",
        dataset_note="bird_dog, side_plank",
    )
    # Frame-level mistake logistic for live browser cues
    export_logistic_js(
        X,
        y_mist,
        groups,
        OUT_FRONTEND / "mistake_weights.json",
        dataset_note="lower-back mistake labels",
        task="mistake",
    )
    print("\nDone.")


if __name__ == "__main__":
    main()
