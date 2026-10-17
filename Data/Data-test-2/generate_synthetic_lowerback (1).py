"""
Synthetic 3D skeleton generator: Bird dog + Modified (McGill) side plank
------------------------------------------------------------------------
Produces a pickle in an EC3D-like layout: flat (N, 3, 25) coordinate array plus labels.

*** THIS IS SYNTHETIC DATA, built from parametric rules. ***
Good for: pipeline development, plumbing a model, demos, rule-threshold sanity checks.
NOT good for: clinical validation or proving a model generalises to real people.

Coordinate frame (metres): x = toward head, y = up (floor y=0), z = person's right side (+z).
Joint layout: NTU RGB+D 25-joint order (assumed; verify against the EC3D joint order).
"""
import math, pickle, argparse
import numpy as np

FPS = 10
JOINTS = ["SpineBase", "SpineMid", "Neck", "Head",
          "ShoulderL", "ElbowL", "WristL", "HandL",
          "ShoulderR", "ElbowR", "WristR", "HandR",
          "HipL", "KneeL", "AnkleL", "FootL",
          "HipR", "KneeR", "AnkleR", "FootR",
          "SpineShoulder", "HandTipL", "ThumbL", "HandTipR", "ThumbR"]
PARENT = {1: 0, 20: 1, 2: 20, 3: 2, 4: 20, 5: 4, 6: 5, 7: 6, 21: 7, 22: 7,
          8: 20, 9: 8, 10: 9, 11: 10, 23: 11, 24: 11,
          12: 0, 13: 12, 14: 13, 15: 14, 16: 0, 17: 16, 18: 17, 19: 18}
ORDER = [1, 20, 2, 3, 4, 5, 6, 7, 21, 22, 8, 9, 10, 11, 23, 24, 12, 13, 14, 15, 16, 17, 18, 19]
EDGES = [(p, c) for c, p in PARENT.items()]

EXERCISES = {
    "bird_dog": dict(exercise_id=7, name="Bird dog", stage=3,
                     labels=["correct", "leg_too_high", "lumbar_hyperextension",
                             "trunk_rotation", "lateral_hip_shift", "head_lifting"]),
    "side_plank": dict(exercise_id=5, name="Modified side plank", stage=2,
                       labels=["correct", "hip_sag", "pelvic_rotation",
                               "shoulder_collapse", "head_tilt"]),
}


# ----------------------------------------------------------------- helpers
def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def rotx(pts, center, ang):
    """Rotate pts (T,3) about an x-parallel axis through center, by ang (T,) radians."""
    d = pts - center
    c, s = np.cos(ang), np.sin(ang)
    y = d[:, 1] * c - d[:, 2] * s
    z = d[:, 1] * s + d[:, 2] * c
    return np.stack([d[:, 0], y, z], 1) + center


def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-9)


def ang3(a, b, c):
    v1, v2 = a - b, c - b
    cos = (v1 * v2).sum(1) / (np.linalg.norm(v1, axis=1) * np.linalg.norm(v2, axis=1) + 1e-9)
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def project_bones(P, lengths):
    """Rigid-bone projection from root (SpineBase) outward; keeps limb lengths constant."""
    out = P.copy()
    for j in ORDER:
        v = P[:, j] - out[:, PARENT[j]]
        out[:, j] = out[:, PARENT[j]] + lengths[j] * unit(v)
    return out


def bone_lengths(P):
    return {j: float(np.median(np.linalg.norm(P[:, j] - P[:, PARENT[j]], axis=1))) for j in ORDER}


def make_subject(rng):
    k = float(np.clip(rng.normal(1.0, 0.07), 0.82, 1.18))
    j = lambda: float(rng.uniform(0.96, 1.04))
    return dict(k=k, trunk=0.50 * k * j(), ua=0.28 * k * j(), fa=0.25 * k * j(), ha=0.08 * k,
                thigh=0.44 * k * j(), shin=0.42 * k * j(), foot=0.12 * k, neck=0.10 * k,
                head=0.12 * k, hw=0.09 * k * j(), sw=0.19 * k * j())


def make_timing(rng, hold_range, reps=2):
    segs = []
    for _ in range(reps):
        segs.append(dict(pre=rng.uniform(0.8, 1.5), up=rng.uniform(1.5, 2.5),
                         hold=rng.uniform(*hold_range), down=rng.uniform(1.5, 2.5)))
    return dict(segs=segs, tail=1.0)


