# Kinetix

Patients practise their physical therapist's home exercises between visits with live, on-camera form feedback; their
PT sees progress and approves AI-drafted plan changes. Point a webcam at yourself (or load a video), and Kinetix
counts your reps, spots common mistakes, and tells you how to fix them, on screen and out loud, after every rep.
Pose tracking runs in the browser tab: the video never leaves your computer.

**Live demo:** [https://kinetix-six-drab.vercel.app/](https://kinetix-six-drab.vercel.app/)
(static UI on Vercel; optional coach/TTS hit a hosted Oracle backend — see `deploy/HOSTING.md`)

## The app

| Screen | Route | Who |
|---|---|---|
| Landing page, sign-in pop-up | `#/`, `#/signin` | everyone |
| Today (plan, PT feedback, your week) | `#/patient` | patient |
| My progress | `#/patient/progress` | patient |
| Messages (patient ↔ PT) | `#/patient/messages`, `#/provider/messages` | patient / PT |
| Warm-up → recording choice → live form check | `#/patient/warmup` → `#/patient/record` → `#/patient/session` | patient |
| Session summary + check-in (pain, effort, note) | `#/patient/summary` | patient |
| Settings (video & privacy, reminders, text size, spoken cues, care team + session sharing, account) | `#/patient/settings` | patient |
| Plan report (shared session / plan write-up) | `#/patient/report/<reportId>`, `#/provider/report/<reportId>` | patient / PT |
| Exercise library (single exercise, no plan) | `#/library`, `#/library/<region>/<exercise>` | patient (read-only for PTs) |
| Caseload: needs attention + all patients | `#/provider` | PT |
| Plan drafts list | `#/provider/drafts` | PT |
| Patient progress (pain, form, deficits, adherence, sessions, errors) | `#/provider/patient/<id>` | PT |
| AI plan review: accept / edit / dismiss, approve & send | `#/provider/plan/<draftId>` | PT |
| Provider settings (AI assistant + pain limit, alerts, defaults) | `#/provider/settings` | PT |

The loop: a patient practises → sessions log reps, form errors, pain and effort → the AI plan rules
(`web/planRules.js`) draft changes → the PT reviews, edits and approves → the patient's Today plan updates with a
note from the PT. Nothing reaches the patient without PT approval, and no progression is suggested while pain is
above the PT's limit (Provider settings, default 4/10).

### Demo mode

Everything works with only `npm run serve` (or the live Vercel URL): no database, no OCI, no TTS server. Sign in from
the pop-up with **Continue with demo patient account** (Sam Rivera, rotator cuff repair, week 3, pain rising) or
**Continue with demo provider account** (Dr. Maya Lee, DPT, a caseload of 8). The seed (`web/demo/seed.js`) is
fictional, uses only the 8 exercises that have a model, and its dates are relative to today. Demo data lives in your
browser's `localStorage`; **Reset demo data** is at the bottom of both settings screens. Live sessions in demo mode
are saved to the same store, so the summary, caseload and patient progress screens show what you just did.

With the ATP API running (see `api/README.md`) and a real account, sign-in uses it, and sessions and reps are logged
there as before. The newer endpoints the screens read (plans, check-ins, caseload, drafts, settings, messages) are
not in `api/` yet; until they are, those reads fall back to the demo data. The AI plan rules try FastAPI
`POST /coach/plan-suggestions` first and run the same rules in the browser when it isn't there.

## Features

- **Exercise library by body region**: "What would you like to work on?" → pick a region (Shoulder & Arm,
  Spine & Core, Hip & Knee) → pick an exercise (each card says what it targets and why it's prescribed) → session.
  Planned exercises are listed as "Coming soon".

  | Region | Available | Coming soon |
  |---|---|---|
  | Shoulder & Arm | Shoulder Abduction, Shoulder Extension (paced), Shoulder Abduction AROM, Shoulder Horizontal Adduction, External Rotation at 90° Abduction, Internal Rotation at 90° Abduction, Shoulder Circumduction | Elbow Flexion, Overhead Elbow Extension, Wrist Extension AROM |
  | Spine & Core | | Prone Press-Up, Standing Lateral Trunk Flexion, Standing Trunk Rotation, Pelvic Rotation |
  | Hip & Knee | Bodyweight Squat | Standing Hip Abduction, Split Squat, Sit-to-Stand, Supine Hip and Knee Flexion |

  Two ways of judging a rep (not shown in the UI): Bodyweight Squat, Shoulder Abduction and Shoulder Extension use a
  trained classifier; the other five shoulder exercises use joint-angle checks against clinical thresholds.
  Shoulder exercises use the right arm.
- **Trained classifier**: five physiotherapist-defined mistakes per exercise, detected automatically.
  - Squat: knee valgus, excessive forward knee travel, heel rise, insufficient depth, lateral trunk lean
  - Shoulder Abduction: forward arm drift, scapular elevation, lateral head tilt, limited abduction range, elbow not fully extended
  - Shoulder Extension: forward trunk lean, scapular elevation, trunk rotation, elbow not fully extended, arm drifting into abduction
- **Joint-angle checks**: each rep's joint angles are compared with textbook range-of-motion norms and compensation
  limits, and the most severe miss is named (for example "Limited circumduction range: shoulder elevation 142°,
  target ≥ 150°"). The panel shows every measured angle against its target.
- **Setup check**: counting starts only when your whole body is in frame, you face the camera, you're in the start
  position and holding still. Then it says "Go".
- **Only real reps count**: a movement must be complete and deliberate (full range, back to start, steady, in frame).
  Anything else is logged as "Not counted" with the reason.
- **Feedback on every rep**: verdict, how to fix it, spoken cue, joint-angle overlay, rep counter and a rep log.
- **Spoken cues + Ask coach**: neural TTS via `web/naturalSpeak.js` → the voice-feedback proxy (local `:3002`) or
  the hosted OCI `/tts` path (Vercel already points there). Mid-set you can type or speak to the coach (mic /
  **Voice command**), and GenAI replies when the FastAPI coach is running.
- **Mobility limits: None / Slight / Moderate**: relaxes what counts as a good rep for people who can't do the full
  movement. Slight: about 15% less range needed to count; Moderate: about 25% less. Range-of-motion feedback gets
  gentler and needs more evidence; real form problems are still flagged. Good reps called good: 70-75% (None),
  75-77% (Slight), 79-81% (Moderate); mistakes still flagged: 93-94%, 93%, 91-92%. Remembered per browser.
- **Full screen** with large overlays (button on the video, or press `F`).

## Quick start

```bash
npm run serve        # static server for web/ on port 8801
```

Open <http://127.0.0.1:8801> in Chrome, Edge or Safari, choose **I'm a patient** or **I'm a provider**, and continue
with the demo account. As a patient, press **Start today's session**: warm-up, then the recording choice, then the
camera. **Practise something else** opens the exercise library.

Or skip local setup and open the live demo: [https://kinetix-six-drab.vercel.app/](https://kinetix-six-drab.vercel.app/)

Optional services (each one is used when it's running and skipped when it isn't):

```bash
npm run serve:api    # FastAPI coach on :8000 (OCI GenAI, local fallbacks; see backend/.env.example)
npm run serve:atp    # ATP accounts/sessions API on :3001 (needs an Oracle wallet, see api/README.md)
# Neural TTS proxy on :3002 (OpenAI key in voice-feedback/.env):
cd voice-feedback/server && npm install && npm start
```

No build step or install is needed for the app. Camera access works on `localhost`. MediaPipe loads from the
jsDelivr CDN, so the first load needs internet. Hosting (Vercel UI + OCI backend) is documented in
`deploy/HOSTING.md`.

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

### ROM angle checks

The range-of-motion exercises follow the rule-based approach of Adarsh & Francis (*AI Fitness Coach: Real-Time
Exercise Posture Correction Using MediaPipe Pose Estimation and Voice Guidance*, NCECA 2026): measure joint angles,
compare them with the range that defines correct form, and name the mistake when an angle leaves it.

```
camera / video → MediaPipe Pose → setup gate → rep detection (shoulder elevation, hand position or forearm rotation)
  → rep validation → joint angles at the rep's turning point + largest trunk drift → each angle vs its clinical limit
  → most severe miss named (or "Good form") → on-screen + spoken feedback
```

- **Thresholds come from clinical norms, not from data**: AAOS / Norkin & White range-of-motion norms (shoulder
  abduction 0–180°, external rotation 0–90°, internal rotation 0–70°, horizontal adduction 0–135°) and common
  compensation limits (lateral trunk lean under 10°). Each check stores its source (`basis`) in
  `web/models/rules_<exercise>.json`.
- **Measured in the image plane**: these movements cross the camera's view while the person faces it, and depth is
  MediaPipe's weakest axis (a forearm pointing straight up reads ~50° off vertical in its 3D landmarks). Rotation is
  estimated from how tall the forearm looks relative to the upper arm (forearm ≈ 0.78 × upper arm, Winter's
  anthropometric tables). Trunk lean is measured along the non-working side, because the working shoulder rises with
  the arm.
- **Checked for false alarms** on MobiPhysio videos that three physiotherapists scored ≥ 90: how often a rep that
  experts rated good trips a rule (see Results). The expert scores don't name mistakes, so which mistake is named
  is not validated.

## Project layout

Each top-level folder has its own README. Start here, then open the folder you need.

```
web/                    patient + provider SPA (static; Vercel deploys this) — see web/README.md
backend/                FastAPI coach API (:8000) — GenAI + plan-suggestions + session logs — backend/README.md
api/                    Express ATP API (:3001) — accounts, sessions, reps (Oracle DB) — api/README.md
voice-feedback/         OpenAI TTS proxy (:3002); wired via web/naturalSpeak.js — voice-feedback/README.md
deploy/                 Vercel + OCI hosting; nginx sample — deploy/README.md, deploy/HOSTING.md
training/               train classifiers + clinical ROM rules — training/README.md
dataset/                compact REHAB26 features (.npz) — dataset/README.md
tests/                  parity, sim, rules, mobility, browser checks — tests/README.md
scripts/                serve-web, dataset download helpers — scripts/README.md
docs/                   product brief + repo map — docs/README.md
.github/workflows/      OCI auto-deploy on push to main
```

`frontend/` is a local Next.js leftover (gitignored). The live app is `web/`.

## Retrain the models

Works right after cloning, using the compact dataset in `dataset/` (no download, about 10 seconds):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python training/train_rehab26.py       # writes web/models/*.json and training/report.json
```

ROM angle checks (thresholds are fixed; this re-measures false alarms and rewrites `web/models/rules_*.json`):

```bash
python scripts/get_mobiphysio.py               # ~20 GB of videos into data/mobiphysio
python training/extract_pose.py mobiphysio E01 E02 E03 E04 E05   # MediaPipe skeletons (~1 h on a laptop)
python training/clinical_rules.py              # also writes tests/data/rules_*.json for npm test
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
npm run mobility                       # None vs Slight vs Moderate mobility limits
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

Joint-angle checks: share of reps from MobiPhysio videos that three physiotherapists scored ≥ 90 that pass every
check (`training/rules_report.json`). Which mistake gets named can't be validated: no dataset labels it.

| Exercise | Videos scored ≥ 90 | People in the data | Reps checked | Pass every check |
|---|---|---|---|---|
| Shoulder Abduction AROM | 36 | 24 | 399 | 79% |
| Shoulder Horizontal Adduction | 30 | 23 | 293 | 89% |
| External Rotation at 90° Abduction | 12 | 23 | 101 | 96% |
| Internal Rotation at 90° Abduction | 9 | 22 | 55 | 82% |
| Shoulder Circumduction | 51 | 23 | 525 | 82% |

## Limitations

- Trained on only 5 people; shoulder exercises are right arm only; designed for a front-facing camera.
- Tuned to be sensitive: roughly 1 in 4 good reps gets flagged. Lower `TAU` in `training/train_rehab26.py`
  for fewer false alarms.
- The calibrated model compares you with yourself, so a mistake made on every single rep can start to look normal.
- Small or depth-direction mistakes (torso leaning sideways, heels lifting, elbow bending) are the hardest to see
  from the front.
- ROM angle checks: the thresholds are textbook norms, checked only for false alarms. No dataset labels which
  mistake a range-of-motion rep has, so the named mistake isn't validated. Rotation is an estimate (about ±10°), and
  trunk rotation isn't checked (from the front it can't be told apart from normal shoulder-blade motion).

## Privacy

Pose detection, rep counting and classification all run locally in the browser. No video, images or landmarks are
uploaded or stored, whichever recording choice the patient makes; only the choice itself is saved. Rep results,
form scores and check-ins are shared with the patient's PT (auto-share can be turned off in Settings, per session too).
Copy says health data is handled in accordance with HIPAA; this demo does not implement compliance controls.

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
- **MobiPhysio** (false-alarm check for the ROM angle checks): Iqbal et al., Harvard Dataverse 2025,
  [doi:10.7910/DVN/XSI0QN](https://doi.org/10.7910/DVN/XSI0QN), CC0 1.0. Videos are not included; only measured
  statistics are.
- **Rule-based approach**: Adarsh V K & Nimmy Francis, *AI Fitness Coach: Real-Time Exercise Posture Correction
  Using MediaPipe Pose Estimation and Voice Guidance*, NCECA 2026, [doi:10.5281/zenodo.19597767](https://doi.org/10.5281/zenodo.19597767).
- **Range-of-motion norms**: American Academy of Orthopaedic Surgeons; Norkin & White, *Measurement of Joint
  Motion: A Guide to Goniometry*. Segment lengths: Winter, *Biomechanics and Motor Control of Human Movement*.
- **MediaPipe Pose Landmarker** (Google, Apache 2.0): `web/models/pose_landmarker_full.task` and the
  `@mediapipe/tasks-vision` library loaded from jsDelivr.
