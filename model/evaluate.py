"""Quick evaluation harness for the rep classifier."""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
from sklearn.metrics import accuracy_score, classification_report

from train import synthesize

MODEL_PATH = Path(__file__).resolve().parents[1] / "backend" / "models" / "rep_classifier.joblib"


def main():
    if not MODEL_PATH.exists():
        raise SystemExit(f"No model at {MODEL_PATH} — run train.py first")

    clf = joblib.load(MODEL_PATH)
    X, y = synthesize(200)
    pred = clf.predict(X)
    print("Accuracy:", accuracy_score(y, pred))
    print(classification_report(y, pred))


if __name__ == "__main__":
    main()