def profile(timing):
    s, ph = [], []
    for sg in timing["segs"]:
        n = lambda t: max(1, int(round(t * FPS)))
        s += [np.zeros(n(sg["pre"])), smoothstep(np.linspace(0, 1, n(sg["up"]))),
              np.ones(n(sg["hold"])), smoothstep(np.linspace(1, 0, n(sg["down"])))]
        ph += [np.zeros(n(sg["pre"])), np.ones(n(sg["up"])), 2 * np.ones(n(sg["hold"])),
               3 * np.ones(n(sg["down"]))]
    s.append(np.zeros(max(1, int(timing["tail"] * FPS))))
    ph.append(np.zeros(len(s[-1])))
    return np.concatenate(s), np.concatenate(ph).astype(np.int8)


# ----------------------------------------------------------------- bird dog
def build_bird_dog(sub, s, comp, sev):
    T = len(s); P = np.zeros((T, 25, 3)); w = s * sev
    k, Lt = sub["k"], sub["trunk"]
    ua, fa, ha, th, sh, ft = sub["ua"], sub["fa"], sub["ha"], sub["thigh"], sub["shin"], sub["foot"]
    Hy, SSy = th, ua + fa
    alpha = math.asin(np.clip((SSy - Hy) / Lt, -0.5, 0.5))
    B = np.array([0, Hy, 0.0]); tdir = np.array([math.cos(alpha), math.sin(alpha), 0])
    SS = B + Lt * tdir
    P[:, 0], P[:, 20], P[:, 1] = B, SS, (B + SS) / 2

    gaze = alpha - 0.17 + (np.radians(35) * w if comp == "head_lifting" else 0)
    dn = np.stack([np.cos(gaze) * np.ones(T), np.sin(gaze) * np.ones(T), np.zeros(T)], 1)
    P[:, 2] = SS + sub["neck"] * dn
    P[:, 3] = P[:, 2] + sub["head"] * dn

    P[:, 4] = SS + [0, 0, -sub["sw"]]; P[:, 8] = SS + [0, 0, sub["sw"]]
    # support arm (left): vertical to floor
    P[:, 5] = P[:, 4] + [0, -ua, 0]; P[:, 6] = P[:, 5] + [0, -fa, 0]
    P[:, 7] = P[:, 6] + [ha, 0, 0]; P[:, 21] = P[:, 7] + [0.6 * ha, 0, 0]
    P[:, 22] = P[:, 7] + [0.4 * ha, 0, -0.03 * k]
    # moving arm (right): down -> trunk-line height
    psi = s * (math.pi / 2 + alpha)
    dA = np.stack([np.sin(psi), -np.cos(psi), np.zeros(T)], 1)
    P[:, 9] = P[:, 8] + ua * dA; P[:, 10] = P[:, 9] + fa * dA; P[:, 11] = P[:, 10] + ha * dA
    P[:, 23] = P[:, 11] + 0.6 * ha * dA; P[:, 24] = P[:, 11] + 0.4 * ha * dA + [0, 0, 0.03 * k]

    P[:, 12] = B + [0, 0, -sub["hw"]]; P[:, 16] = B + [0, 0, sub["hw"]]
    # support leg (right): thigh vertical, shin on floor
    P[:, 17] = P[:, 16] + [0, -th, 0]; P[:, 18] = P[:, 17] + [-sh, 0, 0]; P[:, 19] = P[:, 18] + [-ft, 0, 0]
    # moving leg (left)
    phi_end = math.pi / 2 - alpha + (np.radians(26) * sev if comp == "leg_too_high" else 0)
    phi = s * phi_end
    chi = math.pi / 2 + s * (phi_end - math.pi / 2)
    dT = np.stack([-np.sin(phi), -np.cos(phi), np.zeros(T)], 1)
    dS = np.stack([-np.sin(chi), -np.cos(chi), np.zeros(T)], 1)
    dF = np.stack([-np.sin(chi - 1.0 * s), -np.cos(chi - 1.0 * s), np.zeros(T)], 1)
    P[:, 13] = P[:, 12] + th * dT; P[:, 14] = P[:, 13] + sh * dS; P[:, 15] = P[:, 14] + ft * dF
    return P, w


