# `training/` — form models & clinical rules

Python scripts that train the browser classifiers and regenerate joint-angle rule packs for `web/models/`.

## Setup

From the repo root:

```bash
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Root `requirements.txt` covers training (`numpy`, `scikit-learn`). Pose extraction over video needs MediaPipe separately when you use `extract_pose.py`.

## Scripts

| Script | What it does |
|---|---|
| `train_rehab26.py` | Train + leave-one-person-out eval; write `web/models/rehab26_*.json` and `training/report.json`. With full data, also writes `tests/data/` for replay tests. |
| `rehab_features.py` | Python twin of `web/features.js` (must stay in parity). |
| `export_features.py` | Rebuild `dataset/rehab26_features.npz` from full skeletons. |
| `clinical_rules.py` | Fixed clinical thresholds + false-alarm check on MobiPhysio; write `web/models/rules_*.json` and `rules_report.json`. |
| `angle_rules.py` | Python twin of `web/rules.js`. |
| `extract_pose.py` | Run MediaPipe Pose over downloaded MobiPhysio videos. |

## Quick retrain (no download)

Uses the compact dataset shipped in `dataset/`:

```bash
python training/train_rehab26.py
# or force compact: python training/train_rehab26.py --compact
```

Takes ~10–40 s on a laptop CPU. Compact training reproduces models/metrics but **does not** write raw-skeleton replay files for `npm test`.

## Full data + tests

```bash
bash scripts/get_data.sh                 # ~690 MB → data/rehab26 (gitignored)
python training/train_rehab26.py         # also fills tests/data/
python training/export_features.py       # optional: refresh dataset/*.npz
```

## ROM / clinical rules

Thresholds are textbook norms (not learned). Re-measure false alarms and rewrite rule JSON:

```bash
python scripts/get_mobiphysio.py         # ~20 GB → data/mobiphysio
python training/extract_pose.py mobiphysio E01 E02 E03 E04 E05
python training/clinical_rules.py
```

## Outputs

| Output | Consumer |
|---|---|
| `web/models/rehab26_<ex>.json` | Live classifier in the app |
| `web/models/rules_<ex>.json` | Live ROM checks in the app |
| `training/report.json` | Classifier metrics |
| `training/rules_report.json` | False-alarm rates on expert-scored videos |
| `tests/data/*` | `npm test` / `npm run mobility` (needs full data run) |

## License note

REHAB26-ViewAngles is **CC BY-NC 4.0**. Derived models and `dataset/` are non-commercial use only. See the root README.
