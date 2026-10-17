"""Train the per-exercise form-error classifiers on REHAB26-ViewAngles (MediaPipe world landmarks) and export
them for the browser.

  python training/train_rehab26.py            uses data/rehab26 if downloaded (scripts/get_data.sh), otherwise the
                                              compact dataset in dataset/rehab26_features.npz (ships with the repo)
  python training/train_rehab26.py --compact  always use the compact dataset

With the compact dataset the models and metrics are reproduced, but the replay files for tests/sim_test.mjs and
tests/parity_test.mjs (which need raw skeletons) are not written.

Two models per exercise:
  early       reps 1-3: features = change from the rep's own start pose (no per-user calibration needed)
  calibrated  rep 4+:   features centered on the median of the same user's previous reps
A mistake is named whenever P(correct) < tau (sensitive to mistakes).

Evaluation: leave-one-person-out (5 people), simulated live (only past reps used for calibration).
Writes:
  web/models/rehab26_<exercise>.json          final models (all 5 people) used by the web app
  tests/data/holdout_<person>_<exercise>.json models trained without <person>, for tests/sim_test.mjs
  tests/data/seq_<person>_<exercise>.json     that person's facing-camera stretches + annotated reps
  tests/data/parity.json                      reps + Python features, for tests/parity_test.mjs
  training/report.json                        metrics
"""

import csv
import glob
import json
import os
import sys
import time
from collections import Counter, defaultdict

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import rehab_features as RF

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.environ.get("REHAB26", os.path.join(ROOT, "data", "rehab26"))
OUT_WEB = os.path.join(ROOT, "web", "models")
OUT_TEST = os.path.join(ROOT, "tests", "data")
os.makedirs(OUT_WEB, exist_ok=True)
os.makedirs(OUT_TEST, exist_ok=True)

EXERCISES = {"1": "arm_abduction", "6": "squat", "7": "shoulder_extension"}
TITLES = {"arm_abduction": "Arm abduction (right arm)", "squat": "Squat", "shoulder_extension": "Shoulder extension (right arm)"}
CUES = {
    "CORRECT": "Good rep.",
    "ERR_ARM_FORWARD": "Raise your arm out to the side, in line with your body, not in front of you.",
    "ERR_ELEVATED_SHOULDER": "Keep your shoulder down; don't shrug.",
    "ERR_HEAD_TO_SIDE": "Keep your head straight; don't tilt it.",
    "ERR_LOW_ABDUCTION": "Lift your arm higher, at least to shoulder level.",
    "ERR_BENT_ARM": "Keep your elbow straight.",
    "ERR_KNEES_INSIDE": "Push your knees out so they track over your toes.",
    "ERR_TORSO_TO_SIDE": "Keep your torso centered; don't lean to one side.",
    "ERR_SHALLOW_SQUAT": "Go deeper: sit back until your thighs are near parallel.",
    "ERR_KNEES_FORWARD": "Sit back into your hips so your knees stay behind your toes.",
    "ERR_LIFTED_HEELS": "Keep your heels on the floor.",
    "ERR_TORSO_FORWARD": "Keep your torso upright; don't bend forward.",
    "ERR_TORSO_ROTATION": "Keep your chest facing forward; don't twist.",
    "ERR_ARM_TO_SIDE": "Move your arm straight back, close to your body.",
}
SHORT = {  # spoken right after the rep; short enough to hear mid-set
    "CORRECT": "Good", "ERR_ARM_FORWARD": "Arm to the side", "ERR_ELEVATED_SHOULDER": "Shoulder down",
    "ERR_HEAD_TO_SIDE": "Head straight", "ERR_LOW_ABDUCTION": "Higher", "ERR_BENT_ARM": "Straight elbow",
    "ERR_KNEES_INSIDE": "Knees out", "ERR_TORSO_TO_SIDE": "Stay centered", "ERR_SHALLOW_SQUAT": "Lower",
    "ERR_KNEES_FORWARD": "Sit back", "ERR_LIFTED_HEELS": "Heels down", "ERR_TORSO_FORWARD": "Chest up",
    "ERR_TORSO_ROTATION": "Don't twist", "ERR_ARM_TO_SIDE": "Arm straight back",
}
# Live rep detection (thresholds tuned with tune.mjs on held-out people). "auto" watches one signal move away
# from rest and back: squat = shoulder height above ankles (% leg length), abduction = right shoulder angle (deg).
# Shoulder extension moves along the camera's depth axis, so from the front it is too faint to detect reliably;
# it uses a guided tempo instead (the app cues each rep and records a fixed window).
AUTO_COMMON = {"mode": "auto", "minFrames": 20, "maxFrames": 300, "pad": 8, "calibFrames": 8, "history": 150}
SEGMENTER = {
    "squat": {**AUTO_COMMON, "primary": "shoulder_height", "restIs": "max", "start": 7, "end": 4, "rest": 2.5},
    "arm_abduction": {**AUTO_COMMON, "primary": "right_shoulder", "restIs": "min", "start": 40, "end": 6, "rest": 8},
    "shoulder_extension": {"mode": "tempo", "window": 3000, "gap": 900, "firstCue": 2500, "cue": "Back"},
}
CAL_REPS, CAL_WINDOW = 3, 20
# Feedback on every rep. Reps 1-3 use the "early" model (features = change from the rep's own start pose, no
# per-user calibration); from rep 4 the calibrated model takes over (features centered on the user's own previous
# reps). A mistake is named whenever P(correct) < TAU, i.e. tuned to be sensitive to mistakes
# (experiments_delta.py: calibrated @0.5 catches ~94-97% of mistakes; early @0.3 catches ~82-90%).
TAU, TAU_EARLY = 0.5, 0.3
FRONT = 15  # |viewing angle| <= 15 deg counts as "facing the camera"