def comp_bird_dog(P, sub, comp, w):
    k = sub["k"]
    if comp == "lumbar_hyperextension":       # belly sags, pelvis tips forward
        P[:, 1, 1] -= 0.06 * k * w; P[:, 0, 1] += 0.02 * k * w; P[:, 20, 1] -= 0.02 * k * w
    elif comp == "trunk_rotation":             # shoulders roll relative to pelvis
        for j in (4, 8):
            P[:, j] = rotx(P[:, j], P[:, 20], np.radians(20) * w)
        for j in (12, 16):
            P[:, j] = rotx(P[:, j], P[:, 0], np.radians(-6) * w)
    elif comp == "lateral_hip_shift":          # pelvis + legs slide toward support side
        for j in (0, 12, 13, 14, 15, 16, 17, 18, 19):
            P[:, j, 2] += 0.07 * k * w
    return P


# ---------------------------------------------------------------- side plank
def build_side_plank(sub, s, comp, sev):
    T = len(s); P = np.zeros((T, 25, 3)); w = s * sev
    k, Lt = sub["k"], sub["trunk"]
    ua, fa, ha, th, sh, ft = sub["ua"], sub["fa"], sub["ha"], sub["thigh"], sub["shin"], sub["foot"]
    ey = 0.02 * k                       # elbow height
    Sy = ey + ua                        # lower shoulder height
    Ky = 0.11 * k                       # lower knee contact height
    h_line = Sy - (Sy - Ky) * Lt / (Lt + th)
    h = 0.06 * k + s * (h_line - 0.06 * k)
    if comp == "hip_sag":
        h = h - 0.075 * k * w
    sin_t = np.clip((Sy - h) / Lt, -0.9, 0.9); cos_t = np.sqrt(1 - sin_t ** 2)
    Sl = np.array([0, Sy, 0.0])
    Hl = np.stack([-Lt * cos_t, h, np.zeros(T)], 1)
    pw = 2 * sub["hw"]
    P[:, 4] = Sl; P[:, 8] = Sl + [0, 2 * sub["sw"], 0]; P[:, 20] = Sl + [0, sub["sw"], 0]
    P[:, 12] = Hl; P[:, 16] = Hl + [0, pw, 0]; P[:, 0] = (P[:, 12] + P[:, 16]) / 2
    P[:, 1] = (P[:, 0] + P[:, 20]) / 2
    td = unit(P[:, 20] - P[:, 0])
    P[:, 2] = P[:, 20] + sub["neck"] * td; P[:, 3] = P[:, 2] + sub["head"] * td
    # supporting (left) arm: elbow on floor under shoulder, forearm forward (+z)
    P[:, 5] = [0, ey, 0]; P[:, 6] = [0, ey, fa]; P[:, 7] = [0, ey, fa + ha]
    P[:, 21] = [0, ey, fa + ha + 0.05 * k]; P[:, 22] = [0.02 * k, ey, fa + ha + 0.02 * k]
    # top (right) arm: hand rests near top hip
    wr = P[:, 16] + [0, 0.03 * k, 0.07 * k]
    P[:, 10] = wr
    P[:, 9] = (P[:, 8] + wr) / 2 + [0, 0, 0.08 * k]
    P[:, 11] = wr + [0, 0, ha]; P[:, 23] = P[:, 11] + [0, 0, 0.05 * k]; P[:, 24] = P[:, 11] + [0.02 * k, 0, 0.02 * k]
    # legs: thigh in line with trunk, knees bent ~90 with shins behind (-z)
    Kx = Hl[:, 0] - np.sqrt(np.maximum(th ** 2 - (h - Ky) ** 2, 1e-6))
    P[:, 13] = np.stack([Kx, Ky * np.ones(T), np.zeros(T)], 1)
    kyt = Ky + 0.14 * k
    Kxt = P[:, 16, 0] - np.sqrt(np.maximum(th ** 2 - (P[:, 16, 1] - kyt) ** 2, 1e-6))
    P[:, 17] = np.stack([Kxt, kyt * np.ones(T), 0.02 * k * np.ones(T)], 1)
    dS = unit([0, -0.05, -1.0])
    P[:, 14] = P[:, 13] + sh * dS; P[:, 18] = P[:, 17] + sh * dS
    dF = unit([-0.5, -0.1, -0.8])
    P[:, 15] = P[:, 14] + ft * dF; P[:, 19] = P[:, 18] + ft * dF
    return P, w


