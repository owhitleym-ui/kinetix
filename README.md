# Form Check

Live, on-device movement feedback for physical therapy exercises. Point a webcam at yourself (or load a video),
and Form Check counts your reps, spots common mistakes, and tells you how to fix them, on screen and out loud,
after every rep. Everything runs in the browser tab: the video never leaves your computer.

## Features

- **Three exercises**: Bodyweight Squat, Shoulder Abduction (right arm), Shoulder Extension (right arm, guided pace).
- **Mistake detection**: five physiotherapist-defined mistakes per exercise, detected automatically.
  - Squat: knees caving in, knees past toes, heels lifting, not deep enough, leaning to one side
  - Shoulder Abduction: arm drifting forward, shoulder shrugging, head tilting, arm not high enough, elbow bending
  - Shoulder Extension: leaning forward, shoulder shrugging, torso twisting, elbow bending, arm drifting out
- **Setup check**: counting starts only when your whole body is in frame, you face the camera, you're in the start
  position and holding still. Then it says "Go".
- **Only real reps count**: a movement must be complete and deliberate (full range, back to start, steady, in frame).
  Anything else is logged as "Not counted" with the reason.
- **Feedback on every rep**: verdict, how to fix it, spoken cue, joint-angle overlay, rep counter and a rep log.
- **Full screen** with large overlays (button on the video, or press `F`).

## Quick start

```bash
npm run serve        # same as: python3 -m http.server 8801 --bind 127.0.0.1 --directory web
```

Open <http://127.0.0.1:8801> in Chrome, Edge or Safari, choose an exercise and press **Start session**.
No build step or install is needed for the app. Camera access works on `localhost`. MediaPipe loads from the
jsDelivr CDN, so the first load needs internet.

## How it works

```
camera / video
  → MediaPipe Pose Landmarker (in the browser)   33 body points per frame, 3D "world" coordinates
  → setup gate                                    whole body in frame, facing camera, start position, still
  → rep detection                                 squat: shoulder height; abduction: shoulder angle;
                                                  extension: spoken "Back" cue every few seconds
  → rep validation                                complete, deliberate reps only
  → 26 joint-angle signals → 494 features         each signal resampled to 16 points + min / max / mean
  → classifier (logistic regression, per exercise)
       reps 1-3: "early" model    features = change from the rep's own start pose (no calibration needed)
       rep 4+:   calibrated model features compared with this user's own previous reps
  → mistake named whenever P(correct) < threshold → on-screen + spoken feedback
```

Models were trained on **REHAB26-ViewAngles**: 5 people, 1,665 physiotherapist-labeled reps, each filmed by
3 phones. Training uses the MediaPipe skeletons that ship with the dataset, never images. It takes about 40 s on a
laptop CPU; no GPU is needed.

## Project layout

```
web/                    the app (static files, served as-is)
  index.html            layout and styles
  app.js                camera loop, drawing, feedback, voice, rep log, full screen
  features.js           joint-angle features, rep detection, calibration, classifier (shared with the tests)
  session.js            setup gate and rep validation rules
  models/               pose_landmarker_full.task (MediaPipe) + rehab26_<exercise>.json (trained weights)
training/
  train_rehab26.py      train + evaluate (leave-one-person-out) + export models to web/models/
  rehab_features.py     Python copy of the feature code in web/features.js
  export_features.py    rebuilds dataset/rehab26_features.npz from the full data
  report.json           metrics from the last training run
dataset/
  rehab26_features.npz  compact ready-to-train dataset (every labeled rep as model features + labels, 48 MB)
tests/
  parity_test.mjs       browser features == training features
  sim_test.mjs          replays held-out people frame by frame through the live pipeline
  tune.mjs, offsets.mjs rep-detection tuning tools
  browser_test.py, load_check.py, fs_check.py   headless-Chrome checks of the real page
scripts/get_data.sh     downloads the full skeleton data into data/ (not committed, ~690 MB)
```

## Retrain the models

Works right after cloning, using the compact dataset in `dataset/` (no download, about 10 seconds):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python training/train_rehab26.py       # writes web/models/*.json and training/report.json
```

To change the features themselves or run the replay tests, get the full skeleton data first. Training then uses it
automatically and also writes `tests/data/`:

```bash
bash scripts/get_data.sh               # about 690 MB into data/rehab26
python training/train_rehab26.py
python training/export_features.py     # optional: refresh dataset/rehab26_features.npz
```

## Tests

```bash
npm test                               # needs tests/data/ from a training run on the full data
npm run serve &                        # then, with Google Chrome installed:
python tests/load_check.py             # page loads without errors
python tests/browser_test.py testvideos/<clip>.mp4 arm_abduction CORRECT   # clip in web/testvideos/
python tests/fs_check.py testvideos/<clip>.mp4 screenshots/fullscreen.png
```

## Results

People the model never saw, facing the camera, full live pipeline (`npm test`), every rep judged:

| Exercise | Reps counted | Mistakes caught | Mistake named correctly | Good reps left alone |
|---|---|---|---|---|
| Bodyweight Squat | 94% | 94% | 63% | 70% |
| Shoulder Abduction | 100% | 94% | 69% | 71% |
| Shoulder Extension | 100% | 93% | 79% | 75% |

## Limitations

- Trained on only 5 people; shoulder exercises are right arm only; designed for a front-facing camera.
- Tuned to be sensitive: roughly 1 in 4 good reps gets flagged. Lower `TAU` in `training/train_rehab26.py`
  for fewer false alarms.
- The calibrated model compares you with yourself, so a mistake made on every single rep can start to look normal.
- Small or depth-direction mistakes (torso leaning sideways, heels lifting, elbow bending) are the hardest to see
  from the front.

## Privacy

Pose detection, rep counting and classification all run locally in the browser. No video, images or landmarks are
uploaded or stored.

## License

Code: MIT (see `LICENSE`). The trained models in `web/models/rehab26_*.json` are for non-commercial use only,
because their training data is licensed CC BY-NC 4.0 (details below).

## Data and third-party licenses

- **REHAB26-ViewAngles** (training data): Jánošová, Lang, Budikova, Sedmidubsky (2026), *Impact of Patient
  Orientation in Single- and Multi-View Camera Environments for AI-based Rehabilitation Monitoring*,
  [arXiv:2609.35726](https://doi.org/10.48550/arXiv.2609.35726); dataset
  [doi:10.5281/zenodo.23018127](https://doi.org/10.5281/zenodo.23018127). Licensed **CC BY-NC 4.0**, so the
  trained models in `web/models/rehab26_*.json` and the derived dataset in `dataset/` are for non-commercial use.
  `dataset/rehab26_features.npz` is a modified version of that data (features computed from its skeletons), shared
  under the same license with attribution. The raw data is not included; `scripts/get_data.sh` downloads it.
- **MediaPipe Pose Landmarker** (Google, Apache 2.0): `web/models/pose_landmarker_full.task` and the
  `@mediapipe/tasks-vision` library loaded from jsDelivr.
