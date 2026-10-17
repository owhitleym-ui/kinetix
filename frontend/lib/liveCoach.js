/**
 * Port of Data/Data-test-2/live_coach.py + angle helpers from generate_synthetic_lowerback.
 * MediaPipe 33 → NTU-25 → body frame → hold gate → StreamJudge.
 */

import { StreamJudge } from "./jointIntervals";

const SWAP = (() => {
  const s = Array.from({ length: 25 }, (_, i) => i);
  const pairs = [
    [4, 8],
    [5, 9],
    [6, 10],
    [7, 11],
    [12, 16],
    [13, 17],
    [14, 18],
    [15, 19],
    [21, 23],
    [22, 24],
  ];
  for (const [a, b] of pairs) {
    const t = s[a];
    s[a] = s[b];
    s[b] = t;
  }
  return s;
})();

const LEFT_FLOOR = [5, 6, 7, 13, 14, 15];
const RIGHT_FLOOR = [9, 10, 11, 17, 18, 19];
const QUADRUPED_FLOOR = [6, 10, 13, 17, 14, 18];

function mid(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function norm(v) {
  return Math.hypot(v[0], v[1], v[2]) || 1e-9;
}

function unit(v) {
  const n = norm(v);
  return [v[0] / n, v[1] / n, v[2] / n];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function ang3(a, b, c) {
  const v1 = sub(a, b);
  const v2 = sub(c, b);
  const cos = Math.max(
    -1,
    Math.min(1, dot(v1, v2) / (norm(v1) * norm(v2) + 1e-9))
  );
  return (Math.acos(cos) * 180) / Math.PI;
}

function elevBack(v) {
  return (Math.atan2(v[1], -v[0]) * 180) / Math.PI;
}

function lmXYZ(lm) {
  return [lm.x, lm.y, lm.z];
}

/** MediaPipe world landmarks (33) → NTU-like 25 joints. */
export function mediapipe33To25(landmarks) {
  if (!landmarks || landmarks.length < 33) return null;
  const lm = (i) => lmXYZ(landmarks[i]);
  const J = Array.from({ length: 25 }, () => [0, 0, 0]);
  J[0] = mid(lm(23), lm(24));
  J[20] = mid(lm(11), lm(12));
  J[1] = mid(J[0], J[20]);
  J[3] = mid(lm(7), lm(8));
  J[2] = add(J[20], scale(sub(J[3], J[20]), 0.45));
  J[4] = lm(11);
  J[5] = lm(13);
  J[6] = lm(15);
  J[7] = mid(lm(17), lm(19));
  J[8] = lm(12);
  J[9] = lm(14);
  J[10] = lm(16);
  J[11] = mid(lm(18), lm(20));
  J[12] = lm(23);
  J[13] = lm(25);
  J[14] = lm(27);
  J[15] = lm(31);
  J[16] = lm(24);
  J[17] = lm(26);
  J[18] = lm(28);
  J[19] = lm(32);
  J[21] = lm(19);
  J[22] = lm(21);
  J[23] = lm(20);
  J[24] = lm(22);
  return J;
}

/** Least-squares plane; returns { c, n, rms }. */
function fitFloor(points) {
  const nPts = points.length;
  const c = [0, 0, 0];
  for (const p of points) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  c[0] /= nPts;
  c[1] /= nPts;
  c[2] /= nPts;

  // Covariance
  let xx = 0,
    xy = 0,
    xz = 0,
    yy = 0,
    yz = 0,
    zz = 0;
  for (const p of points) {
    const dx = p[0] - c[0];
    const dy = p[1] - c[1];
    const dz = p[2] - c[2];
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }

  // Smallest eigenvector via inverse-power iteration on 3x3 covariance
  let v = unit(cross([1, 0, 0], [xx, xy, xz]));
  if (norm(v) < 0.1) v = [0, 0, 1];
  for (let i = 0; i < 12; i++) {
    const det =
      xx * (yy * zz - yz * yz) -
      xy * (xy * zz - xz * yz) +
      xz * (xy * yz - xz * yy);
    if (Math.abs(det) < 1e-12) break;
    const cx = yy * zz - yz * yz;
    const w0 =
      (cx * v[0] +
        (xz * yz - xy * zz) * v[1] +
        (xy * yz - xz * yy) * v[2]) /
      det;
    const w1 =
      ((xz * yz - xy * zz) * v[0] +
        (xx * zz - xz * xz) * v[1] +
        (xy * xz - xx * yz) * v[2]) /
      det;
    const w2 =
      ((xy * yz - xz * yy) * v[0] +
        (xy * xz - xx * yz) * v[1] +
        (xx * yy - xy * xy) * v[2]) /
      det;
    v = unit([w0, w1, w2]);
  }
  const n = v;

  let rms = 0;
  for (const p of points) {
    const r = sub(p, c);
    rms += Math.abs(dot(r, n));
  }
  rms /= Math.sqrt(nPts);
  return { c, n, rms };
}

function meanJoints(frames) {
  const n = frames.length;
  const mean = Array.from({ length: 25 }, () => [0, 0, 0]);
  for (const F of frames) {
    for (let j = 0; j < 25; j++) {
      mean[j][0] += F[j][0];
      mean[j][1] += F[j][1];
      mean[j][2] += F[j][2];
    }
  }
  for (let j = 0; j < 25; j++) {
    mean[j][0] /= n;
    mean[j][1] /= n;
    mean[j][2] /= n;
  }
  return mean;
}

function elevBackArr(v) {
  return elevBack(v);
}

function anglesBirdDog(P) {
  const B = P[0];
  const SS = P[20];
  const trunk = sub(SS, B);
  const Lt = norm(trunk);
  const trunkIncline = (Math.atan2(trunk[1], trunk[0]) * 180) / Math.PI;
  const legVsTrunk =
    elevBackArr(sub(P[13], P[12])) - elevBackArr(sub(B, SS));
  const v = sub(P[10], P[8]);
  const armFlex =
    (Math.acos(
      Math.max(-1, Math.min(1, -v[1] / (norm(v) + 1e-9)))
    ) *
      180) /
    Math.PI;
  const spineSag = ((B[1] + SS[1]) / 2 - P[1][1]) / Lt;
  const sr =
    (Math.atan2(P[8][1] - P[4][1], P[8][2] - P[4][2]) * 180) / Math.PI;
  const pr =
    (Math.atan2(P[16][1] - P[12][1], P[16][2] - P[12][2]) * 180) / Math.PI;
  const hv = sub(P[3], P[2]);
  const headVsTrunk =
    (Math.atan2(hv[1], hv[0]) * 180) / Math.PI - trunkIncline;
  return {
    trunk_incline_deg: trunkIncline,
    leg_vs_trunk_deg: legVsTrunk,
    moving_knee_deg: ang3(P[12], P[13], P[14]),
    support_knee_deg: ang3(P[16], P[17], P[18]),
    arm_flexion_deg: armFlex,
    spine_sag_ratio: spineSag,
    shoulder_roll_deg: sr,
    pelvis_roll_deg: pr,
    trunk_rotation_deg: sr - pr,
    pelvis_lateral_shift_m: P[0][2] - P[20][2],
    head_vs_trunk_deg: headVsTrunk,
  };
}

function anglesSidePlank(P) {
  const ss =
    (Math.atan2(P[8][2] - P[4][2], P[8][1] - P[4][1]) * 180) / Math.PI;
  const ps =
    (Math.atan2(P[16][2] - P[12][2], P[16][1] - P[12][1]) * 180) / Math.PI;
  const neckExt = sub(scale(P[2], 2), P[20]);
  return {
    hip_line_deg: ang3(P[4], P[12], P[13]),
    knee_flex_deg: ang3(P[12], P[13], P[14]),
    elbow_deg: ang3(P[4], P[5], P[6]),
    shoulder_stack_deg: ss,
    pelvis_stack_deg: ps,
    pelvic_rotation_deg: ps - ss,
    head_drop_deg: ang3(P[3], P[2], neckExt),
    hip_height_m: P[12][1],
    shoulder_height_m: P[4][1],
  };
}

/** Signed hip-line deviation: + pike, - sag (matches live_coach.hip_line_dev). */
function hipLineDev(P) {
  const S = P[4];
  const H = P[12];
  const K = P[13];
  const d = sub(K, S);
  const h = sub(H, S);
  const cross2 = d[0] * h[1] - d[1] * h[0];
  const sign = cross2 < 0 ? -1 : cross2 > 0 ? 1 : 0;
  return -sign * (180 - ang3(S, H, K));
}

function frameMetrics(exercise, P) {
  if (exercise === "bird_dog") return anglesBirdDog(P);
  const m = anglesSidePlank(P);
  m.hip_line_dev_deg = hipLineDev(P);
  return m;
}

function applySwap(Pb) {
  const out = SWAP.map((i) => [...Pb[i]]);
  for (let i = 0; i < 25; i++) out[i][2] *= -1;
  return out;
}

const HIGHLIGHT_BY_LABEL = {
  leg_too_high: ["left_hip", "left_knee", "left_ankle"],
  leg_too_low: ["left_hip", "left_knee", "left_ankle"],
  leg_not_extended: ["left_hip", "left_knee", "left_ankle"],
  support_knee_too_closed: ["right_hip", "right_knee", "right_ankle"],
  support_knee_too_open: ["right_hip", "right_knee", "right_ankle"],
  arm_too_low: ["right_shoulder", "right_elbow", "right_wrist"],
  arm_too_high: ["right_shoulder", "right_elbow", "right_wrist"],
  lumbar_hyperextension: ["left_shoulder", "right_shoulder", "left_hip", "right_hip"],
  lumbar_rounding: ["left_shoulder", "right_shoulder", "left_hip", "right_hip"],
  trunk_rotation: ["left_shoulder", "right_shoulder", "left_hip", "right_hip"],
  lateral_hip_shift: ["left_hip", "right_hip"],
  head_lifting: ["nose"],
  head_dropped: ["nose"],
  hip_sag: ["left_hip", "right_hip"],
  hip_pike: ["left_hip", "right_hip"],
  knees_too_closed: ["left_knee", "right_knee"],
  knees_too_open: ["left_knee", "right_knee"],
  shoulder_collapse: ["left_shoulder", "left_elbow", "left_wrist"],
  elbow_too_far: ["left_shoulder", "left_elbow"],
  pelvic_rotation: ["left_hip", "right_hip"],
  head_tilt: ["nose"],
};

export class LiveCoach {
  constructor(exercise, fps = 30, holdWindowS = 1.0) {
    this.ex = exercise;
    this.fps = fps;
    this.win = Math.max(3, Math.round(holdWindowS * fps));
    this.buf = [];
    this.judge = new StreamJudge(exercise);
    this.ready = false;
    this.swapSession = false;
    this.swapNow = false;
    this.baseline = null;
    this.R = null;
    this.origin = null;
    this.calibBuffer = [];
    this.CALIB_N = Math.max(12, Math.round(1.2 * fps));
  }

  reset() {
    this.buf = [];
    this.judge.reset();
    this.ready = false;
    this.swapSession = false;
    this.swapNow = false;
    this.baseline = null;
    this.R = null;
    this.origin = null;
    this.calibBuffer = [];
  }

  setExercise(exercise) {
    if (exercise === this.ex) return;
    this.ex = exercise;
    this.judge = new StreamJudge(exercise);
    this.reset();
  }

  _toBody(P) {
    return P.map((p) => {
      const d = sub(p, this.origin);
      return [dot(this.R[0], d), dot(this.R[1], d), dot(this.R[2], d)];
    });
  }

  _orient(Pb, calib = false) {
    let swap;
    if (this.ex === "side_plank") {
      swap = this.swapSession;
    } else {
      const kl = ang3(Pb[12], Pb[13], Pb[14]);
      const kr = ang3(Pb[16], Pb[17], Pb[18]);
      if (!calib && Math.abs(kl - kr) > 20) {
        this.swapNow = kr > kl;
      }
      swap = this.swapNow;
    }
    return swap ? applySwap(Pb) : Pb;
  }

  _driver(Pb) {
    if (this.ex === "bird_dog") {
      return Math.max(
        ang3(Pb[12], Pb[13], Pb[14]),
        ang3(Pb[16], Pb[17], Pb[18])
      );
    }
    return Pb[12][1];
  }

  calibrate(frames) {
    if (!frames?.length) return false;
    const mean = meanJoints(frames);
    let c;
    let n;
    if (this.ex === "bird_dog") {
      const floorPts = QUADRUPED_FLOOR.map((i) => mean[i]);
      const fit = fitFloor(floorPts);
      c = fit.c;
      n = fit.n;
    } else {
      const fl = fitFloor(LEFT_FLOOR.map((i) => mean[i]));
      const fr = fitFloor(RIGHT_FLOOR.map((i) => mean[i]));
      this.swapSession = fr.rms < fl.rms;
      c = this.swapSession ? fr.c : fl.c;
      n = this.swapSession ? fr.n : fl.n;
    }
    // Up toward body
    let bodyMean = [0, 0, 0];
    for (const p of mean) {
      bodyMean = add(bodyMean, p);
    }
    bodyMean = scale(bodyMean, 1 / 25);
    if (dot(sub(bodyMean, c), n) < 0) n = scale(n, -1);

    const v = sub(mean[20], mean[0]);
    let x = unit(sub(v, scale(n, dot(v, n))));
    let z = unit(cross(x, n));
    // Re-orthogonalize: R rows = [x, n(up), z]
    n = unit(n);
    x = unit(x);
    z = unit(cross(x, n));
    n = unit(cross(z, x));

    this.R = [x, n, z];
    this.origin = c;

    const drivers = frames.map((p) =>
      this._driver(this._orient(this._toBody(p), true))
    );
    drivers.sort((a, b) => a - b);
    this.baseline = drivers[Math.floor(drivers.length / 2)];
    this.ready = true;
    this.buf = [];
    this.judge.reset();
    return true;
  }

  /**
   * @param {Array} landmarks33 - poseWorldLandmarks preferred
   */
  step(landmarks33) {
    const P = mediapipe33To25(landmarks33);
    if (!P) {
      return {
        phase: "rest",
        cues: [],
        metrics: null,
        calibrated: this.ready,
        highlightJoints: [],
      };
    }

    if (!this.ready) {
      this.calibBuffer.push(P);
      if (this.calibBuffer.length >= this.CALIB_N) {
        this.calibrate(this.calibBuffer);
        this.calibBuffer = [];
      }
      return {
        phase: "rest",
        cues: [],
        metrics: null,
        calibrated: false,
        highlightJoints: [],
      };
    }

    const Pb = this._orient(this._toBody(P));
    const d = this._driver(Pb);
    this.buf.push(d);
    if (this.buf.length > this.win) this.buf.shift();

    const disp = d - this.baseline;
    const steady =
      this.buf.length === this.win &&
      Math.max(...this.buf) - Math.min(...this.buf) <
        (this.ex === "bird_dog" ? 8.0 : 0.015);
    const far = disp > (this.ex === "bird_dog" ? 60.0 : 0.03);
    let phase = "rest";
    if (far && steady) phase = "hold";
    else if ((far || !steady) && Math.abs(disp) > 5e-3) phase = "moving";

    if (phase !== "hold") {
      this.judge.reset();
      return {
        phase,
        cues: [],
        metrics: null,
        calibrated: true,
        highlightJoints: [],
      };
    }

    const metrics = frameMetrics(this.ex, Pb);
    const cues = this.judge.step(metrics);
    const top = cues[0];
    const highlightJoints = top
      ? HIGHLIGHT_BY_LABEL[top.label] || []
      : [];

    return {
      phase,
      cues,
      metrics,
      calibrated: true,
      highlightJoints,
    };
  }
}

export const SUPPORTED_EXERCISES = ["bird_dog", "side_plank"];
