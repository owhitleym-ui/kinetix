# `tests/` — form-check & page checks

Automated checks for feature parity, live pipeline replay, ROM rules, mobility limits, and basic browser load.

## Prerequisites

Most Node tests need fixtures under `tests/data/` produced by a **full-data** training run:

```bash
bash scripts/get_data.sh
python training/train_rehab26.py    # writes tests/data/
```

Compact-only training (`dataset/rehab26_features.npz`) does **not** write those replay files. `tests/data/*` is gitignored except `.gitkeep`.

Browser Python tests need Google Chrome and a running `npm run serve`, plus optional clips under `web/testvideos/` (gitignored).

## Commands (from repo root)

| Command | What it runs |
|---|---|
| `npm test` | `parity_test.mjs` + `sim_test.mjs` + `rules_test.mjs` |
| `npm run mobility` | `mobility_test.mjs` — None / Slight / Moderate limits |
| `npm run rules` | `rules_test.mjs` alone |
| `npm run tune` | `tune.mjs` — rep-detection tuning |

Headless Chrome (with the static server up):

```bash
npm run serve &
python tests/load_check.py
python tests/browser_test.py testvideos/<clip>.mp4 arm_abduction CORRECT
python tests/fs_check.py testvideos/<clip>.mp4 screenshots/fullscreen.png
```

Python deps: `websocket-client` (root `requirements.txt`).

## Files

| File | Role |
|---|---|
| `parity_test.mjs` | Browser feature code matches Python training features |
| `sim_test.mjs` | Replay held-out people frame-by-frame through the live pipeline |
| `rules_test.mjs` | ROM: browser vs Python angles; setup + replay of expert-approved videos |
| `mobility_test.mjs` | Mobility setting effect on the same replays |
| `tune.mjs`, `offsets.mjs` | Rep-detection tuning helpers |
| `load_check.py` | Page loads without console errors |
| `browser_test.py` | Drive a clip through the real UI (`?autostart` / `?test` / `?expected`) |
| `fs_check.py` | Full-screen overlay screenshot check |

URL params `?autostart`, `?test`, and `?expected` skip the warm-up for automation — keep those working when changing `web/app.js` routing.