def comp_side_plank(P, sub, comp, w):
    k = sub["k"]
    if comp == "pelvic_rotation":
        for j in (12, 16):
            P[:, j] = rotx(P[:, j], P[:, 0], np.radians(25) * w)
    elif comp == "shoulder_collapse":
        d = np.outer(w, [0, -0.04 * k, 0.08 * k])
        for j in (4, 8, 20, 2, 3):
            P[:, j] += d
    elif comp == "head_tilt":
        P[:, 3, 1] -= 0.07 * k * w; P[:, 2, 1] -= 0.02 * k * w
    return P


# --------------------------------------------------------------- noise / angles
def add_noise(P, rng, k):
    T = P.shape[0]; t = np.arange(T) / FPS
    P = P + rng.normal(0, 0.003, P.shape)
    amp = rng.uniform(0, 0.004 * k, (1, 25, 3)); f = rng.uniform(0.15, 0.5, (1, 25, 3)); ph = rng.uniform(0, 6.28, (1, 25, 3))
    return P + amp * np.sin(2 * np.pi * f * t[:, None, None] + ph)


def elev_back(v):
    return np.degrees(np.arctan2(v[:, 1], -v[:, 0]))


def angles_bird_dog(P):
    B, SS = P[:, 0], P[:, 20]
    trunk = SS - B
    a = {}
    a["trunk_incline_deg"] = np.degrees(np.arctan2(trunk[:, 1], trunk[:, 0]))
    a["leg_vs_trunk_deg"] = elev_back(P[:, 13] - P[:, 12]) - elev_back(B - SS)
    a["moving_knee_deg"] = ang3(P[:, 12], P[:, 13], P[:, 14])
    a["support_knee_deg"] = ang3(P[:, 16], P[:, 17], P[:, 18])
    v = P[:, 10] - P[:, 8]
    a["arm_flexion_deg"] = np.degrees(np.arccos(np.clip(-v[:, 1] / (np.linalg.norm(v, axis=1) + 1e-9), -1, 1)))
    Lt = np.linalg.norm(trunk, axis=1)
    a["spine_sag_ratio"] = (((B[:, 1] + SS[:, 1]) / 2) - P[:, 1, 1]) / Lt
    sr = np.degrees(np.arctan2(P[:, 8, 1] - P[:, 4, 1], P[:, 8, 2] - P[:, 4, 2]))
    pr = np.degrees(np.arctan2(P[:, 16, 1] - P[:, 12, 1], P[:, 16, 2] - P[:, 12, 2]))
    a["shoulder_roll_deg"], a["pelvis_roll_deg"], a["trunk_rotation_deg"] = sr, pr, sr - pr
    a["pelvis_lateral_shift_m"] = P[:, 0, 2] - P[:, 20, 2]
    hv = P[:, 3] - P[:, 2]
    a["head_vs_trunk_deg"] = np.degrees(np.arctan2(hv[:, 1], hv[:, 0])) - a["trunk_incline_deg"]
    return a


def angles_side_plank(P):
    a = {}
    a["hip_line_deg"] = ang3(P[:, 4], P[:, 12], P[:, 13])
    a["knee_flex_deg"] = ang3(P[:, 12], P[:, 13], P[:, 14])
    a["elbow_deg"] = ang3(P[:, 4], P[:, 5], P[:, 6])
    ss = np.degrees(np.arctan2(P[:, 8, 2] - P[:, 4, 2], P[:, 8, 1] - P[:, 4, 1]))
    ps = np.degrees(np.arctan2(P[:, 16, 2] - P[:, 12, 2], P[:, 16, 1] - P[:, 12, 1]))
    a["shoulder_stack_deg"], a["pelvis_stack_deg"], a["pelvic_rotation_deg"] = ss, ps, ps - ss
    a["head_drop_deg"] = ang3(P[:, 3], P[:, 2], 2 * P[:, 2] - P[:, 20])  # 0 = head continues spine line
    a["hip_height_m"] = P[:, 12, 1]
    a["shoulder_height_m"] = P[:, 4, 1]
    return a


