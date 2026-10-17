// Do the browser features (frontend/lib/rehab/features.js) equal the training features (rehab_features.py)?
//   node tests/parity_test.mjs
import { readFileSync } from "node:fs";
import { repFeatures } from "../frontend/lib/rehab/features.js";

const reps = JSON.parse(readFileSync(new URL("./data/parity.json", import.meta.url)));
let worst = 0;
for (const r of reps) {
  for (const [set, py] of [["abs", r.features], ["delta", r.delta]]) {
    const js = repFeatures(r.frames, set);
    if (js.length !== py.length) throw new Error(`${set}: length ${js.length} vs ${py.length}`);
    js.forEach((v, i) => { worst = Math.max(worst, Math.abs(v - py[i])); });
  }
}
console.log(`${reps.length} reps x ${reps[0].features.length} features (abs + delta), max |JS - Python| = ${worst.toExponential(2)}`);
if (worst > 1e-4) { console.error("MISMATCH"); process.exit(1); }
console.log("parity OK");
