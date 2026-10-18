"""Rule checks with clinical thresholds for five shoulder exercises, exported for the web app, and measured on
MobiPhysio videos that physiotherapists scored >= 90 (to count false alarms, i.e. good reps that get a flag).

  python training/clinical_rules.py      (needs scripts/get_mobiphysio.py + training/extract_pose.py mobiphysio)

The thresholds are NOT learned from data. They come from textbook range-of-motion norms (AAOS / Norkin & White,
"Measurement of Joint Motion": shoulder abduction 0-180, external rotation 0-90, internal rotation 0-70, horizontal
adduction 0-135 deg) and common compensation limits; each check says where its number comes from ("basis").
MobiPhysio's expert scores don't name mistakes (and their good/poor split mostly hinges on one undisclosed criterion
that isn't about joint angles), so they can't validate *which* mistake is named; they only tell us how often
correct-looking reps from 14-24 different people trip a rule.

Writes web/models/rules_<exercise>.json, training/rules_report.json and tests/data/rules_<exercise>.json (replay
fixtures for tests/rules_test.mjs).
"""

import csv
import glob
import json
import os
import sys
from collections import Counter

import numpy as np

import angle_rules as A

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data", "mobiphysio")
OUT_WEB = os.path.join(ROOT, "web", "models")
OUT_TEST = os.path.join(ROOT, "tests", "data")
GOOD, POOR = 90, 85
SEG = {"mode": "auto", "minFrames": 18, "maxFrames": 300, "pad": 6, "calibFrames": 8, "history": 150}   # at 30 fps


def check(signal, stat, kind, basis, lo=None, hi=None, code_low=None, code_high=None, scale=10, rest=0):
    """kind: rom (range of motion; the mobility setting scales its limit toward `rest`, the resting value),
    form, or comp (compensation; the mobility setting allows a little more)."""
    return {"id": f"{signal}@{stat}", "signal": signal, "stat": stat, "kind": kind, "min": lo, "max": hi,
            "code_low": code_low, "code_high": code_high, "scale": scale, "rest": rest, "basis": basis}