def view_angle(orientation, cam):
    return {1: -orientation, 2: 45 - orientation, 3: 90 - orientation}[cam]


def load_world(video_id, cam, cache={}):
    key = (video_id, cam)
    if key not in cache:
        hits = glob.glob(os.path.join(DATA, "mp", "**", f"{video_id}_cam{cam}_3d.npy"), recursive=True)
        cache[key] = np.load(hits[0], allow_pickle=False) if hits else None
    return cache[key]


def build_samples():
    rows = list(csv.DictReader(open(os.path.join(DATA, "Segmentation.csv")), delimiter=";"))
    samples = []
    for r in rows:
        ex = EXERCISES[r["exercise_id"]]
        for cam in (1, 2, 3):
            W = load_world(r["video_id"], cam)
            if W is None:
                continue
            a, b = int(r["first_frame"]), min(int(r["last_frame"]) + 1, len(W))
            if b - a < 12:
                continue
            angle = view_angle(int(r["person_orientation"]), cam)
            samples.append({"ex": ex, "person": r["person"], "video": r["video_id"], "cam": cam, "angle": angle,
                            "session": f"{r['person']}_cam{cam}_{'front' if abs(angle) <= FRONT else 'other'}",
                            "label": r["error_description"] or "CORRECT", "a": a, "b": b})
    rng = np.random.default_rng(1)
    for s in samples:
        W = load_world(s["video"], s["cam"])
        P = W[s["a"]:s["b"], :, :3]
        s["x"], s["d"] = RF.rep_features(P), RF.rep_features(P, "delta")
        # extra copies cut the way the live detector cuts reps (offsets measured with offsets.mjs)
        s["xv"], s["dv"] = [], []
        for _ in range(LIVE_COPIES):
            a, b = live_cut(s, len(W), rng)
            Q = W[a:b, :, :3]
            s["xv"].append(RF.rep_features(Q)); s["dv"].append(RF.rep_features(Q, "delta"))
    return samples


LIVE_COPIES = 2
LIVE_OFFSETS = {"squat": ((-8, 11), (-30, -9)), "arm_abduction": ((-5, 5), (-16, -5))}  # (start, end) p10..p90


def live_cut(s, n, rng):
    if s["ex"] == "shoulder_extension":  # tempo: window starts at the cue, fixed 3 s
        a = max(0, s["a"] - 3)
        return a, min(n, a + round(SEGMENTER["shoulder_extension"]["window"] * 30 / 1000))
    (s0, s1), (e0, e1) = LIVE_OFFSETS[s["ex"]]
    a = max(0, s["a"] + int(rng.integers(s0, s1 + 1)))
    b = min(n, s["b"] + int(rng.integers(e0, e1 + 1)))
    return a, max(b, a + 12)


def _lr():
    return make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=5000, class_weight="balanced"))


def fit(train):
    """Calibrated model: center each training session on its own median rep, then scale + classify.
    Trained on the annotated cut plus live-style cuts (each version centered within itself)."""
    X, y = [], []
    for version in range(1 + LIVE_COPIES):
        for g in sorted({s["session"] for s in train}):
            G = [s for s in train if s["session"] == g]
            F = np.array([s["x"] if version == 0 else s["xv"][version - 1] for s in G])
            X.append(F - np.median(F, axis=0))
            y += [s["label"] for s in G]
    return _lr().fit(np.vstack(X), y)


