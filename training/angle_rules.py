"""Rule checks with clinical thresholds (the approach of Adarsh & Francis, NCECA 2026: measure joint angles with
MediaPipe, compare them with the range that defines correct form, name the mistake when an angle leaves it).
Thresholds come from textbook range-of-motion norms and common compensation limits (see clinical_rules.py),
not from data.

Python mirror of web/rules.js (same signals, rep statistics and decision); tests/rules_test.mjs checks they agree.

Angles are measured in the image plane (2D), because these exercises move across the camera's view while the person
faces it, and MediaPipe's depth estimate is its weakest axis (e.g. a forearm pointing straight up during external
rotation reads ~50 deg off vertical in its 3D landmarks). Image x is scaled by the frame's aspect ratio so angles are
true. Torso twist is the one depth movement; it uses the 3D landmarks. Right-arm exercises.
"""

import numpy as np

DEG = 180 / np.pi
FOREARM_TO_UPPER_ARM = 0.78   # segment length ratio (Winter, Biomechanics and Motor Control of Human Movement:
                              # upper arm 0.186 H, forearm 0.146 H); converts how tall the forearm looks into an angle


def _angle(u, v):
    c = np.sum(u * v, -1) / (np.linalg.norm(u, axis=-1) * np.linalg.norm(v, axis=-1) + 1e-9)
    return np.arccos(np.clip(c, -1, 1)) * DEG


def signals(img, aspect, world=None):
    """img: (T, 33, >=2) normalized image landmarks; aspect = frame width / height; world: (T, 33, 3) or None.
    Returns name -> (T,) per-frame values."""
    I = np.asarray(img, float)[..., :2] * np.array([aspect, 1.0])     # isotropic image units, y down
    p = lambda i: I[:, i]
    sh_r, sh_l, el, wr = p(12), p(11), p(14), p(16)
    mid_sh = (sh_l + sh_r) / 2
    sw = np.linalg.norm(sh_l - sh_r, axis=-1) + 1e-9
    left = (sh_l - sh_r) / sw[:, None]                                 # toward the person's left, in the image
    upper = np.linalg.norm(el - sh_r, axis=-1) + 1e-9
    side = sh_l - p(23)
    facing = np.sign(np.median(sh_l[:, 0] - sh_r[:, 0])) or 1.0      # which way is the person's left in the image
    out = {
        "arm_raise": _angle(p(24) - sh_r, el - sh_r),                  # 0 = arm down, 180 = straight overhead
        "elbow": _angle(sh_r - el, wr - el),                           # 180 = straight
        # trunk lean along the non-working (left) side, shoulder to hip: the working shoulder rises and shifts as the
        # arm goes up (normal shoulder-blade motion), so a line through both shoulders would show a lean that isn't there
        "trunk_lean": np.arctan2(side[:, 0] * facing, -side[:, 1]) * DEG,          # from image vertical; + = toward the person's left
        "hand_across": np.sum((wr - mid_sh) * left, -1) / sw,          # 0 = midline, 0.5 = at the other shoulder
        "rotation": np.arcsin(np.clip((el[:, 1] - wr[:, 1]) / upper / FOREARM_TO_UPPER_ARM, -1, 1)) * DEG,
                                                                       # 90/90 position: +90 forearm up, -90 down
    }
    if world is not None:   # shoulders vs hips in the horizontal plane (3D)
        W = np.asarray(world, float)[..., :3]
        up = np.array([0.0, -1.0, 0.0])
        flat = lambda v: v - (v @ up)[:, None] * up
        hip, shl = flat(W[:, 23] - W[:, 24]), flat(W[:, 11] - W[:, 12])
        out["torso_twist"] = np.arctan2(np.sum(np.cross(hip, shl) * up, -1), np.sum(hip * shl, -1)) * DEG
    return out


def rep_value(sig, stat, peak):
    """One number per rep from one signal."""
    start = sig[:3].mean()
    if stat == "peak":            # at the rep's turning point (furthest from the start position)
        return float(sig[peak])
    if stat == "max":
        return float(np.max(sig))
    if stat == "min":
        return float(np.min(sig))
    if stat == "drift":           # largest change from the start position during the rep
        return float(np.max(np.abs(sig - start)))
    raise ValueError(stat)


def peak_index(prim, rest_is):
    return int(np.argmax(prim) if rest_is == "min" else np.argmin(prim))


def rep_values(img, aspect, world, checks, primary, rest_is):
    S = signals(img, aspect, world)
    pk = peak_index(S[primary], rest_is)
    return {c["id"]: rep_value(S[c["signal"]], c["stat"], pk) for c in checks}


def judge(values, checks, relax=None):
    """Most severe failed check -> (code, how far past the limit), or ("CORRECT", 0).
    relax(check) -> (min, max) lets the mobility setting loosen limits."""
    worst, gap = "CORRECT", 0.0
    for c in checks:
        lo, hi = relax(c) if relax else (c.get("min"), c.get("max"))
        v, scale = values[c["id"]], c["scale"]
        if lo is not None and v < lo and (lo - v) / scale > gap:
            worst, gap = c["code_low"], (lo - v) / scale
        if hi is not None and v > hi and (v - hi) / scale > gap:
            worst, gap = c["code_high"], (v - hi) / scale
    return worst, gap


class RepSegmenter:
    """Python port of features.js RepSegmenter (same logic), for finding reps in unannotated videos."""

    def __init__(self, cfg):
        self.c = cfg
        self.buf, self.hist, self.base, self.in_rep, self.start = [], [], None, False, 0

    def away(self, v):
        return self.base - v if self.c["restIs"] == "max" else v - self.base

    def push(self, i, v):
        c = self.c
        self.buf.append((i, v))
        if not self.in_rep:
            self.hist.append(v)
            if len(self.hist) > c["history"]:
                self.hist.pop(0)
            s = sorted(self.hist)
            self.base = s[int(np.floor(0.9 * (len(s) - 1)))] if c["restIs"] == "max" else s[int(np.ceil(0.1 * (len(s) - 1)))]
            if len(self.hist) < c["calibFrames"]:
                if len(self.buf) > c["pad"]:
                    self.buf.pop(0)
                return None
        d = self.away(v)
        if not self.in_rep:
            if d > c["start"]:
                k = len(self.buf) - 1
                while k > 0 and self.away(self.buf[k - 1][1]) > c["rest"]:
                    k -= 1
                self.start, self.in_rep = max(0, k - c["pad"]), True
            elif len(self.buf) > 4 * c["pad"]:
                self.buf = self.buf[-2 * c["pad"]:]
            return None
        n = len(self.buf) - self.start
        if d < c["end"] and n >= c["minFrames"]:
            idx = [b[0] for b in self.buf[self.start:]]
            self.buf, self.in_rep = self.buf[-c["pad"]:], False
            return idx[0], idx[-1] + 1
        if n > c["maxFrames"]:
            self.buf, self.in_rep = self.buf[-c["pad"]:], False
        return None


def find_reps(prim, cfg):
    """Frame spans [a, b) of the reps the live detector would find in this signal."""
    seg, out = RepSegmenter(cfg), []
    for i, v in enumerate(prim):
        if np.isfinite(v):
            r = seg.push(i, float(v))
            if r:
                out.append(r)
    return out