ELBOW_90 = "elbow held near a right angle (90 +- 30 deg) for 90/90 rotation"
AT_SHOULDER = "upper arm at shoulder height (90 +- 20 deg of abduction), the 90/90 test position"
LEAN = "trunk side lean under 10 deg (trunk lean is the usual compensation for limited shoulder range)"
# No torso-twist check: from a front camera, trunk rotation can't be told apart from the shoulder blade wrapping
# forward, which is a normal part of these movements (a shoulder-line twist limit flagged 42% of good cross-body reps).
EXERCISES = {
    "shoulder_abduction_full": {
        "mobi": "E01", "title": "Shoulder Abduction AROM", "primary": "arm_raise", "restIs": "min",
        "seg": {"start": 35, "end": 20, "rest": 10}, "minAmp": 60,
        "checks": [
            check("arm_raise", "peak", "rom", "AAOS normal shoulder abduction 0-180 deg; 150+ counts as reaching overhead",
                  lo=150, code_low="ERR_LOW_RAISE"),
            check("elbow", "peak", "form", "straight arm: elbow within 30 deg of full extension", lo=150, code_low="ERR_BENT_ELBOW"),
            check("trunk_lean", "drift", "comp", LEAN, hi=10, code_high="ERR_TRUNK_LEAN"),
        ]},
    "shoulder_adduction": {
        "mobi": "E02", "title": "Shoulder Horizontal Adduction", "primary": "hand_across", "restIs": "min",
        "seg": {"start": 0.4, "end": 0.2, "rest": 0.1}, "minAmp": 0.6,
        "checks": [
            check("hand_across", "peak", "rom", "horizontal adduction (AAOS norm 0-135 deg) carries the hand across the "
                  "body: it should pass well beyond the midline (0.3+ shoulder widths). Reaching the other shoulder (0.5) "
                  "flagged 23% of reps physiotherapists scored as good, so the midline-plus criterion is used",
                  lo=0.3, code_low="ERR_NOT_ACROSS", scale=0.2, rest=-0.8),
            check("elbow", "peak", "form", "arm kept fairly straight: elbow within 40 deg of full extension", lo=140,
                  code_low="ERR_BENT_ELBOW"),
            check("trunk_lean", "drift", "comp", LEAN, hi=10, code_high="ERR_TRUNK_LEAN"),
        ]},
    "shoulder_external_rotation": {
        "mobi": "E03", "start_arm_raise": 45, "title": "External Rotation at 90° Abduction", "primary": "rotation", "restIs": "min",
        "seg": {"start": 25, "end": 12, "rest": 8}, "minAmp": 35,
        "checks": [
            check("rotation", "peak", "rom", "AAOS normal external rotation 0-90 deg; 60+ allows for the ~10 deg "
                  "uncertainty of estimating rotation from a front camera", lo=60, code_low="ERR_LOW_ROTATION"),
            check("arm_raise", "peak", "form", AT_SHOULDER, lo=70, hi=110, code_low="ERR_ELBOW_DROP", code_high="ERR_ELBOW_HIGH"),
            check("elbow", "peak", "form", ELBOW_90, lo=60, hi=120, code_low="ERR_ELBOW_ANGLE", code_high="ERR_ELBOW_ANGLE"),
            check("trunk_lean", "drift", "comp", LEAN, hi=10, code_high="ERR_TRUNK_LEAN"),
        ]},
    "shoulder_internal_rotation": {
        "mobi": "E04", "start_arm_raise": 45, "title": "Internal Rotation at 90° Abduction", "primary": "rotation", "restIs": "max",
        "seg": {"start": 25, "end": 12, "rest": 8}, "minAmp": 35,
        "checks": [
            check("rotation", "peak", "rom", "AAOS normal internal rotation 0-70 deg; 50+ allows for the ~10 deg "
                  "uncertainty of estimating rotation from a front camera", hi=-50, code_high="ERR_LOW_ROTATION"),
            check("arm_raise", "peak", "form", AT_SHOULDER, lo=70, hi=110, code_low="ERR_ELBOW_DROP", code_high="ERR_ELBOW_HIGH"),
            check("elbow", "peak", "form", ELBOW_90, lo=60, hi=120, code_low="ERR_ELBOW_ANGLE", code_high="ERR_ELBOW_ANGLE"),
            check("trunk_lean", "drift", "comp", LEAN, hi=10, code_high="ERR_TRUNK_LEAN"),
        ]},
    "arm_circles": {
        "mobi": "E05", "title": "Shoulder Circumduction", "primary": "arm_raise", "restIs": "min",
        "seg": {"start": 35, "end": 20, "rest": 10}, "minAmp": 60,
        "checks": [
            check("arm_raise", "peak", "rom", "full circumduction passes overhead: shoulder elevation 150+ deg "
                  "(AAOS flexion / abduction norm 180)", lo=150, code_low="ERR_SMALL_CIRCLE"),
            check("elbow", "peak", "form", "straight arm: elbow within 30 deg of full extension", lo=150, code_low="ERR_BENT_ELBOW"),
            check("trunk_lean", "drift", "comp", LEAN, hi=10, code_high="ERR_TRUNK_LEAN"),
        ]},
}
CUES = {   # full cue, short spoken cue, name shown in the app
    "ERR_LOW_RAISE": ("Raise your arm higher, all the way up beside your ear, if it's comfortable.", "Higher", "Limited abduction range"),
    "ERR_BENT_ELBOW": ("Keep your elbow straight.", "Straight elbow", "Elbow not fully extended"),
    "ERR_TRUNK_LEAN": ("Keep your trunk upright; don't lean to the side.", "Stay upright", "Lateral trunk lean"),
    "ERR_NOT_ACROSS": ("Bring your arm further across your body, toward the other shoulder.", "Further across", "Limited horizontal adduction range"),
    "ERR_LOW_ROTATION": ("Rotate your forearm further, as far as is comfortable.", "Rotate further", "Limited rotation range"),
    "ERR_ELBOW_DROP": ("Keep your elbow up at shoulder height.", "Elbow up", "Elbow below shoulder height"),
    "ERR_ELBOW_HIGH": ("Keep your elbow level with your shoulder, not above it.", "Elbow level", "Elbow above shoulder height"),
    "ERR_ELBOW_ANGLE": ("Keep your elbow bent at a right angle.", "Elbow at 90", "Elbow not held at 90°"),
    "ERR_SMALL_CIRCLE": ("Make bigger circles, reaching up overhead.", "Bigger circles", "Limited circumduction range"),
}
UNITS = {"arm_raise": ("Shoulder elevation", "°"), "elbow": ("Elbow angle", "°"), "trunk_lean": ("Lateral trunk lean", "°"),
         "hand_across": ("Hand past midline (shoulder widths)", ""), "rotation": ("Rotation from neutral", "°"),
         "torso_twist": ("Trunk rotation", "°")}


