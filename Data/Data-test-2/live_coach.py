"""
live_coach.py  --  bridge between your pose estimator and the interval rules.

Pipeline per frame:
  camera-frame 25-joint skeleton  ->  body frame (y = up from floor, x = toward head, z = right)
  -> mirror/swap so the "active" limbs match the rule convention
  -> metrics -> hold gate -> StreamJudge (smoothing + hysteresis) -> cues with `fix` deltas

Usage:
    coach = LiveCoach("bird_dog", fps=30)
    coach.calibrate(rest_frames)          # ~1-2 s of the person holding the START position
    for joints25 in stream:               # (25, 3) array, any camera orientation, metres
        out = coach.update(joints25)
        out["phase"]  -> "rest" | "moving" | "hold"
        out["cues"]   -> [{metric, label, cue, fix}, ...]   (only during hold)

Not yet tested with real MediaPipe output -- see mediapipe33_to_25() for the assumed mapping.
"""
from collections import deque
import numpy as np
from joint_intervals import StreamJudge
from generate_synthetic_lowerback import angles_bird_dog, angles_side_plank

# left<->right joint permutation (NTU 25 layout)
SWAP = list(range(25))
for a, b in [(4, 8), (5, 9), (6, 10), (7, 11), (12, 16), (13, 17), (14, 18), (15, 19), (21, 23), (22, 24)]:
    SWAP[a], SWAP[b] = b, a

LEFT_FLOOR = [5, 6, 7, 13, 14, 15]      # side plank: LEFT side down -> these touch the floor
RIGHT_FLOOR = [9, 10, 11, 17, 18, 19]
QUADRUPED_FLOOR = [6, 10, 13, 17, 14, 18]   # bird dog: both wrists, knees, ankles


def mediapipe33_to_25(lm):
    """lm: (33,3) MediaPipe *world* landmarks (metres). Returns (25,3) in NTU-like order. (assumed mapping)"""
    lm = np.asarray(lm, float)
    mid = lambda a, b: (lm[a] + lm[b]) / 2
    J = np.zeros((25, 3))
    J[0] = mid(23, 24); J[20] = mid(11, 12); J[1] = (J[0] + J[20]) / 2
    J[3] = mid(7, 8); J[2] = J[20] + 0.45 * (J[3] - J[20])
    J[4], J[5], J[6], J[7] = lm[11], lm[13], lm[15], (lm[17] + lm[19]) / 2
    J[8], J[9], J[10], J[11] = lm[12], lm[14], lm[16], (lm[18] + lm[20]) / 2
    J[12], J[13], J[14], J[15] = lm[23], lm[25], lm[27], lm[31]
    J[16], J[17], J[18], J[19] = lm[24], lm[26], lm[28], lm[32]
    J[21], J[22], J[23], J[24] = lm[19], lm[21], lm[20], lm[22]
    return J


def fit_floor(points):
    """Least-squares plane through floor-contact points. Returns (centroid, unit normal, rms residual)."""
    c = points.mean(0)
    _, s, vh = np.linalg.svd(points - c)
    return c, vh[-1], s[-1] / np.sqrt(len(points))


def ang3(a, b, c):
    v1, v2 = a - b, c - b
    return np.degrees(np.arccos(np.clip(v1 @ v2 / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9), -1, 1)))


def hip_line_dev(P):
    """Signed deviation (deg) of lower hip from shoulder->knee line: + above (pike), - below (sag). P:(25,3) body frame."""
    S, H, K = P[4], P[12], P[13]
    d, h = K - S, H - S
    cross = d[0] * h[1] - d[1] * h[0]
    return float(-np.sign(cross) * (180 - ang3(S, H, K)))


def frame_metrics(exercise, P):
    f = angles_bird_dog if exercise == "bird_dog" else angles_side_plank
    m = {k: float(v[0]) for k, v in f(P[None]).items()}
    if exercise == "side_plank":
        m["hip_line_dev_deg"] = hip_line_dev(P)
    return m


class LiveCoach:
    def __init__(self, exercise, fps=30, hold_window_s=1.0):
        assert exercise in ("bird_dog", "side_plank")
        self.ex, self.fps = exercise, fps
        self.win = max(3, int(hold_window_s * fps))
        self.buf = deque(maxlen=self.win)
        self.judge = StreamJudge(exercise)
        self.ready = False
        self.swap_session = False      # side plank: right side down
        self.swap_now = False          # bird dog: right leg moving
        self.baseline = None

    # ------------------------------------------------------------ calibration
    def _to_body(self, P):
        return (P - self.origin) @ self.R.T

    def calibrate(self, frames):
        F = np.asarray(frames, float)                      # (n, 25, 3) in camera frame
        mean = F.mean(0)
        if self.ex == "bird_dog":
            c, n, _ = fit_floor(mean[QUADRUPED_FLOOR])
        else:                                              # try both lying sides; the flatter contact set wins
            cl, nl, rl = fit_floor(mean[LEFT_FLOOR]); cr, nr, rr = fit_floor(mean[RIGHT_FLOOR])
            self.swap_session = rr < rl
            c, n = (cr, nr) if self.swap_session else (cl, nl)
        if ((mean - c) @ n).mean() < 0:
            n = -n                                         # make "up" point toward the body
        v = mean[20] - mean[0]
        x = v - (v @ n) * n; x /= np.linalg.norm(x) + 1e-9   # head direction along the floor
        z = np.cross(x, n)
        self.R = np.stack([x, n, z]); self.origin = c
        # baseline of the driver signal at rest
        d = [self._driver(self._orient(self._to_body(p), calib=True)) for p in F]
        self.baseline = float(np.median(d)); self.ready = True

    # --------------------------------------------------------------- per frame
    def _orient(self, Pb, calib=False):
        """Swap L/R + mirror z so the active limbs follow the rule convention."""
        if self.ex == "side_plank":
            swap = self.swap_session
        else:
            kl, kr = ang3(Pb[12], Pb[13], Pb[14]), ang3(Pb[16], Pb[17], Pb[18])
            if not calib and abs(kl - kr) > 20:
                self.swap_now = kr > kl                  # the more extended leg is the moving one
            swap = self.swap_now
        if swap:
            Pb = Pb[SWAP].copy(); Pb[:, 2] *= -1
        return Pb

    def _driver(self, Pb):
        if self.ex == "bird_dog":
            return max(ang3(Pb[12], Pb[13], Pb[14]), ang3(Pb[16], Pb[17], Pb[18]))
        return float(Pb[12, 1])                          # lower hip height above floor (m)

    def update(self, P_cam):
        assert self.ready, "call calibrate() first"
        Pb = self._orient(self._to_body(np.asarray(P_cam, float)))
        d = self._driver(Pb); self.buf.append(d)
        disp = d - self.baseline
        steady = len(self.buf) == self.win and (max(self.buf) - min(self.buf)) < (8.0 if self.ex == "bird_dog" else 0.015)
        far = disp > (60.0 if self.ex == "bird_dog" else 0.03)
        phase = "hold" if (far and steady) else ("moving" if (far or not steady) and abs(disp) > 5e-3 else "rest")
        out = dict(phase=phase, metrics=None, cues=[])
        if phase == "hold":
            out["metrics"] = frame_metrics(self.ex, Pb)
            out["cues"] = self.judge.step(out["metrics"])
        else:
            self.judge.ema.clear(); self.judge.state = {k: 0 for k in self.judge.state}
        return out
