// Replay held-out people through the exact live pipeline the website runs:
// frame-by-frame RepSegmenter -> validateRep -> early model (first reps) / calibrated model -> decide(),
// with models trained without that person. Every counted rep gets a verdict.
//   node tests/sim_test.mjs
import { readFileSync, readdirSync } from "node:fs";
import { Calibrator, RepSegmenter, classify, decide, repFeatures } from "../web/features.js";
import { RULES, validateRep } from "../web/session.js";

const dir = new URL("./data/", import.meta.url);
const people = [...new Set(readdirSync(dir).filter((f) => f.startsWith("seq_")).map((f) => f.split("_")[1]))].sort();
const iou = (a, b) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])) / (Math.max(a[1], b[1]) - Math.min(a[0], b[0]));
const pct = (a, b) => `${((100 * a) / Math.max(b, 1)).toFixed(0)}%`;

function verdict(model, cal, frames) {
  const x = repFeatures(frames, model.feature_set);
  const out = cal.ready ? decide(model, classify(model, frames, cal.center(), x)) : decide(model.early, classify(model.early, frames));
  cal.add(x);
  return out.label;
}

for (const ex of ["squat", "arm_abduction", "shoulder_extension"]) {
  const rejected = {}, live = [], perfect = [];
  let annotated = 0, found = 0, extra = 0;
  for (const person of people) {
    const model = JSON.parse(readFileSync(new URL(`holdout_${person}_${ex}.json`, dir)));
    const seqs = JSON.parse(readFileSync(new URL(`seq_${person}_${ex}.json`, dir)));
    for (const seq of Object.values(seqs)) {
      const cal = new Calibrator(model.calibration), detected = [];
      let seg = { cfg: model.segmenter };
      const judge = (rep) => {
        const v = validateRep(rep, seg, RULES[ex]);          // same "complete, deliberate rep" rules as the page
        if (!v.ok) { rejected[v.reason] = (rejected[v.reason] || 0) + 1; return; }
        detected.push({ span: [rep[0].idx, rep[rep.length - 1].idx + 1], label: verdict(model, cal, rep) });
      };
      seq.frames.forEach((P, i) => { P.idx = seq.offset + i; P.t = (i * 1000) / 30; });
      if (model.segmenter.mode === "tempo") {
        const w = Math.round((model.segmenter.window * 30) / 1000);   // user moves on the cue
        for (const r of seq.reps) judge(seq.frames.slice(Math.max(0, r.a - seq.offset - 3), r.a - seq.offset - 3 + w));
      } else {
        seg = new RepSegmenter(model.segmenter);
        seq.frames.forEach((P) => { const rep = seg.push(P); if (rep) judge(rep); });
      }
      const used = new Set();
      for (const r of seq.reps) {
        annotated++;
        let best = -1, bestIou = 0.3;
        detected.forEach((d, j) => { const v = iou(d.span, [r.a, r.b]); if (!used.has(j) && v > bestIou) { best = j; bestIou = v; } });
        if (best < 0) continue;
        used.add(best); found++;
        live.push([r.label, detected[best].label]);
      }
      extra += detected.length - used.size;
      const oc = new Calibrator(model.calibration);   // same with perfect (annotated) rep boundaries
      for (const r of seq.reps) perfect.push([r.label, verdict(model, oc, seq.frames.slice(r.a - seq.offset, r.b - seq.offset))]);
    }
  }
  const sum = (rows) => {
    const good = rows.filter(([t]) => t === "CORRECT"), bad = rows.filter(([t]) => t !== "CORRECT");
    return `good left alone ${pct(good.filter(([, p]) => p === "CORRECT").length, good.length)}, ` +
      `mistakes caught ${pct(bad.filter(([, p]) => p !== "CORRECT").length, bad.length)}, ` +
      `named right ${pct(bad.filter(([t, p]) => p === t).length, bad.length)}`;
  };
  console.log(`${ex.padEnd(19)} ${annotated} reps | counted ${pct(found, annotated)}, ${extra} extra | every rep judged: ${sum(live)}`);
  console.log(`${"".padEnd(19)} with perfect rep boundaries: ${sum(perfect)} | not counted: ${JSON.stringify(rejected)}`);
}
