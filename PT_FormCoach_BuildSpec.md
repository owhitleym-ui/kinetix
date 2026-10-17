# PT Form Coach — HackTN 2026 Build Spec
> Track #2: Health Access, Equity & Experience  
> Stack: MediaPipe (browser) · OCI Data Science · OCI Object Storage · Oracle 23ai · OCI GenAI · Vercel (frontend hosting)

---

## What We're Building

A **browser-based, real-time physical therapy form coach** that uses your webcam to detect joint angles live and corrects your movement as it happens — no app install, no employer plan, no expensive hardware.

**One-sentence pitch:**  
> "Your PT prescribes the exercise. Our app watches you do it at home and corrects you in real time — free, in your browser, in your language."

**Core differentiator:**  
The system establishes *your* personal movement baseline in the first 3 warm-up reps, then judges all subsequent reps against *your* body — not a textbook body. This matters for equity: it works regardless of body size, proportions, or mobility limitations.

**Doctor-recommended reference video (Phase 2 / roadmap):**  
After live detection is working, the system can optionally compare against a reference video prescribed by the clinician. The same pose extraction pipeline runs on both inputs — this is free once Phase 1 is done.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  PATIENT'S BROWSER                  │
│                                                     │
│  Webcam → MediaPipe Pose (on-device, no latency)   │
│         → Joint angles computed locally             │
│         → Correction cues rendered on canvas        │
│         → Skeleton overlay drawn on canvas          │
│                        │                            │
│          (keypoints only, never video)              │
└──────────────┬──────────────────────────────────────┘
               │ HTTPS
               ▼
┌─────────────────────────────────────────────────────┐
│                   OCI BACKEND                       │
│                                                     │
│  OCI Model Deployment                               │
│    └─ Rep quality classifier (correct/incorrect)    │
│    └─ Returns confidence score + error type         │
│                                                     │
│  OCI Object Storage                                 │
│    └─ Keypoint sequences per session                │
│    └─ Exercise prescriptions (from PT/doctor)       │
│    └─ Session metadata                              │
│                                                     │
│  Oracle 23ai Vector Search                          │
│    └─ Embed keypoint sequences                      │
│    └─ Find similar sessions / deviation patterns    │
│                                                     │
│  OCI Generative AI                                  │
│    └─ Plain-language correction cues                │
│    └─ Multilingual voice output (EN, ES minimum)    │
│    └─ PT session summaries                          │
└─────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│                  PT DASHBOARD                       │
│   (same web app, different route, login-gated)      │
│                                                     │
│  Per-patient adherence view                         │
│  Rep quality over time (chart)                      │
│  Flagged compensations (hip hike, trunk lean, etc.) │
│  Session log usable for RTM billing (CPT 98985)     │
└─────────────────────────────────────────────────────┘
```

**Key architectural decision to state explicitly to judges:**  
MediaPipe runs on-device intentionally. If the network drops, live feedback still works. The user only loses session logging and rep quality scoring until reconnection. This is not a limitation — it's a deliberate offline-first design for low-connectivity settings.

---

## Build Phases (Ordered by Demo Priority)

### Phase 1 — Core Demo (Must Ship) 🔴

**Goal:** Working real-time squat correction in browser with skeleton overlay.

#### 1a. Frontend skeleton + pose detection
- [ ] Create a Next.js or plain HTML/JS app (Next.js preferred for Vercel deployment)
- [ ] Access webcam via `navigator.mediaDevices.getUserMedia()`
- [ ] Load MediaPipe Pose via CDN:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js"></script>
  ```
- [ ] Draw skeleton overlay on a `<canvas>` element overlaid on the video feed
- [ ] Extract the following joints per frame:
  - Left/right knee angle
  - Left/right hip angle  
  - Back tilt (angle between shoulder midpoint and hip midpoint)
  - Shoulder alignment (left vs right shoulder height delta)

#### 1b. Personal baseline calibration
- [ ] On app load, show "Calibration: do 3 slow squats" screen
- [ ] Capture keypoints from those 3 reps
- [ ] Compute mean + standard deviation for each joint angle at each phase of the movement
- [ ] Store baseline in-memory (later: persist to OCI Object Storage)
- [ ] All subsequent reps are judged against this baseline, not hardcoded thresholds

