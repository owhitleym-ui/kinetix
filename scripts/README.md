# `scripts/` — local helpers

Small utilities used from the repo root. Prefer the `npm` scripts in the root `package.json` when they wrap these.

## Scripts

| File | Purpose |
|---|---|
| `serve-web.mjs` | Static file server for `web/` on `127.0.0.1:8801` (no-cache on JS/CSS). Invoked by `npm run serve` / `npm run dev`. |
| `get_data.sh` | Download full REHAB26-ViewAngles skeleton data into `data/rehab26` (~690 MB, gitignored). Needed for replay tests and refreshing the compact `.npz`. |
| `get_mobiphysio.py` | Download MobiPhysio videos used for ROM false-alarm checks (~20 GB → `data/mobiphysio`, gitignored). |
| `show_plan_out.py` | Debug helper to print / inspect AI plan-suggestion output. |

## Examples

```bash
npm run serve                          # node scripts/serve-web.mjs
bash scripts/get_data.sh
python scripts/get_mobiphysio.py
python scripts/show_plan_out.py
```

TTS smoke test lives under `voice-feedback/scripts/`, not here.