def fit_early(train):
    """Early model for the first reps: change-from-start features, no calibration (annotated + live-style cuts)."""
    X = [s["d"] for s in train] + [d for s in train for d in s["dv"]]
    y = [s["label"] for s in train] + [s["label"] for s in train for _ in s["dv"]]
    return _lr().fit(np.array(X), y)


def decide(model, x, tau):
    """Name the most likely mistake whenever P(correct) < tau, else correct."""
    pr = dict(zip(model.classes_, model.predict_proba([x])[0]))
    if pr["CORRECT"] >= tau:
        return "CORRECT"
    return max((p, c) for c, p in pr.items() if c != "CORRECT")[1]


def live_predict(model, early, session_reps):
    """Reps in time order -> a prediction for every rep: early model first, calibrated once enough reps."""
    out = []
    for i, s in enumerate(session_reps):
        if i < CAL_REPS:
            out.append((s, decide(early, s["d"], TAU_EARLY), "early"))
            continue
        past = np.array([p["x"] for p in session_reps[max(0, i - CAL_WINDOW):i]])
        out.append((s, decide(model, s["x"] - np.median(past, axis=0), TAU), "calibrated"))
    return out


def _weights(m, feature_set, tau):
    sc, lr = m.named_steps["standardscaler"], m.named_steps["logisticregression"]
    return {"feature_set": feature_set, "tau": tau, "classes": list(lr.classes_),
            "mean": np.round(sc.mean_, 6).tolist(), "std": np.round(np.maximum(sc.scale_, 1e-6), 6).tolist(),
            "coef": np.round(lr.coef_, 6).tolist(), "intercept": np.round(lr.intercept_, 6).tolist()}


def export(model, early, ex, path, metrics):
    classes = list(model.classes_)
    json.dump({
        "feature_version": RF.FEATURE_VERSION, "exercise": ex, "title": TITLES[ex],
        **_weights(model, "abs", TAU), "early": _weights(early, "delta", TAU_EARLY),
        "cues": {c: CUES[c] for c in classes}, "short": {c: SHORT[c] for c in classes},
        "calibration": {"reps": CAL_REPS, "window": CAL_WINDOW},
        "segmenter": SEGMENTER[ex], "metrics": metrics,
        "source": "REHAB26-ViewAngles (CC BY-NC 4.0), doi:10.5281/zenodo.23018127",
    }, open(path, "w"), allow_nan=False)


def front_windows(S, person):
    """Facing-camera stretches of one person's recordings, split where annotated reps are far apart."""
    by_cam = defaultdict(list)
    for s in S:
        if s["person"] == person and abs(s["angle"]) <= FRONT:
            by_cam[(s["video"], s["cam"])].append(s)
    out = {}
    for (video, cam), reps in by_cam.items():
        reps.sort(key=lambda s: s["a"])
        runs, cur = [], [reps[0]]
        for s in reps[1:]:
            if s["a"] - cur[-1]["b"] > 200:
                runs.append(cur); cur = []
            cur.append(s)
        runs.append(cur)
        W = load_world(video, cam)
        for k, run in enumerate(runs):
            lo, hi = max(0, run[0]["a"] - 45), min(len(W), run[-1]["b"] + 45)
            out[f"{video}_cam{cam}_run{k}"] = {"offset": lo, "frames": np.round(W[lo:hi, :, :3], 4).tolist(),
                                              "reps": [{"a": s["a"], "b": s["b"], "label": s["label"]} for s in run]}
    return out


FEATURES_FILE = os.path.join(ROOT, "dataset", "rehab26_features.npz")


def load_compact(path=FEATURES_FILE):
    """Samples from the compact dataset (features precomputed by training/export_features.py)."""
    with np.load(path, allow_pickle=False) as npz:
        z = {k: npz[k] for k in npz.files}   # read each array once (indexing the npz re-reads it every time)
    X, D, XV, DV = (z[k].astype(np.float64) for k in ("x", "d", "xv", "dv"))
    return [{"ex": str(z["ex"][i]), "person": str(z["person"][i]), "video": str(z["video"][i]), "cam": int(z["cam"][i]),
             "angle": int(z["angle"][i]), "session": str(z["session"][i]), "label": str(z["label"][i]),
             "a": int(z["a"][i]), "b": int(z["b"][i]), "x": X[i], "d": D[i], "xv": list(XV[i]), "dv": list(DV[i])}
            for i in range(len(z["label"]))]