#### 1c. Real-time correction logic
- [ ] Define squat phases: descent → bottom → ascent (use hip Y-coordinate to detect)
- [ ] At each phase, compare current joint angles to baseline
- [ ] Fire a correction cue when deviation exceeds 1.5 standard deviations from baseline
- [ ] Priority order of corrections (only fire one at a time, most important first):
  1. Back rounding (spine angle)
  2. Knee cave (knee tracking inside foot)
  3. Depth not reached (hip angle threshold)
  4. Asymmetry (left vs right side delta)
- [ ] Highlight the offending joint in red on the skeleton overlay
- [ ] Display text cue on screen

#### 1d. Voice cues (makes the demo visceral)
- [ ] Use Web Speech API (`SpeechSynthesis`) — zero dependencies, works in browser
- [ ] English cues: "Lower your back", "Push your knees out", "Go deeper"
- [ ] Spanish cues: "Baja la espalda", "Empuja las rodillas hacia afuera", "Baja más"
- [ ] Language toggle in UI
- [ ] Throttle: only fire a voice cue once every 3 seconds to avoid spam

---

### Phase 2 — OCI Integration (Must Ship for Technicality Score) 🟡

**Goal:** At least two real OCI services doing real work.

#### 2a. OCI Object Storage — session logging
- [ ] After each session, POST keypoint sequences to a FastAPI backend running on OCI Compute
- [ ] Backend writes to OCI Object Storage bucket using `oci` Python SDK
- [ ] Payload: `{ patient_id, timestamp, exercise, reps: [{ phase, joints: {...} }] }`
- [ ] Never send video — keypoints only (state this explicitly in pitch)

#### 2b. OCI Model Deployment — rep quality classifier
- [ ] In OCI Data Science notebook, train a lightweight classifier:
  - Input: keypoint sequence for one rep (normalized joint angles as a flat vector or short time series)
  - Output: `{ quality: "correct" | "incorrect", error_type: "knee_cave" | "back_round" | "shallow" | "asymmetric", confidence: 0.0–1.0 }`
  - Dataset: UI-PRMD (10 PT exercises, correct + incorrect reps, skeleton data)
  - Model: Random forest or 1D CNN — keep it simple, it needs to train today
- [ ] Deploy model to OCI Model Deployment endpoint
- [ ] Frontend calls endpoint after each rep, displays quality score
- [ ] This is your "real ML on OCI" proof point for the judges

#### 2c. OCI Generative AI — plain language cues
- [ ] Call OCI GenAI (Cohere or Llama on OCI) to generate the correction text
- [ ] Prompt template:
  ```
  A patient is doing a squat. The detected error is: {error_type}.
  Their baseline knee angle is {baseline}°, current is {current}°.
  Write one short, encouraging correction in plain language (under 10 words).
  Language: {language}.
  ```
- [ ] This upgrades "knee angle deviation: 23°" to "Try pushing your knees outward a bit"
- [ ] Heather VanCura and Dr. Onuoha care about plain language — this directly answers that

---

### Phase 3 — PT Dashboard (Wireframe OK, working is better) 🟢

**Goal:** Show judges that the clinician stays in the loop.

- [ ] Separate `/dashboard` route, simple login gate (hardcode credentials for demo)
- [ ] Pull session data from OCI Object Storage
- [ ] Display per-patient:
  - Sessions completed this week
  - Average rep quality score per session (line chart)
  - Most common error type (bar chart)
  - Last session timestamp
- [ ] Add one line: "This data maps to CPT 98985 remote therapeutic monitoring billing"
- [ ] Keep it simple — a clean table with numbers beats a broken interactive dashboard

---

### Phase 4 — Reference Video Mode (Roadmap / mention only) ⚪

**Do not build this for the hackathon. Describe it in the pitch as Phase 2 of the product.**

- Doctor uploads or prescribes a reference video from a vetted library
- Same MediaPipe pipeline runs on the video at intake, stored as keypoint sequence in OCI Object Storage
- At session time, compare live keypoints to stored reference keypoints using DTW
- Video auto-pauses when live form deviates significantly
- This reuses 100% of the Phase 1 and Phase 2 code — zero new infrastructure

---

## Tech Stack Summary

| Layer | Technology | Why |
|---|---|---|
| Frontend framework | Next.js | Easy Vercel deploy, API routes for backend calls |
| Pose estimation | MediaPipe Pose | Runs in browser, 33 keypoints, no server needed |
| Canvas rendering | HTML5 Canvas API | Skeleton overlay on webcam feed |
| Voice cues | Web Speech API | Zero dependencies, multilingual |
| Hosting | Vercel | Free, instant HTTPS (required for webcam getUserMedia) |
| Model training | OCI Data Science + GPU | Rep quality classifier on UI-PRMD dataset |
| Model serving | OCI Model Deployment | REST endpoint called per rep |
| Session storage | OCI Object Storage | Keypoint sequences, exercise prescriptions |
| Pattern search | Oracle 23ai Vector Search | Session similarity, deviation pattern detection |
| Plain language | OCI Generative AI | Correction cues in multiple languages |
| PT backend | FastAPI on OCI Compute | Lightweight Python API bridging frontend to OCI |