ANGLE_FUNCS = {"bird_dog": angles_bird_dog, "side_plank": angles_side_plank}
BUILD = {"bird_dog": (build_bird_dog, comp_bird_dog, (5.0, 8.0)),
         "side_plank": (build_side_plank, comp_side_plank, (5.0, 15.0))}


# ------------------------------------------------------------------- main
def generate(n_subjects=8, n_takes=2, seed=0):
    rng = np.random.default_rng(seed)
    coords, targets, phases, weights, seq_meta = [], [], [], [], []
    ang_chunks = []
    all_angle_names = sorted({n for f in ANGLE_FUNCS for n in
                              ANGLE_FUNCS[f](np.zeros((2, 25, 3)) + np.random.rand(2, 25, 3)).keys()})
    cursor, seq_id = 0, 0
    for ex_key, ex in EXERCISES.items():
        builder, compfn, hold_range = BUILD[ex_key]
        for subj in range(n_subjects):
            sub = make_subject(rng)
            for take in range(n_takes):
                timing = make_timing(rng, hold_range)
                s, phase = profile(timing)
                # reference rigid bone lengths from the clean, correct sequence
                Pc, wc = builder(sub, s, "correct", 1.0)
                lens = bone_lengths(Pc)
                clean_correct = project_bones(Pc, lens)
                correct_id = None
                for label in ex["labels"]:
                    sev = 1.0 if label == "correct" else float(rng.uniform(0.7, 1.3))
                    P, w = builder(sub, s, label, sev)
                    if label != "correct":
                        P = compfn(P, sub, label, w)
                    P = project_bones(P, lens)
                    Pn = add_noise(P, rng, sub["k"])
                    T = len(s)
                    ang = ANGLE_FUNCS[ex_key](Pn)
                    block = {n: (ang[n].astype(np.float32) if n in ang else np.full(T, np.nan, np.float32))
                             for n in all_angle_names}
                    ang_chunks.append(block)
                    coords.append(Pn.transpose(0, 2, 1).astype(np.float32))
                    targets.append(clean_correct.transpose(0, 2, 1).astype(np.float32))
                    phases.append(phase)
                    weights.append((w if label != "correct" else np.zeros(T)).astype(np.float32))
                    if label == "correct":
                        correct_id = seq_id
                    seq_meta.append(dict(seq_id=seq_id, exercise_key=ex_key, exercise_id=ex["exercise_id"],
                                         exercise_name=ex["name"], stage=ex["stage"], subject_id=f"{ex_key}_s{subj}",
                                         take=take, label=label, label_id=ex["labels"].index(label),
                                         is_correct=(label == "correct"), severity=sev, n_frames=T,
                                         start=cursor, end=cursor + T, paired_correct_seq_id=correct_id,
                                         body_scale=sub["k"]))
                    cursor += T; seq_id += 1
    data = dict(
        meta=dict(description="SYNTHETIC lower-back PT skeleton data (bird dog, modified side plank).",
                  synthetic=True, fps=FPS, units="metres",
                  coordinate_frame="x=toward head, y=up (floor y=0), z=person's right side",
                  coords_shape="(N_frames, 3[xyz], 25[joints])  # same axis order as EC3D data_3D (3,25)",
                  joint_names=JOINTS, joint_layout="NTU RGB+D 25-joint order (assumed)", edges=EDGES,
                  exercises=EXERCISES, angle_names=all_angle_names,
                  phase_codes={0: "rest", 1: "lift", 2: "hold", 3: "return"},
                  notes=["target_coords = clean, noise-free CORRECT version with identical timing/subject; "
                         "use as correction-branch target.",
                         "comp_weight = how strongly the compensation is expressed at each frame (0 for correct).",
                         "angles contain NaN where a metric does not apply to that exercise."]),
        coords=np.concatenate(coords), target_coords=np.concatenate(targets),
        phase=np.concatenate(phases), comp_weight=np.concatenate(weights),
        angles={n: np.concatenate([c[n] for c in ang_chunks]) for n in all_angle_names},
        sequences=seq_meta)
    return data


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--subjects", type=int, default=8)
    ap.add_argument("--takes", type=int, default=2)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default="synthetic_lowerback_3D.pickle")
    a = ap.parse_args()
    d = generate(a.subjects, a.takes, a.seed)
    with open(a.out, "wb") as f:
        pickle.dump(d, f, protocol=4)
    print("frames:", d["coords"].shape, "sequences:", len(d["sequences"]))
