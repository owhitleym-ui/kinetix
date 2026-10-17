# Compact REHAB26 training dataset

`rehab26_features.npz` holds every labeled rep of REHAB26-ViewAngles (5 people, 3 exercises, 1,665 reps x 3
cameras = 4,995 rep-views), already converted into the features the models use. `training/train_rehab26.py`
retrains from it directly; no download needed.

| Array | Shape | Meaning |
|---|---|---|
| `x` | 4995 x 494 | absolute joint-angle features of the annotated rep (26 signals x [16 resampled points + min, max, mean]) |
| `d` | 4995 x 494 | the same, as change from the rep's own start pose |
| `xv`, `dv` | 4995 x 2 x 494 | `x` / `d` for two extra cuts of each rep, cut the way the live rep detector cuts them |
| `label` | 4995 | `CORRECT` or a mistake code, e.g. `ERR_KNEES_INSIDE` |
| `ex`, `person`, `video`, `cam`, `angle`, `session`, `a`, `b` | 4995 | exercise, participant, recording, camera (1-3), viewing angle in degrees (0 = front), session id, first / last frame |
| `meta` | | JSON: feature version, signal names, source, license |

Features are stored as float32. Rebuild with `python training/export_features.py` (needs the full data, see
`scripts/get_data.sh`).

**Source and license.** Derived from REHAB26-ViewAngles: Jánošová, Lang, Budikova, Sedmidubsky (2026),
*Impact of Patient Orientation in Single- and Multi-View Camera Environments for AI-based Rehabilitation
Monitoring*, arXiv:2609.35726; dataset doi:10.5281/zenodo.23018127. Licensed CC BY-NC 4.0
(https://creativecommons.org/licenses/by-nc/4.0/): non-commercial use only, with attribution. Changes: the
dataset's MediaPipe skeletons were turned into the features above; no images or video are included.