---

## File Structure (suggested)

```
pt-form-coach/
├── frontend/                  # Next.js app
│   ├── pages/
│   │   ├── index.js           # Patient home / exercise selector
│   │   ├── session.js         # Live webcam + correction UI
│   │   └── dashboard.js       # PT dashboard
│   ├── components/
│   │   ├── PoseCamera.js      # Webcam + MediaPipe + canvas overlay
│   │   ├── SkeletonOverlay.js # Draws joints and bones on canvas
│   │   ├── CorrectionCue.js   # Text + voice cue display
│   │   └── RepScoreCard.js    # Shows OCI model quality score
│   ├── lib/
│   │   ├── poseDetection.js   # MediaPipe setup and keypoint extraction
│   │   ├── jointAngles.js     # Angle computation from keypoints
│   │   ├── baseline.js        # Calibration and baseline storage
│   │   ├── corrections.js     # Rule-based correction logic
│   │   └── ociClient.js       # API calls to OCI backend
│   └── public/
├── backend/                   # FastAPI on OCI Compute
│   ├── main.py                # API routes
│   ├── oci_storage.py         # Object Storage read/write
│   ├── oci_model.py           # Model Deployment calls
│   └── oci_genai.py           # GenAI correction cue generation
├── model/                     # OCI Data Science notebook
│   ├── train.py               # Classifier training on UI-PRMD
│   ├── preprocess.py          # Keypoint normalization
│   └── evaluate.py            # Accuracy metrics
└── README.md                  # GitHub submission (required by hackathon)
```

---

## Joint Angle Reference (MediaPipe landmarks)

MediaPipe returns 33 landmarks. Key ones for squat analysis:

| Joint | Landmarks to use | What to measure |
|---|---|---|
| Left knee | LEFT_HIP → LEFT_KNEE → LEFT_ANKLE | Flexion angle (should reach ~90° at bottom) |
| Right knee | RIGHT_HIP → RIGHT_KNEE → RIGHT_ANKLE | Flexion angle, compare to left for asymmetry |
| Left hip | LEFT_SHOULDER → LEFT_HIP → LEFT_KNEE | Hip flexion depth |
| Back angle | Midpoint(shoulders) → Midpoint(hips) | Forward lean (should stay <45° from vertical) |
| Knee tracking | LEFT_KNEE x vs LEFT_FOOT_INDEX x | Knee should stay over foot, not cave inward |

Angle formula between three points A → B → C:
```javascript
function getAngle(A, B, C) {
  const AB = { x: A.x - B.x, y: A.y - B.y };
  const CB = { x: C.x - B.x, y: C.y - B.y };
  const dot = AB.x * CB.x + AB.y * CB.y;
  const magAB = Math.sqrt(AB.x ** 2 + AB.y ** 2);
  const magCB = Math.sqrt(CB.x ** 2 + CB.y ** 2);
  return Math.acos(dot / (magAB * magCB)) * (180 / Math.PI);
}
```

---

## Exercises in Scope

**Ship only the squat for the demo.** One exercise done perfectly beats three done partially.

| Exercise | Why it's good for demo | Key joints |
|---|---|---|
| **Squat** ✅ *demo this* | Visually dramatic, correction is obvious to any observer | Knee, hip, back, knee tracking |
| Sit-to-stand | Clinically important, easy to do in a chair | Hip, knee angle at transition |
| Shoulder raise | Good for upper body, less dramatic visually | Shoulder alignment, elbow |

---

## Pitch Script (2 min + 2 min demo)

### Pitch (2 min)

**0:00 — The patient**
> "Maria is 58, lives in rural Tennessee, and just had knee surgery. Her surgeon prescribed 3 PT sessions a week. She can afford one. Between visits, she's doing her exercises at home — but no one's watching. She doesn't know she's been caving her knees for two weeks. Her recovery is being set back every single day."

**0:20 — The gap**
> "The apps that could help — Hinge Health, Sword Health — are locked behind employer health plans. Three point four percent of eligible members actually use them. Maria doesn't qualify."