def main():
    t0 = time.time()
    raw = os.path.exists(os.path.join(DATA, "Segmentation.csv")) and "--compact" not in sys.argv
    if not raw and not os.path.exists(FEATURES_FILE):
        raise SystemExit("No training data: run scripts/get_data.sh, or restore dataset/rehab26_features.npz")
    samples = build_samples() if raw else load_compact()
    people = sorted({s["person"] for s in samples})
    print(f"{len(samples)} rep-views from {len(people)} people, "
          f"{'full skeleton data' if raw else 'compact dataset'} ({time.time() - t0:.0f}s to load)")
    rng = np.random.default_rng(0)

    report = {}
    for ex in EXERCISES.values():
        S = [s for s in samples if s["ex"] == ex]
        res = []
        for test in people:
            train = [s for s in S if s["person"] != test]
            m, e = fit(train), fit_early(train)
            for g in sorted({s["session"] for s in S if s["person"] == test}):
                res += live_predict(m, e, sorted([s for s in S if s["session"] == g], key=lambda s: s["a"]))
            export(m, e, ex, os.path.join(OUT_TEST, f"holdout_{test}_{ex}.json"), {"held_out": test})
            if raw:  # replay sequences need the raw skeletons
                json.dump(front_windows(S, test), open(os.path.join(OUT_TEST, f"seq_{test}_{ex}.json"), "w"))

        front = [(s["label"], p, k) for s, p, k in res if abs(s["angle"]) <= FRONT]

        def frac(values):  # None (valid JSON) when there is nothing to average
            return round(float(np.mean(values)), 3) if len(values) else None

        def summary(rows):
            good = [p == "CORRECT" for t, p, _ in rows if t == "CORRECT"]
            bad = [(t, p) for t, p, _ in rows if t != "CORRECT"]
            return {"good_left_alone": frac(good), "mistakes_caught": frac([p != "CORRECT" for _, p in bad]),
                    "mistakes_named_right": frac([p == t for t, p in bad]), "exact": frac([t == p for t, p, _ in rows]),
                    "n": len(rows)}

        pc = lambda v: "  n/a" if v is None else f"{v * 100:3.0f}%"
        overall, early_s, cal_s = summary(front), summary([r for r in front if r[2] == "early"]), summary([r for r in front if r[2] == "calibrated"])
        recall = {c: round(float(np.mean([p == c for t, p, _ in front if t == c])), 3) for c in sorted({t for t, _, _ in front})}
        print(f"\n=== {TITLES[ex]}: {len(S)} rep-views; live, feedback on every rep, facing camera:")
        for name, sm in [("all reps", overall), (f"reps 1-{CAL_REPS} (early model)", early_s), ("rep 4+ (calibrated)", cal_s)]:
            print(f"  {name:<24} good left alone {pc(sm['good_left_alone'])} | mistakes caught {pc(sm['mistakes_caught'])}"
                  f" | named right {pc(sm['mistakes_named_right'])} | exact {pc(sm['exact'])} (n={sm['n']})")
        print("  recall per class: " + ", ".join(f"{c} {v * 100:.0f}%" for c, v in recall.items()))
        print("  top confusions:", [(f"{t}->{p}", n) for (t, p), n in Counter((t, p) for t, p, _ in front if t != p).most_common(3)])

        metrics = {**overall, "early": early_s, "calibrated": cal_s, "recall": recall, "people": len(people)}
        export(fit(S), fit_early(S), ex, os.path.join(OUT_WEB, f"rehab26_{ex}.json"), metrics)
        report[ex] = metrics

    if raw:  # parity data needs the raw skeletons
        pick = [samples[i] for i in rng.choice(len(samples), 30, replace=False)]
        rounded = lambda s: np.round(load_world(s["video"], s["cam"])[s["a"]:s["b"], :, :3], 6)
        json.dump([{"frames": rounded(s).tolist(), "features": RF.rep_features(rounded(s)).tolist(),
                    "delta": RF.rep_features(rounded(s), "delta").tolist()}
                   for s in pick], open(os.path.join(OUT_TEST, "parity.json"), "w"))
    json.dump(report, open(os.path.join(HERE, "report.json"), "w"), indent=2)
    print(f"\ndone in {time.time() - t0:.0f}s; models in web/models/" +
          (", test data in tests/data/" if raw else " (compact dataset: replay test data needs scripts/get_data.sh)"))


if __name__ == "__main__":
    main()