def load_scores():
    out, cur = {}, None
    for r in list(csv.reader(open(glob.glob(os.path.join(DATA, "*.csv"))[0], encoding="utf-8-sig")))[2:]:
        if r and r[0].strip():
            cur = r[0].strip()
            try:
                out[cur] = float(r[11])
            except (IndexError, ValueError):
                pass
    return out


def load(path):
    X = np.load(path).astype(float)
    bad = np.isnan(X[:, 0, 0])
    if bad.all():
        return None
    if bad.any():   # fill short gaps so the signals stay continuous
        idx = np.arange(len(X))
        for j in range(33):
            for k in range(X.shape[2]):
                X[bad, j, k] = np.interp(idx[bad], idx[~bad], X[~bad, j, k])
    return X


def aspect_of(vid, cache={}):
    """Frame width / height after the phone's rotation flag is applied (what MediaPipe saw)."""
    path = os.path.join(DATA, "mp", "sizes.json")
    if not cache and os.path.exists(path):
        cache.update(json.load(open(path)))
    if vid not in cache:
        import cv2
        cap = cv2.VideoCapture(os.path.join(DATA, "videos", vid + ".mp4"))
        ok, f = cap.read()
        cap.release()
        cache[vid] = f.shape[1] / f.shape[0] if ok else 9 / 16
        json.dump(cache, open(path, "w"))
    return cache[vid]


def seg_cfg(ex, stride):
    c = {**SEG, **ex["seg"], "restIs": ex["restIs"]}
    for k in ("minFrames", "maxFrames", "pad", "calibFrames", "history"):
        c[k] = max(1, round(c[k] / stride))
    return c


def video_reps(vid, ex, stride):
    I, W = load(os.path.join(DATA, "mp", vid + "_2d.npy")), load(os.path.join(DATA, "mp", vid + "_3d.npy"))
    if I is None or np.nanmean(I[:, [12, 14, 16, 23, 24], 3]) < 0.6:   # arm and hips must be clearly visible
        return [], None
    asp = aspect_of(vid)
    prim = A.signals(I, asp)[ex["primary"]]
    reps = []
    for a, b in A.find_reps(prim, seg_cfg(ex, stride)):
        p = prim[a:b]
        base = np.percentile(prim, 10) if ex["restIs"] == "min" else np.percentile(prim, 90)
        amp = (p.max() - base) if ex["restIs"] == "min" else (base - p.min())
        if amp < ex["minAmp"] or not 0.6 <= (b - a) * stride / 30 <= 10:
            continue
        if "start_arm_raise" in ex and A.signals(I[a:a + 3], asp)["arm_raise"].mean() < ex["start_arm_raise"]:
            continue   # same as the app: rotation reps count only with the elbow raised toward shoulder height
        v = A.rep_values(I[a:b], asp, W[a:b], ex["checks"], ex["primary"], ex["restIs"])
        reps.append({"span": [a, b], "values": v, "verdict": A.judge(v, ex["checks"])[0]})
    return reps, (I, W, asp)


