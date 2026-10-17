"""
Train a lightweight rep quality classifier.

For HackTN:
  1. Prefer UI-PRMD skeleton data if available under ./data/ui-prmd/
  2. Otherwise synthesize a small dataset matching our feature schema
  3. Fit RandomForest, dump to backend/models/rep_classifier.joblib

UI-PRMD: https://www.webpages.uidaho.edu/ui-prmd/
Paper: https://arxiv.org/abs/1807.02700 (related PT motion datasets)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "backend" / "models" / "rep_classifier.joblib"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from preprocess import FEATURE_KEYS, frames_to_vector  # noqa: E402


def load_ui_prmd(data_dir: Path):
    """Load pre-extracted JSON feature files if present."""
    X, y = [], []
    for path in data_dir.glob("**/*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        label = data.get("label") or data.get("quality")
        frames = data.get("frames") or data.get("joints")
        if not label or not frames:
            continue
        X.append(frames_to_vector(frames if isinstance(frames, list) else [frames]))
        y.append(label)
    if not X:
        return None, None
    return np.vstack(X), np.array(y)


def synthesize(n: int = 400):
    """Synthetic correct vs incorrect squat feature vectors for demo training."""
    rng = np.random.default_rng(42)
    X, y = [], []
    for _ in range(n // 2):
        # Correct: moderate knee flexion, upright-ish back, low cave/asym
        vec = np.array(
            [
                rng.normal(95, 8),  # leftKnee
                rng.normal(95, 8),  # rightKnee
                rng.normal(70, 6),  # leftHip
                rng.normal(70, 6),  # rightHip
                rng.normal(18, 4),  # backTilt
                rng.normal(0.01, 0.01),  # leftKneeCave
                rng.normal(0.01, 0.01),  # rightKneeCave
                rng.normal(4, 2),  # kneeAsymmetry
                rng.normal(4, 2),  # hipAsymmetry
            ],
            dtype=np.float32,
        )
        X.append(vec)
        y.append("correct")

    error_types = ["knee_cave", "back_round", "shallow", "asymmetric"]
    for i in range(n // 2):
        et = error_types[i % len(error_types)]
        vec = np.array(
            [
                rng.normal(95, 8),
                rng.normal(95, 8),
                rng.normal(70, 6),
                rng.normal(70, 6),
                rng.normal(18, 4),
                rng.normal(0.01, 0.01),
                rng.normal(0.01, 0.01),
                rng.normal(4, 2),
                rng.normal(4, 2),
            ],
            dtype=np.float32,
        )
        if et == "knee_cave":
            vec[5] = rng.normal(0.08, 0.02)
            vec[6] = rng.normal(0.08, 0.02)
        elif et == "back_round":
            vec[4] = rng.normal(42, 6)
        elif et == "shallow":
            vec[2] = rng.normal(100, 8)
            vec[3] = rng.normal(100, 8)
        else:
            vec[7] = rng.normal(22, 4)
            vec[8] = rng.normal(20, 4)
        X.append(vec)
        y.append(et)

    return np.vstack(X), np.array(y)


def main():
    data_dir = Path(__file__).resolve().parent / "data" / "ui-prmd"
    X, y = (None, None)
    if data_dir.exists():
        X, y = load_ui_prmd(data_dir)
        source = "ui-prmd"
    if X is None:
        X, y = synthesize()
        source = "synthetic"

    # Binary-ish multi-class: correct + error types
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y
    )
    clf = RandomForestClassifier(n_estimators=120, max_depth=8, random_state=42)
    clf.fit(X_train, y_train)
    pred = clf.predict(X_test)
    print(f"Trained on {source} · features={FEATURE_KEYS}")
    print(classification_report(y_test, pred))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": clf, "features": FEATURE_KEYS, "source": source}, OUT)
    # Also dump bare estimator for backend loader
    joblib.dump(clf, OUT)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
