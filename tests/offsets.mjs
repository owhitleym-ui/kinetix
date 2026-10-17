// How do live-detected rep boundaries differ from the annotated ones? (frames; + = later)
import { readFileSync, readdirSync } from "node:fs";
import { RepSegmenter } from "../frontend/lib/rehab/features.js";
const dir = new URL("./data/", import.meta.url);
const people = [...new Set(readdirSync(dir).filter((f) => f.startsWith("seq_")).map((f) => f.split("_")[1]))].sort();
for (const ex of ["squat", "arm_abduction"]) {
  const ds = [], de = [];
  for (const person of people) {
    const model = JSON.parse(readFileSync(new URL(`holdout_${person}_${ex}.json`, dir)));
    for (const seq of Object.values(JSON.parse(readFileSync(new URL(`seq_${person}_${ex}.json`, dir))))) {
      const seg = new RepSegmenter(model.segmenter), det = [];
      seq.frames.forEach((P, i) => { P.idx = seq.offset + i; const r = seg.push(P); if (r) det.push([r[0].idx, r[r.length - 1].idx + 1]); });
      for (const r of seq.reps) {
        const d = det.find(([a, b]) => Math.min(b, r.b) - Math.max(a, r.a) > 0.3 * (r.b - r.a));
        if (d) { ds.push(d[0] - r.a); de.push(d[1] - r.b); }
      }
    }
  }
  const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
  console.log(`${ex}: start offset p10/median/p90 = ${q(ds, .1)}/${q(ds, .5)}/${q(ds, .9)} | end offset = ${q(de, .1)}/${q(de, .5)}/${q(de, .9)}`);
}