def main():
    scores = load_scores()
    stride = json.load(open(os.path.join(DATA, "mp", "meta.json")))["stride"]
    only = set(sys.argv[1:])
    report = {}
    for name, ex in EXERCISES.items():
        if only and name not in only and ex["mobi"] not in only:
            continue
        good, poor, no_reps, fixtures = [], [], 0, []
        for path in sorted(glob.glob(os.path.join(DATA, "mp", f"{ex['mobi']}_*_2d.npy"))):
            vid = os.path.basename(path)[:-7]
            s = scores.get(vid)
            if s is None or POOR <= s < GOOD:
                continue
            reps, raw = video_reps(vid, ex, stride)
            if not reps:
                no_reps += 1
                continue
            (good if s >= GOOD else poor).append((vid, reps))
            if s >= GOOD and len(fixtures) < 4 and len(reps) >= 4:
                I, W, asp = raw
                I, W = np.round(I[..., [0, 1, 3]], 5), np.round(W[..., :3], 5)   # what the test file stores
                fx = []
                for r in reps:
                    (a, b), v = r["span"], None
                    v = A.rep_values(I[a:b], asp, W[a:b], ex["checks"], ex["primary"], ex["restIs"])
                    fx.append({"span": [a, b], "values": v, "verdict": A.judge(v, ex["checks"])[0]})
                fixtures.append({"video": vid, "stride": stride, "aspect": asp, "img": I.tolist(), "world": W.tolist(), "reps": fx})
        gr = [r for _, reps in good for r in reps]
        pr = [r for _, reps in poor for r in reps]
        if not gr:
            print(f"{name}: no good videos with detected reps yet")
            continue
        per_check = {c["id"]: round(float(np.mean([A.judge(r["values"], [c])[0] != "CORRECT" for r in gr])), 3) for c in ex["checks"]}
        m = {
            "good_videos": len(good), "poor_videos": len(poor), "videos_without_reps": no_reps,
            "people": len({v.split("_")[1] for v, _ in good + poor}),
            "good_reps": len(gr), "good_reps_pass": round(float(np.mean([r["verdict"] == "CORRECT" for r in gr])), 3),
            "good_reps_flagged_by_check": per_check,
            "poor_reps": len(pr), "poor_reps_flagged": round(float(np.mean([r["verdict"] != "CORRECT" for r in pr])), 3) if pr else None,
            "flags_on_good": dict(Counter(r["verdict"] for r in gr if r["verdict"] != "CORRECT").most_common()),
            "flags_on_poor": dict(Counter(r["verdict"] for r in pr if r["verdict"] != "CORRECT").most_common()),
            "reps_per_video": float(np.median([len(r) for _, r in good + poor])),
            "measured_on_good": {c["id"]: [round(float(np.percentile([r["values"][c["id"]] for r in gr], q)), 2) for q in (5, 50, 95)]
                                 for c in ex["checks"]},
        }
        report[name] = m
        print(f"\n=== {ex['title']} ({ex['mobi']}): {len(good)} good / {len(poor)} poor videos with reps "
              f"({no_reps} without), {m['people']} people, median {m['reps_per_video']:.0f} reps/video")
        print(f"  good reps passing every check: {m['good_reps_pass']:.0%} of {len(gr)}"
              + (f" | poor reps flagged: {m['poor_reps_flagged']:.0%} of {len(pr)}" if pr else ""))
        for c in ex["checks"]:
            lim = (f">= {c['min']}" if c["min"] is not None else "") + (" and " if c["min"] is not None and c["max"] is not None else "") + (f"<= {c['max']}" if c["max"] is not None else "")
            p5, p50, p95 = m["measured_on_good"][c["id"]]
            print(f"    {c['id']:<18} rule {lim:<16} good reps p5/median/p95 = {p5}/{p50}/{p95} -> flags {per_check[c['id']]:.0%} of good reps")
        print("  flags on poor videos:", m["flags_on_poor"])
        export(name, ex, m)
        if fixtures:
            json.dump({"exercise": name, "videos": fixtures}, open(os.path.join(OUT_TEST, f"rules_{name}.json"), "w"))
    if report:
        old = json.load(open(os.path.join(HERE, "rules_report.json"))) if os.path.exists(os.path.join(HERE, "rules_report.json")) else {}
        json.dump({**old, **report}, open(os.path.join(HERE, "rules_report.json"), "w"), indent=2)


def export(name, ex, m):
    codes = sorted({c[k] for c in ex["checks"] for k in ("code_low", "code_high") if c[k]})
    json.dump({
        "type": "rules", "exercise": name, "title": ex["title"], "side": "right",
        "segmenter": {**SEG, **ex["seg"], "restIs": ex["restIs"], "primary": "img:" + ex["primary"]},
        "primary": ex["primary"], "minAmp": ex["minAmp"],
        "checks": [{**c, "label": UNITS[c["signal"]][0], "unit": UNITS[c["signal"]][1]} for c in ex["checks"]],
        "cues": {c: CUES[c][0] for c in codes}, "short": {c: CUES[c][1] for c in codes}, "names": {c: CUES[c][2] for c in codes},
        "metrics": m,
        "source": "Clinical thresholds (AAOS / Norkin & White norms, common compensation limits); false alarms measured on "
                  "MobiPhysio videos physiotherapists scored >= 90 (Iqbal et al., Harvard Dataverse 2025, CC0)",
    }, open(os.path.join(OUT_WEB, f"rules_{name}.json"), "w"), indent=1, allow_nan=False)


if __name__ == "__main__":
    main()
