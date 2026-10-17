"""
Joint-interval rule engine
==========================
Every monitored joint/metric has a CORRECT interval [lo, hi]. A measurement is classified:
    LOW      value below lo      (err < 0)
    CORRECT  lo <= value <= hi   (err = 0)
    HIGH     value above hi      (err > 0)
and we also return `fix` = signed amount to move to get back to the nearest boundary.

Metric kinds
  interior : angle AT a joint between two segments. Range 0..180.  (knee, elbow, ...)
  signed   : direction-aware angle, circular, range (-180, 180] (i.e. a 360 deg span).
             Distance is wrapped, so 179 vs -179 is a 2 deg difference, not 358.
  linear   : plain metres / ratios (no wrap).

Form is only judged in the HOLD phase (the spreadsheet's movement_endpoint). During lift/return
only loose speed/control rules apply, because the angles are legitimately moving.
"""
import json
import numpy as np


def wrap180(x):
    """Wrap degrees to (-180, 180]."""
    return (np.asarray(x, float) + 180.0) % 360.0 - 180.0


def classify(value, kind, lo, hi):
    """Return (state, fix) arrays. state: -1 LOW, 0 CORRECT, +1 HIGH. fix: signed delta to re-enter interval."""
    v = np.asarray(value, float)
    if kind == "signed":
        mid, half = (lo + hi) / 2.0, (hi - lo) / 2.0
        err = wrap180(v - mid)                 # circular signed distance to interval centre
        state = np.where(err < -half, -1, np.where(err > half, 1, 0))
        fix = np.where(state == -1, -half - err, np.where(state == 1, half - err, 0.0))
    else:
        state = np.where(v < lo, -1, np.where(v > hi, 1, 0))
        fix = np.where(state == -1, lo - v, np.where(state == 1, hi - v, 0.0))
    return state.astype(int), fix


# ---------------------------------------------------------------------------------------------
# RULES (hold-phase intervals). Source: spreadsheet targets + clinical tolerance. CALIBRATE ON REAL PEOPLE.
# Each rule: metric, kind, [lo, hi], and what LOW / HIGH mean (label + spoken cue).
# ---------------------------------------------------------------------------------------------
RULES = {
    "bird_dog": [
        dict(metric="moving_knee_deg", kind="interior", lo=165, hi=180,
             low=dict(label="leg_not_extended", cue="Straighten your back leg."),
             high=None),
        dict(metric="support_knee_deg", kind="interior", lo=80, hi=100,
             low=dict(label="support_knee_too_closed", cue="Bring your support knee under your hip."),
             high=dict(label="support_knee_too_open", cue="Bring your support knee under your hip.")),
        dict(metric="leg_vs_trunk_deg", kind="signed", lo=-10, hi=10,
             low=dict(label="leg_too_low", cue="Lift your leg up to trunk height."),
             high=dict(label="leg_too_high", cue="Lower your leg to trunk height.")),
        dict(metric="arm_flexion_deg", kind="interior", lo=85, hi=115,
             low=dict(label="arm_too_low", cue="Reach your arm out to shoulder height."),
             high=dict(label="arm_too_high", cue="Lower your arm to shoulder height.")),
        dict(metric="spine_sag_ratio", kind="linear", lo=-0.04, hi=0.04,
             low=dict(label="lumbar_rounding", cue="Don't round your back; keep it flat."),
             high=dict(label="lumbar_hyperextension", cue="Brace your core, don't let your belly sag.")),
        dict(metric="trunk_rotation_deg", kind="signed", lo=-8, hi=8,
             low=dict(label="trunk_rotation", cue="Keep your shoulders square to the floor."),
             high=dict(label="trunk_rotation", cue="Keep your shoulders square to the floor.")),
        dict(metric="pelvis_lateral_shift_m", kind="linear", lo=-0.03, hi=0.03,
             low=dict(label="lateral_hip_shift", cue="Keep your hips centred, don't shift sideways."),
             high=dict(label="lateral_hip_shift", cue="Keep your hips centred, don't shift sideways.")),
        dict(metric="head_vs_trunk_deg", kind="signed", lo=-25, hi=5,
             low=dict(label="head_dropped", cue="Lift your gaze slightly; keep your neck long."),
             high=dict(label="head_lifting", cue="Look at the floor, keep your neck neutral.")),
    ],
    "side_plank": [
        # signed: negative = hips BELOW the shoulder-knee line (sag), positive = ABOVE (pike).
        dict(metric="hip_line_dev_deg", kind="signed", lo=-10, hi=10,
             low=dict(label="hip_sag", cue="Lift your hips up in line with your shoulders and knees."),
             high=dict(label="hip_pike", cue="Lower your hips a little to make a straight line.")),
        dict(metric="knee_flex_deg", kind="interior", lo=80, hi=100,
             low=dict(label="knees_too_closed", cue="Open your knees to about 90 degrees."),
             high=dict(label="knees_too_open", cue="Bend your knees to about 90 degrees.")),
        dict(metric="elbow_deg", kind="interior", lo=80, hi=100,
             low=dict(label="shoulder_collapse", cue="Push the floor away; lift out of your shoulder."),
             high=dict(label="elbow_too_far", cue="Stack your elbow under your shoulder.")),
        dict(metric="pelvic_rotation_deg", kind="signed", lo=-10, hi=10,
             low=dict(label="pelvic_rotation", cue="Stack your hips, don't roll forward or back."),
             high=dict(label="pelvic_rotation", cue="Stack your hips, don't roll forward or back.")),
        dict(metric="head_drop_deg", kind="interior", lo=0, hi=11,
             low=None,
             high=dict(label="head_tilt", cue="Keep your head in line with your spine.")),
    ],
}


