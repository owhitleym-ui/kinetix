// Rule-check exercises: (1) web/rules.js measures the same values as training/angle_rules.py on the same reps,
// (2) replaying physiotherapist-approved (score >= 90) MobiPhysio videos through the live pipeline the page runs
// (SetupGate -> RepSegmenter -> validateRep -> rule checks) gets past setup, counts their reps and lets most pass.
//   node tests/rules_test.mjs        (fixtures come from python training/clinical_rules.py)
import { existsSync, readFileSync } from "node:fs";
import { RepSegmenter } from "../web/features.js";
import { imgSignal, judgeRules, ruleValues } from "../web/rules.js";
import { RULES, SetupGate, framing, validateRep } from "../web/session.js";

const EXS = ["shoulder_abduction_full", "shoulder_adduction", "shoulder_external_rotation", "shoulder_internal_rotation", "arm_circles"];
let worst = 0, verdictMismatch = 0, compared = 0, failed = false;
for (const ex of EXS) {
  const fx = new URL(`./data/rules_${ex}.json`, import.meta.url);
  if (!existsSync(fx)) { console.log(`${ex}: no fixture (run python training/clinical_rules.py)`); continue; }
  const model = JSON.parse(readFileSync(new URL(`../web/models/rules_${ex}.json`, import.meta.url)));
  const { videos } = JSON.parse(readFileSync(fx));
  let pyReps = 0, liveReps = 0, pass = 0, judged = 0, readyVideos = 0;
  for (const v of videos) {
    const frames = v.world.map((w, i) => {
      const P = w; P.img = v.img[i]; P.aspect = v.aspect; P.t = (i * v.stride * 1000) / 30; P.ok = framing(P.img).ok;
      return P;
    });
    // (1) same values as Python on Python's rep spans
    for (const r of v.reps) {
      const vals = ruleValues(model, frames.slice(r.span[0], r.span[1]));
      for (const [k, py] of Object.entries(r.values)) worst = Math.max(worst, Math.abs(vals[k] - py) / Math.max(1, Math.abs(py)));
      verdictMismatch += judgeRules(model, vals).label !== r.verdict; compared++;
    }
    // (2) the setup step (whole body in frame, facing the camera, start position, still) must let the session start.
    // These clips start mid-exercise, so simulate the user holding still for 2 s in the start position: the most
    // rest-like frame inside the detected reps (a clip can start mid-rep, so not necessarily the first one).
    const inReps = v.reps.flatMap((r) => Array.from({ length: r.span[1] - r.span[0] }, (_, i) => r.span[0] + i));
    const rest = (i) => imgSignal(model.primary, frames[i]) * (model.segmenter.restIs === "min" ? 1 : -1);
    const restIdx = inReps.reduce((best, i) => (rest(i) < rest(best) ? i : best), inReps[0]);
    const gate = new SetupGate(RULES[ex]), facing = [];
    const hold = Array.from({ length: Math.round(60 / v.stride) }, (_, i) => Object.assign([...frames[restIdx]],
      { img: frames[restIdx].img, aspect: v.aspect, ok: frames[restIdx].ok, t: (i * v.stride * 1000) / 30 }));
    const ready = hold.some((P) => {
      facing.push(Math.atan2(Math.abs(P[23][2] - P[24][2]), Math.abs(P[23][0] - P[24][0])) * 180 / Math.PI);
      return gate.push(P, [...facing].sort((a, b) => a - b)[facing.length >> 1]).ready;
    });
    if (ready) readyVideos++; else console.log(`  (${v.video}: setup didn't reach "Go" in its held frame)`);
    // (3) live pipeline at this video's frame rate
    const cfg = { ...model.segmenter };
    for (const k of ["minFrames", "maxFrames", "pad", "calibFrames", "history"]) cfg[k] = Math.max(1, Math.round(cfg[k] / v.stride));
    const seg = new RepSegmenter(cfg);
    for (const P of frames) {
      const rep = seg.push(P);
      if (!rep || !validateRep(rep, seg, RULES[ex]).ok) continue;
      liveReps++;
      judged++; pass += judgeRules(model, ruleValues(model, rep)).label === "CORRECT";
    }
    pyReps += v.reps.length;
  }
  console.log(`${ex.padEnd(27)} ${videos.length} good videos | reps: Python ${pyReps}, live pipeline ${liveReps} | ` +
    `live reps passing every check ${Math.round((100 * pass) / Math.max(1, judged))}%`);
  if (liveReps < 0.7 * pyReps) { console.error(`  live pipeline counted too few reps`); failed = true; }
  if (readyVideos < videos.length - 1) { console.error(`  setup reached "Go" in only ${readyVideos}/${videos.length} videos`); failed = true; }
}
console.log(`${compared} reps compared, max relative |JS - Python| = ${worst.toExponential(2)}, verdict mismatches ${verdictMismatch}`);
if (worst > 1e-4 || verdictMismatch) { console.error("MISMATCH"); failed = true; }
if (failed) process.exit(1);
console.log("rules OK");
