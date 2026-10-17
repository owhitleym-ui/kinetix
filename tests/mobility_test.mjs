// How much do the mobility settings (Slight / Moderate limits) relax things? Replays held-out people through the live pipeline
// (rep detection -> validation -> early / calibrated model -> decide) with no, slight and moderate mobility limits.
//   node tests/mobility_test.mjs        (needs tests/data from a training run on the full data)
import { readFileSync, readdirSync } from "node:fs";
import { Calibrator, RepSegmenter, classify, decide, repFeatures } from "../web/features.js";
import { MOBILITY, rulesFor, validateRep } from "../web/session.js";

const dir = new URL("./data/", import.meta.url);
const people = [...new Set(readdirSync(dir).filter((f) => f.startsWith("seq_")).map((f) => f.split("_")[1]))].sort();
const iou = (a, b) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])) / (Math.max(a[1], b[1]) - Math.min(a[0], b[0]));
const pct = (a, b) => `${Math.round((100 * a) / Math.max(b, 1))}%`.padStart(4);
const ROM = new Set(["ERR_SHALLOW_SQUAT", "ERR_LOW_ABDUCTION"]);

function run(ex, mobility) {
  const rules = rulesFor(ex, mobility), opts = MOBILITY[mobility];
  const rows = []; let annotated = 0, counted = 0;
  for (const person of people) {
    const model = JSON.parse(readFileSync(new URL(`holdout_${person}_${ex}.json`, dir)));
    for (const seq of Object.values(JSON.parse(readFileSync(new URL(`seq_${person}_${ex}.json`, dir))))) {
      const cal = new Calibrator(model.calibration), det = [];
      let seg = { cfg: model.segmenter };
      const judge = (rep) => {
        if (!validateRep(rep, seg, rules).ok) return;
        const x = repFeatures(rep, model.feature_set);
        const out = cal.ready ? decide(model, classify(model, rep, cal.center(), x), opts)
          : decide(model.early, classify(model.early, rep), opts);
        cal.add(x);
        det.push({ span: [rep[0].idx, rep[rep.length - 1].idx + 1], label: out.label });
      };
      seq.frames.forEach((P, i) => { P.idx = seq.offset + i; P.t = (i * 1000) / 30; });
      if (model.segmenter.mode === "tempo") {
        const w = Math.round((model.segmenter.window * 30) / 1000);
        for (const r of seq.reps) judge(seq.frames.slice(Math.max(0, r.a - seq.offset - 3), r.a - seq.offset - 3 + w));
      } else {
        seg = new RepSegmenter(model.segmenter);
        seq.frames.forEach((P) => { const rep = seg.push(P); if (rep) judge(rep); });
      }
      const used = new Set();
      for (const r of seq.reps) {
        annotated++;
        let best = -1, bi = 0.3;
        det.forEach((d, j) => { const v = iou(d.span, [r.a, r.b]); if (!used.has(j) && v > bi) { best = j; bi = v; } });
        if (best < 0) continue;
        used.add(best); counted++; rows.push([r.label, det[best].label]);
      }
    }
  }
  const good = rows.filter(([t]) => t === "CORRECT"), bad = rows.filter(([t]) => t !== "CORRECT");
  const rom = bad.filter(([t]) => ROM.has(t)), form = bad.filter(([t]) => !ROM.has(t));
  const caught = (rs) => rs.filter(([, p]) => p !== "CORRECT").length;
  return `counted ${pct(counted, annotated)} | good reps called good ${pct(good.filter(([, p]) => p === "CORRECT").length, good.length)}` +
    ` | mistakes flagged ${pct(caught(bad), bad.length)}` + (rom.length ? ` (range-of-motion ${pct(caught(rom), rom.length)}, other form ${pct(caught(form), form.length)})` : "");
}

for (const ex of ["squat", "arm_abduction", "shoulder_extension"]) {
  console.log(ex);
  for (const m of ["standard", "slight", "moderate"]) console.log(`  ${m.padEnd(9)} ${run(ex, m)}`);
}