def evaluate(exercise, metrics, mask=None, rules=RULES):
    """
    exercise: 'bird_dog' | 'side_plank'
    metrics : dict metric_name -> array (T,)
    mask    : optional bool array (T,) -- frames to judge (hold frames). None = all.
    Returns dict metric -> dict(state=(T,), fix=(T,))
    """
    out = {}
    for r in rules[exercise]:
        s, f = classify(metrics[r["metric"]], r["kind"], r["lo"], r["hi"])
        if mask is not None:
            s = np.where(mask, s, 0); f = np.where(mask, f, 0.0)
        out[r["metric"]] = dict(state=s, fix=f, rule=r)
    return out


def violations(exercise, result, min_frac=0.4, mask=None):
    """Sequence/rep-level summary: rules violated in >= min_frac of judged frames."""
    n = max(1, int(mask.sum()) if mask is not None else len(next(iter(result.values()))["state"]))
    found = []
    for m, r in result.items():
        for sgn, key in ((-1, "low"), (1, "high")):
            frac = float((r["state"] == sgn).sum()) / n
            spec = r["rule"][key]
            if frac >= min_frac and spec:
                found.append(dict(metric=m, side=key, frac=frac, label=spec["label"], cue=spec["cue"],
                                  median_fix=float(np.median(r["fix"][r["state"] == sgn]))))
    return sorted(found, key=lambda d: -d["frac"])


class StreamJudge:
    """Real-time wrapper: EMA smoothing + hysteresis so cues don't flicker frame to frame."""
    def __init__(self, exercise, alpha=0.4, hyst=0.15, rules=RULES):
        self.rules = rules[exercise]; self.alpha = alpha; self.hyst = hyst
        self.ema, self.state = {}, {r["metric"]: 0 for r in self.rules}

    def step(self, metrics):
        cues = []
        for r in self.rules:
            m = r["metric"]; v = float(metrics[m])
            self.ema[m] = v if m not in self.ema else self.alpha * v + (1 - self.alpha) * self.ema[m]
            lo, hi, kind = r["lo"], r["hi"], r["kind"]
            width = (hi - lo) * self.hyst            # hysteresis band: must clearly re-enter to clear
            cur = self.state[m]
            tlo, thi = (lo + width, hi - width) if cur != 0 else (lo, hi)
            s, fix = classify(self.ema[m], kind, tlo, thi)
            self.state[m] = int(s)
            spec = r["low"] if s == -1 else r["high"] if s == 1 else None
            if spec:
                cues.append(dict(metric=m, label=spec["label"], cue=spec["cue"], fix=float(fix)))
        return cues


def export_json(path):
    with open(path, "w") as f:
        json.dump(RULES, f, indent=2)