**0:40 — Our solution**
> "PT Form Coach runs in any browser, on any phone, with no install and no subscription. Your webcam watches you move. We use MediaPipe pose estimation to extract 33 joint landmarks per frame. In your first three reps, the system learns your baseline — your body, your range of motion, not a textbook. Every rep after that is judged against you."

**1:00 — The AI corrects you live**
> "When your knee caves inward, the joint turns red and you hear: 'Push your knees out.' In your language. In real time."

**1:10 — OCI makes it real**
> "Keypoints — never video — are stored in OCI Object Storage. Our rep quality classifier, trained on clinical PT datasets and deployed via OCI Model Deployment, scores each rep. The PT gets a dashboard: adherence, quality trends, flagged compensations — data that maps directly to remote therapeutic monitoring billing codes."

**1:30 — Who stays in control**
> "The AI never diagnoses. It flags. The PT decides. Human oversight is architectural, not an afterthought."

**1:45 — The roadmap**
> "Phase two: your doctor prescribes a reference video from a vetted library. The same pipeline runs on it. You train against a clinician-approved movement standard, not just your own baseline. Free. Open source. Browser-based. This is PT for Maria."

### Demo (2 min)

1. Open browser — no install, note the HTTPS URL
2. Show calibration screen — do 3 slow squats
3. Do a correct squat — skeleton overlay, green joints, no cue
4. Deliberately cave left knee — left knee turns red, voice fires "Push your knees out"
5. Show rep score card appearing (OCI model endpoint call)
6. Switch to PT dashboard — show session log, rep quality chart, flagged compensation
7. Toggle language to Spanish — do one rep, voice cue fires in Spanish

---

## OCI Services to Name in Demo

State these explicitly. Technicality criterion requires it.

| Service | What it does in your project |
|---|---|
| OCI Object Storage | Stores keypoint sequences per session (never video) |
| OCI Data Science | Trained the rep quality classifier on UI-PRMD dataset |
| OCI Model Deployment | Serves the classifier as a REST endpoint, called per rep |
| OCI Generative AI | Generates plain-language, multilingual correction cues |
| Oracle 23ai Vector Search | Finds similar session patterns for PT trend analysis |
| OCI Compute | Hosts the FastAPI backend |

---

## Responsible AI Checklist (judges will ask)

- [ ] No video ever leaves the device or touches OCI
- [ ] No autonomous diagnosis or treatment decisions — the system flags, the PT decides
- [ ] Baseline is personal to each user — not a single-body-type standard
- [ ] Plain language output, not medical jargon
- [ ] Multilingual (English + Spanish minimum)
- [ ] WCAG-accessible UI (sufficient contrast, keyboard navigation, screen reader labels)
- [ ] Synthetic or de-identified data used for model training (UI-PRMD is public research data)
- [ ] PT retains prescription authority — exercises are prescribed, not self-selected

---

## Problem Validation Lines (for Q&A)

Judges will ask "have you talked to real users?" Have these ready:

- Hinge Health's own 2024 report: 3.4% of eligible members actively engaged
- The employer/insurer gating leaves out ~28 million uninsured Americans and most Medicaid patients
- RTM billing codes (CPT 98985, 98979) create direct financial incentive for clinics to adopt remote monitoring tools — this is a revenue enabler for HCA, not just a patient benefit
- UI-PRMD dataset: 10 PT exercises, 10 subjects, correct and incorrect reps — clinically grounded training data

---

## GitHub Repo (required for submission)

The hackathon requires a public repo with:
- [ ] Prototype code
- [ ] Setup instructions (`README.md`)
- [ ] Brief AI / OCI architecture explanation

Include in README:
- How to run locally
- OCI services used and why
- Dataset reference (UI-PRMD, arxiv link)
- Architecture diagram (copy from this doc)
- Team members and what each built

---

## Deployment Checklist

- [ ] Frontend: deploy to Vercel (`vercel deploy`) — gives you HTTPS automatically (required for webcam)
- [ ] Backend: deploy FastAPI to OCI Compute instance (Ubuntu, `uvicorn main:app`)
- [ ] OCI Object Storage bucket: create in OCI console, set up IAM policy for backend access
- [ ] OCI Model Deployment: deploy trained classifier from OCI Data Science notebook
- [ ] Test webcam access on HTTPS URL before demo — do not demo on localhost in front of judges
- [ ] Test on a phone — show judges it works on mobile as proof of the access equity claim

---

*Last updated: HackTN 2026, Oct 17–18 · Vanderbilt University*
