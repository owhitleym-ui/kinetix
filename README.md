# PT Form Coach

**HackTN 2026 · Track #2: Health Access, Equity & Experience**

> Your PT prescribes the exercise. Our app watches you do it at home and corrects you in real time — free, in your browser, in your language.

Browser-based real-time physical therapy form coach. MediaPipe runs **on-device** (offline-first). Only joint **keypoints** are sent to OCI — **never video**.

---

## Architecture

```
Patient browser
  Webcam → MediaPipe Pose → joint angles → canvas cues + Web Speech
                 │ keypoints only
                 ▼
FastAPI (OCI Compute)
  → OCI Object Storage (session logs)
  → OCI Model Deployment (rep quality)
  → OCI Generative AI (plain-language cues)
                 ▼
PT Dashboard (/dashboard) — adherence, quality trends, CPT 98985
```

**Design choice:** If the network drops, live feedback still works. Session logging and model scoring resume on reconnect.

---

## Quick start (local)

### Frontend (Next.js)

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → **Start squat session**.  
Allow camera access. Complete **3 calibration squats**, then continue for live coaching.

> Webcam `getUserMedia` requires a secure context. Localhost is fine for development; use **Vercel HTTPS** for the demo.

### Backend (FastAPI)

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --reload --port 8000
```

Without OCI credentials, the API writes sessions to `backend/data/sessions/` and uses a heuristic / local classifier.

### Main model: REHAB26 per-rep mistake classifiers

The live coach for **squat, shoulder abduction and shoulder extension** (the default on `/session`) runs
per-exercise mistake classifiers trained on [REHAB26-ViewAngles](https://doi.org/10.5281/zenodo.23018127)
(MediaPipe world landmarks, physiotherapist-labeled, CC BY-NC 4.0). Everything runs in the browser:

```
MediaPipe Pose (world landmarks) → setup gate (whole body in frame, facing camera, start pose, still)
  → rep detection → rep validation (complete, deliberate reps only)
  → 26 joint signals → 494 features → early model (reps 1-3) / calibrated-to-you model (rep 4+) → cue
```

| Path | What |
|---|---|
| `frontend/public/models/rehab26_*.json` | Trained models loaded by the site |
| `frontend/lib/rehab/` | Features, rep detection, session rules (JS), cue text incl. Spanish |
| `frontend/components/RehabCamera.js` | Live coaching UI |
| `training/` | `train_rehab26.py`, `rehab_features.py` (Python mirror of `features.js`), `report.json` metrics |

Leave-one-person-out, facing the camera: catches 92-96% of mistakes and names the right one 68-78% of the time
(`training/report.json`). Retrain:

```bash
bash scripts/get_data.sh                       # ~690 MB of skeletons into data/rehab26/
pip install -r training/requirements.txt
python training/train_rehab26.py               # writes frontend/public/models/rehab26_*.json + tests/data/
node tests/parity_test.mjs && node tests/sim_test.mjs   # JS == Python features; live replay on held-out people
```

`frontend/lib/rehab/features.js` and `training/rehab_features.py` must stay identical (`parity_test.mjs`).
Bird dog / side plank still use the joint-interval coach (`PoseCamera` + `lib/liveCoach.js`).

### Optional: train local classifier (legacy EC3D, backend `/score-rep`)

```bash
cd model
pip install scikit-learn joblib numpy
python train.py
```

Writes `backend/models/rep_classifier.joblib`. Prefer [UI-PRMD](https://www.webpages.uidaho.edu/ui-prmd/) JSON under `model/data/ui-prmd/` when available.

---

## OCI services used

| Service | Role |
|---|---|
| **OCI Object Storage** | Keypoint session logs (never video) |
| **OCI Data Science** | Train rep quality classifier (UI-PRMD / synthetic) |
| **OCI Model Deployment** | REST scoring per rep |
| **OCI Generative AI** | Plain-language EN/ES cues |
| **Oracle 23ai Vector Search** | Roadmap: similar-session / deviation patterns |
| **OCI Compute** | Hosts FastAPI |

Configure via `backend/.env` (see `.env.example`).

---

## Demo flow

1. Open the app over HTTPS — no install  
2. Pick Squat (default): stand back until your whole body is in frame, hold still for “Go”  
3. Good squat → “1. Good.” and a green cue  
4. Cave a knee → knees turn red + voice: “Knees out. Push your knees out so they track over your toes.”  
5. Rep score card (REHAB26 model; calibrated to you after 3 reps)  
6. PT dashboard (`pt` / `hacktn2026`) — quality chart + CPT 98985 note  
7. Toggle **ES** for Spanish cues  

---

## Dataset

- **REHAB26-ViewAngles** (main model) — 5 people, squat / shoulder abduction / shoulder extension, physiotherapist-labeled mistakes, MediaPipe skeletons. CC BY-NC 4.0, doi:10.5281/zenodo.23018127. Downloaded by `scripts/get_data.sh`, not redistributed.
- **UI-PRMD** — University of Idaho Physical Rehabilitation Movement Dataset (correct + incorrect PT exercises, skeleton data).  
- Synthetic features matching our MediaPipe joint schema are used when UI-PRMD is not mounted (hackathon bootstrap).

---

## Responsible AI

- No video leaves the device or touches OCI  
- System **flags**; the PT **decides** — no autonomous diagnosis  
- Personal baseline (body-aware equity)  
- Plain language; EN + ES  
- WCAG-minded UI (contrast, labels, keyboard)  

---

## Project layout

```
frontend/     Next.js — patient session + PT dashboard
backend/      FastAPI — OCI Object Storage / Model / GenAI bridge
model/        Classifier training scripts
PT_FormCoach_BuildSpec.md
```

---

## Deploy

- **Frontend:** `cd frontend && npx vercel`  
- **Backend:** OCI Compute + `uvicorn main:app --host 0.0.0.0 --port 8000`  
- Set `NEXT_PUBLIC_API_URL` to the public API URL  
- Set `CORS_ORIGINS` on the backend to your Vercel domain  

---

## Team

_Add hackathon teammates and who built what here before submission._

---

*HackTN 2026 · Oct 17–18 · Vanderbilt University*
