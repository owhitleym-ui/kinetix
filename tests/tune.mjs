// Grid-search live rep-detection thresholds on held-out people.   node tests/tune.mjs
import { readFileSync, readdirSync } from "node:fs";
import { Calibrator, RepSegmenter, classify, decide, repFeatures } from "../frontend/lib/rehab/features.js";

const dir = new URL("./data/", import.meta.url);
const people = [...new Set(readdirSync(dir).filter((f) => f.startsWith("seq_")).map((f) => f.split("_")[1]))].sort();
const iou = (a, b) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])) / (Math.max(a[1], b[1]) - Math.min(a[0], b[0]));

function run(ex, seg) {
  let n = 0, found = 0, extra = 0, judged = 0, exact = 0;
  for (const person of people) {
    const model = JSON.parse(readFileSync(new URL(`holdout_${person}_${ex}.json`, dir)));
    const seqs = JSON.parse(readFileSync(new URL(`seq_${person}_${ex}.json`, dir)));
    for (const seq of Object.values(seqs)) {
      const s = new RepSegmenter({ ...model.segmenter, ...seg }), cal = new Calibrator(model.calibration), det = [];
      seq.frames.forEach((P, i) => {
        P.idx = seq.offset + i;
        const rep = s.push(P);
        if (!rep) return;
        const x = repFeatures(rep, model.feature_set);
        det.push({ span: [rep[0].idx, rep[rep.length - 1].idx + 1],
          out: cal.ready ? decide(model, classify(model, rep, cal.center(), x)) : decide(model.early, classify(model.early, rep)) });
        cal.add(x);
      });
      const used = new Set();
      for (const r of seq.reps) {
        n++;
        let best = -1, bi = 0.3;
        det.forEach((d, j) => { const v = iou(d.span, [r.a, r.b]); if (!used.has(j) && v > bi) { best = j; bi = v; } });
        if (best < 0) continue;
        used.add(best); found++;
        if (det[best].out) { judged++; exact += det[best].out.label === r.label; }
      }
      extra += det.length - used.size;
    }
  }
  return { found: found / n, extra, exact: exact / Math.max(judged, 1) };
}

const grids = {
  squat: { primary: ["shoulder_height"], start: [5, 7, 9], end: [2, 3, 4], rest: [1.5, 2.5] },
  arm_abduction: { primary: ["right_shoulder"], start: [20, 30, 40], end: [6, 10, 15], rest: [4, 8] },
};
for (const [ex, g] of Object.entries(grids)) {
  const rows = [];
  for (const primary of g.primary) for (const start of g.start) for (const end of g.end) for (const rest of g.rest) {
    if (end >= start) continue;
    const r = run(ex, { primary, start, end, rest });
    rows.push({ primary, start, end, rest, ...r, score: r.found * r.exact - 0.002 * r.extra });
  }
  rows.sort((a, b) => b.score - a.score);
  console.log(`\n${ex}: best settings`);
  for (const r of rows.slice(0, 4))
    console.log(`  ${r.primary} start ${r.start} end ${r.end} rest ${r.rest} -> found ${(r.found * 100).toFixed(1)}%, extra ${r.extra}, exact ${(r.exact * 100).toFixed(1)}%`);
}
