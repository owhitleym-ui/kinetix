# Kinetix — Implementation Brief (v3)

Verified against GitHub `owhitleym-ui/kinetix` **`main` @ `6f524f7`** ("Merge exercise library into main, after the warm-up", 2026-10-17 21:31). No newer commits on any branch at time of writing. If `main` has moved, re-check §2 before building.

Hand-off for implementing the finished wireframes in this repo. Read the whole file before writing code.

- **Design source:** the "Kinetix Wireframes" design canvas (claude.ai artifact `https://claude.ai/artifact/YPVHCU3NPc6cEwbWVfErG1`), page **Wireframes**. Ignore the **Style lab** page. Boards are referred to below by canvas title and file name (e.g. `PatientHome.dc.html`). If you can read the artifact, treat its markup as the visual spec; this brief is the functional spec and stands on its own if you can't.
- **Product:** Kinetix — patients practise their physical-therapy home exercises between visits with live, on-camera form feedback; their PT sees progress and approves AI-drafted plan changes.
- **This is a demo.** Realistic, fictional sample data. Real login exists in the repo (see §2) but the demo must also run with **no Oracle DB / OCI credentials** (seeded demo mode). Copy may say data is handled in accordance with HIPAA; don't build compliance machinery.

---

## 0. Before you start

1. The local checkout is already on **`main`**, fast-forwarded to `6f524f7`. Run `git pull` to pick up anything newer, then create a feature branch, e.g. `git checkout -b feature/kinetix-redesign`. (The old `v_REHAB24-6` branch is superseded; its warm-up work is already merged into `main`.) The repo is checked out on Windows: keep existing line endings, don't mass-convert CRLF/LF.
2. **Never push straight to `main`.** A GitHub Action (`.github/workflows/deploy-backend.yml`) auto-deploys `backend/` to the OCI server on every push to `main` that touches `backend/**` or `deploy.sh`, and the server hard-resets to `origin/main`. The frontend is also deployed (Vercel, `kinetix-six-drab.vercel.app`; `web/config.js` points it at the hosted backend). Open a PR; let the user merge.
3. Untracked `docs/KINETIX_BRIEF.md` (this file) can be committed on the branch.

---

## 1. Hard constraints

1. **Keep the warm-up screen exactly as it is** (`#warmupScreen` in `web/index.html`, the warm-up section of `web/app.js`, GIFs in `web/assets/warmups/cropped/`). The **only** change: its brand mark/name becomes the Kinetix star logo + "Kinetix" wordmark (§3). Do not restyle or re-copy it. You *may* change where its exit buttons lead (see §4 P2).
2. **Keep every existing feature working:** MediaPipe pose pipeline, setup gate, rep validation, mobility limits, trained classifiers (`features.js`) **and** joint-angle rule checks (`rules.js`), spoken cues + natural TTS (`naturalSpeak.js`, optional `voice-feedback/` server), voice commands (`#voiceCmd`), Ask-coach chat (`coach.js` + `speechInput.js`), set summary, ATP session/rep logging (`atpClient.js`), login/register/JWT (`auth.js` + `api/`), session sharing (`permissions.html`), and the **exercise library** (`catalog.js`: regions → exercises → session). Restyle UIs to the wireframe; don't change detection or scoring logic.
3. **Exercises:** only the 8 *available* exercises can appear in plans and seed data:
   - Trained classifier: `squat` (Bodyweight Squat), `arm_abduction` (Shoulder Abduction), `shoulder_extension` (Shoulder Extension, paced).
   - Joint-angle rules: `shoulder_abduction_full` (Shoulder Abduction AROM), `shoulder_adduction` (Shoulder Horizontal Adduction), `shoulder_external_rotation` (External Rotation at 90° Abduction), `shoulder_internal_rotation` (Internal Rotation at 90° Abduction), `arm_circles` (Shoulder Circumduction).
   - Shoulder exercises are right arm. "Coming soon" items in `catalog.js` stay unavailable. Use `catalog.js` names/targets/why text wherever an exercise is shown.
4. **Video never leaves the device.** Whatever the patient picks on the recording pop-up, do not upload frames. Store the *choice*; show "Recording · shared with {PT}" only as UI. (Existing code already uploads only rep results/features, never video — keep it that way.)
5. **Rename to "Kinetix"** in everything user-visible (titles, headers, login/register/permissions pages, landing, README heading, `package.json` description, FastAPI title/service name). Keep identifiers/env var names (`FORM_CHECK_API`, `FORM_CHECK_ATP`, `FORM_CHECK_TTS`) unless renaming is trivial and done everywhere, including `config.js` and deploy config.
6. **Don't break checks:** `npm test` (parity + sim + rules tests), `npm run mobility`, `tests/load_check.py`. Preserve the `?autostart`, `?test`, `?expected` URL params that skip the warm-up for the browser tests (update test selectors only if your routing changes the first screen).
7. **No frontend build step.** Vanilla JS + ES modules served statically (`npm run serve`, port 8801) and on Vercel. Ask the user before adding a framework or new dependencies.

---

## 2. Current codebase on `main` (what exists)

```
web/                      static app (npm run serve → http://127.0.0.1:8801; deployed on Vercel)
  index.html              markup + CSS: #warmupScreen, then <main id="coachApp"> containing
                          #accountNav, #viewRegions (library regions), #viewExercises (exercise list),
                          #viewSession (live form check: stage, counter, coach, log, set summary…)
  app.js                  camera loop, judging (classifier or rules), feedback, voice, coach, warm-up logic,
                          library views (showView), leaveWarmup() → library; ?autostart/test/expected skip warm-up
  catalog.js              REGIONS (shoulder / spine / lower) → exercises {ex, name, targets, why, tags, icon, soon}
  rules.js                joint-angle judging for rules_*.json models
  features.js, session.js trained-model features / setup gate, rep validation, MOBILITY
  sessionMemory.js        per-set log + context() for the coach
  coach.js                FastAPI client: fetchCue / fetchChat / fetchSummary (API_BASE = window.FORM_CHECK_API || :8000)
  atpClient.js            startAtpSession / logAtpRep → ATP API when a patient is logged in
  auth.js, auth.css       JWT in localStorage; login/register/me; renderAccountNav(); atpBase() (window.FORM_CHECK_ATP || :3001)
  login.html, register.html, permissions.html   separate auth pages (currently Inter font + blue — restyle)
  naturalSpeak.js         neural TTS client (window.FORM_CHECK_TTS, local :3002) with browser-voice fallback
  speechInput.js          mic / speech recognition
  config.js               sets FORM_CHECK_API for non-localhost (hosted backend), FORM_CHECK_TTS for localhost
  favicon.svg             Kinetix star
  models/                 pose_landmarker_full.task, rehab26_<ex>.json (3), rules_<ex>.json (5)
backend/                  FastAPI "coach" API (npm run serve:api → :8000; auto-deployed to OCI from main)
  main.py                 GET /health; POST /coach/cue, /coach/chat, /coach/summary; POST/GET /sessions
  oci_genai.py            OCI Generative AI with local template fallbacks (works with no OCI config)
  oci_storage.py          session logs → OCI Object Storage, else backend/data/sessions/ on disk
  .env.example            OCI_GENAI_*, OCI_NAMESPACE/BUCKET, API_PORT, CORS_ORIGINS (incl. the Vercel domain)
api/                      Express "ATP" API (npm run serve:atp → :3001) on Oracle Autonomous DB
  server.js               /health; /api/auth/register|login|me; /api/pts; /api/sessions (GET list, POST start,
                          POST :id/end, POST :id/share, DELETE :id/share/:ptUserId); /api/reps (log rep, bump goals)
  auth.js, db.js          JWT (requireAuth, requireRole 'patient'|'pt'), bcrypt; Oracle queries
  schema/001_auth_and_shares.sql  users (role patient|pt), patients.user_id, session_shares
                          (existing tables also used: patients, sessions, reps, goals, progress)
  migrate.js, storage.js  migrations; optional Object Storage upload of rep features
voice-feedback/           optional OpenAI-TTS proxy server (:3002) + design notes
training/, dataset/, tests/, scripts/   model training + tests (touch only to update selectors)
deploy.sh, .github/workflows/deploy-backend.yml   backend deploy to OCI on push to main
```

Key facts that shape the build:
- **Roles already exist**: `patient` and `pt` (the wireframe's "Provider" = `pt`).
- **PT visibility is per shared session today**: a PT only sees sessions a patient shared via `permissions.html`. The wireframe assumes a PT sees *their patients*. Bridge it as described in §6 (care-team link + auto-share), don't silently bypass sharing.
- Two backends: **FastAPI** = AI/coach + session logs; **Express/ATP** = accounts, sessions, reps, sharing, goals. The ATP API needs an Oracle wallet, so it won't be running for most demo viewers → demo mode (§6).

---

## 3. Design system — "Fresh Mint" (chosen)

**Type:** Plus Jakarta Sans 400/500/600/700/800 (Google Fonts) everywhere, including the restyled auth pages (replace Inter). Headings 800, −0.02em tracking; body 15–17px; no monospace/all-caps "terminal" labels.

**Colour tokens** (define once as CSS custom properties and reuse)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f6f8f7` | page background |
| `--panel` | `#ffffff` | cards |
| `--line` | `#e9eeeb` / `#e3e8e5` | borders, dividers |
| `--text` | `#14201a` | primary text |
| `--muted` | `#5f6b64` | secondary text |
| `--primary` | `#16a34a` | buttons, active nav, rings, done states |
| `--primary-ink` | `#166534` | text on mint |
| `--primary-soft` | `#e8f6ec` | warm-up block, done ticks, soft fills |
| `--accent` | `#3b82f6` | dates, secondary highlights |
| `--accent-ink` / `--accent-soft` | `#1e3a6e` / `#eaf2fe` | PT feedback card, privacy notes |
| `--sun` / `--sun-ink` | `#fde68a` / `#92400e` | greeting sun badge |
| `--alert` / `--alert-ink` / `--alert-soft` | `#e4572e` / `#a33a1a` / `#fdece6` | pain, warnings |
| `--warn` / `--warn-ink` / `--warn-soft` | `#f59e0b` / `#92400e` / `#fef3e2` | "needs work" reps, form errors, missed days |
| `--indigo` / `--indigo-soft` | `#4f63d2` / `#eef0fd` | second data series, deficits, "form slipping" |

**Shape:** cards radius 28px (24 small), inner tiles 16–22px, **all buttons and nav items are pills** (999px). Primary = solid green, white text, no glow. Secondary = white, 1.5px `--line` border. Card shadow `0 1px 2px rgba(0,0,0,.04)`. Touch targets ≥ 44px.

**Logo:** inline star-person SVG + "Kinetix" (800). ~36px in app headers, ~52px in the landing header, no background (same art as `web/favicon.svg`):
```html
<svg width="36" height="36" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.65 9.9L14.35 9.9L21.03 10.06L15.8 14.24L17.58 20.69L12 17L6.42 20.69L8.2 14.24L2.97 10.06Z" fill="#4ca154" stroke="#4ca154" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="5.4" r="2.8" fill="#306339"/></svg>
```

**Greeting:** 58px `--sun` circle with a sun icon, then the date (accent, 600) over "Good morning, {first name}". By local time: sun / sun-behind-cloud / moon with Good morning / afternoon / evening. On P1 and T1.

**Charts:** inline SVG, coloured, never plain black. Pain = coral line + soft fill; the PT's limit = thin faded dashed coral line + footer key "‑ ‑ Your limit (5)" (no red band). Form accuracy = indigo + amber with legend pills. Adherence = green bars (lighter under goal). Rings for summary stats.

**Plain language:** "9 in 10 reps looked good", not "91% accuracy". The library's clinical mistake names (e.g. "scapular elevation") can stay in provider views; patient views use plain cues ("Keep your shoulder down").

---

## 4. Screens, routes and behaviour

Routing: keep `web/index.html` as the app shell and add a tiny hash router with one ES module per view in `web/views/`; keep `#warmupScreen` and the existing `#viewRegions` / `#viewExercises` / `#viewSession` blocks (restyled) rather than rewriting them. Suggested routes:

| Board (canvas title / file) | Route | Role |
|---|---|---|
| Landing page / `Landing.dc.html` | `#/` | public |
| 0 · Sign in (pop-up) / `Main.dc.html` | `#/signin` (modal over landing) | public |
| P1 · Patient home / `PatientHome.dc.html` | `#/patient` | patient |
| P2 · Warm-up / `Warmup.dc.html` | existing `#warmupScreen` | patient |
| P3 · Recording choice (pop-up) / `RecordChoice.dc.html` | modal before camera | patient |
| P4 · Live form check / `FormCheck.dc.html` | existing `#viewSession`, restyled | patient |
| — Exercise library (existing, not on canvas) | existing `#viewRegions` / `#viewExercises` | patient |
| P5 · Session summary + check-in / `Summary.dc.html` | `#/patient/summary` | patient |
| P6 · Patient settings / `PatientSettings.dc.html` | `#/patient/settings` | patient |
| T1 · Provider caseload / `ProviderDashboard.dc.html` | `#/provider` | pt |
| T2 · Patient progress / `PatientDetail.dc.html` | `#/provider/patient/:id` | pt |
| T3 · AI plan review / `AIPlan.dc.html` | `#/provider/plan/:draftId` | pt |
| T4 · Provider settings / `ProviderSettings.dc.html` | `#/provider/settings` | pt |

Guard routes by role (from `auth.getUser()` or the demo session). `login.html` / `register.html` / `permissions.html`: restyle to Fresh Mint **or** redirect them into the new modal / P6 — keep their logic (`auth.js`) either way, since they're linked from elsewhere.

### Landing (public)
Top bar: logo, anchor links (How it works · For patients · For providers · Privacy), "Sign in" (secondary) + "Get started" (primary) → sign-in modal. Sections:
1. Pill "Physical therapy, between visits", H1 "Your PT's plan, coached at home.", sub-copy, CTAs "I'm a patient" / "I'm a provider" (open sign-in with that role preselected), note "Patients join with the invite code from their physical therapist." Right: composed mock (dark camera tile with skeleton + live cue pill, floating rep ring "6 of 10", PT note card).
2. How it works: 3 numbered cards with arrows — PT sets the plan → Practise with live feedback → Your plan adapts (AI drafts, PT approves).
3. For patients: 4 check-bullets + mini home mock (sun greeting, warm-up block, 3 rings).
4. For providers (mint band): sample "needs attention" cards + AI draft row; 4 bullets.
5. Privacy "Private by design": HIPAA line + 3 cards (your video, your choice · only your care team · a human always decides).
6. Green CTA band ("I have an invite code" / "For clinics") + footer. No invented stats or testimonials.

### 0 · Sign in (modal)
Centered card over the **blurred** landing (backdrop blur ~8px + dim), close X. "Welcome back / How do you use Kinetix?". Role radiogroup cards: Patient ("Practise my plan") / Provider ("Physical therapist"). Email, Password; Patient adds "Invite code from your PT (first time only)", Provider adds "Clinic". "Forgot password?" / "Create account" (→ register flow using `auth.register`). Footer: lock + "Your health information is private and handled in accordance with HIPAA."
**Behaviour:** if the ATP API is reachable, call `auth.login()`; the role comes from the account (warn if it doesn't match the chosen card). If it isn't reachable (or a "Use demo" link is clicked), sign in to **demo mode** as the seeded patient or PT for the chosen role.

### P1 · Patient home
Header: logo, nav pills (Today [active] · My progress · Messages), gear → P6, avatar (account menu: sign out). Keep a way to the library, e.g. a "Practise something else" link under the plan → `#viewRegions` (confirm placement with the user).
- Greeting row.
- **Today's plan** (wide card): "About 20 minutes". **Warm-up** as a separate soft-green block (no number) "9 gentle moves · 5 min · no camera needed" + "Start here". Down arrow "then your exercises". Exercise cards **numbered 1→N** in a row with → arrows; each: number badge, change tag pill ("↑ 2 more reps" mint · "Same" neutral · "Slower pace" blue), image (use `catalog.js` icon), name, dose ("3 sets of 12"). **Centered** pill "▶ Start today's session" → warm-up.
- Right: **one PT feedback card** (blue soft) — PT avatar, "From {PT}", "Updated your plan · N changes", PT message, white inner row "Stop and message me if pain goes above {limit} out of 10.", divider, "Next visit {date}" + "Message". All PT communication lives only here.
- **Your week**: M–S dots (done / today ring / rest), "3 of 5 sessions", mint row with ring "9 in 10 reps looked good this week. That's up from 8 last week."

### P2 · Warm-up (existing)
Unchanged except the logo. Exit routing: when started from **Today's plan**, Done/Skip → **P3** → P4 running the plan. When reached any other way (e.g. direct load), keep today's behaviour (→ library). Preserve `?autostart/test/expected`.

### P3 · Recording choice (modal)
Over a blurred P4 placeholder. Camera icon, "Before your camera turns on / Choose what happens to your video today." Radio cards: **Record and share with {PT}** ("…short clips of your reps… Only your care team can see them.") / **Don't save video** ("You still get live feedback. Video stays on this device and is never stored."). "Either way, your rep counts, form scores and check-ins are shared with {PT}." Shield note: "**Your privacy is protected.** All your health data, including any video, is encrypted and handled in accordance with HIPAA." + "Privacy details". Checkbox "Remember my choice (change any time in Settings)". "Turn on camera" → P4 · "Not now" → P1. Skip the modal if remembered and P6 "Ask me before each session" is off.

### P4 · Live form check (restyle `#viewSession`)
Header: logo, step pills for the plan's exercises (done "✓ Squat" mint · current dark · upcoming outlined, › between), "End session" → P5. Left: camera stage (existing video/canvas/overlays), top-left "● Recording · shared with {PT}" only if sharing, bottom-centre white pill with the live cue at ~24px. Below: Pause (green pill), "This hurts — stop" (alert-soft; ends session, pre-fills a high-pain check-in).
Right (~400px, readable from across the room): **big rep ring** (~250px, number ~84px, "of 10 reps"), "{Exercise} · Set 2 of 3"; 10 dots (green good / amber to fix / outlined remaining) + "5 good · 1 to fix" (replaces the long rep log by default); **"Focus on"** amber card with one large cue (~30px) + one line. Keep the existing controls (set size, mobility, source, voice, voice command, TTS status, coach chat/mic, full-screen, angle panel for rules exercises, set summary) available but secondary — e.g. a collapsible "Coach & settings" drawer — so the default view matches the board.
The plan drives exercise/sets/reps and auto-advances. Keep ATP logging (`startAtpSession` / `logAtpRep` / end) when logged in; in demo mode write to the demo store (§6).
When launched from the **library** (not a plan), run a single exercise as today, in the restyled layout, without the plan step pills.

### P5 · Session summary + check-in
"Back to Today". Hero: green check, "Session complete · {mins} min", "Nice work, {first}!".
Three equal stat cards: **Reps finished** ring ("84 of 86"); **Good form** = 10 **circles** (green/amber) + "**9 out of 10** reps looked good"; **Compared to last time** = Last time (grey) vs Today (green) bars + "One more good rep in every 10." "Tips for next time": per exercise (name, green/amber bar, one plain tip — can use `fetchSummary` tips).
Right "How did it feel?": **Pain** = 6-face scale (values 0/2/4/6/8/10, faces tinted green→red, "No pain … Worst pain"); **How hard was today?** = 3 faces Too easy / Just right / Too hard; optional note; if pain ≥ PT alert threshold show "{PT} will be told about this pain level right away."; "Send to my PT" → save check-in (+ share the session with their PT per §6) → P1.

### P6 · Patient settings
Section nav + cards: **Video & privacy** (same two radio cards as P3; "Ask me before each session"; "Download my data"; "Delete my recordings"; HIPAA note) · **Reminders** (switch, time, days) · **Accessibility** (Text size Default/Large/Extra large — really scales the UI; Spoken cues → existing voice toggle) · **My care team** (PT, clinic, next visit, Message, Add invite code; **session sharing** controls from `permissions.html` live here: auto-share with my PT on/off + per-session list) · **Account** (name, email, Sign out → landing, Delete account).

### T1 · Provider caseload
Header: logo + "Provider" pill, nav (Patients [active] · Plan drafts · Messages), gear → T4, avatar.
Greeting with sun: "Good morning, {PT}" + "{n} patients need you today." Right: "Invite patient" (search is **not** here).
**Needs your attention**: 3 equal cards — avatar, name, program/week, coloured reason box (Pain went up = alert · Missed N days = warn · Form is slipping = indigo) + detail, footer "AI plan draft ready"/"No draft" + dark "Review" pill → T2.
**All patients** card: header row "All patients · {n} active" with the **search pill at the right of that same row** (filters the list). Columns: Patient · Last session · How it's going (dot + plain status) · Plan ("Draft ready" chip or —) · chevron → T2. No KPI row, no upcoming visits, no sparklines.
Flags computed from data the PT is allowed to see: pain ≥ alert threshold in last 2 sessions, ≥ 3 days missed, or form accuracy dropping below threshold.

### T2 · Patient progress (prioritised bento)
Back, avatar, name, "condition · Week x of y · Next visit", "Edit plan" (secondary), "Review AI plan" (primary → T3).
**Alert banner** (alert-soft) when pain ≥ limit: "**Pain is above your limit.** Reported 5/10 in the last 2 sessions (was 2), mostly during shoulder extension." + "Message patient".
Grid 3 cols × 4 rows (~196px rows, 16px gap):
- **Reported pain** — cols 1–2, rows 1–2 (largest). "5/10 ↑ from 2", coral line + fill, faded dashed limit, footer key.
- **Form accuracy** — col 3, rows 1–2. Two series (indigo steady / amber dropping) + legend pills with value and trend word.
- **Health deficits** — col 1, rows 3–4. ROM / strength bars vs goal (indigo), "Function:" line, **Precautions** chips, "From clinic visit {date}".
- **Adherence** — col 2, row 3. Sessions/week vs goal 5.
- **Recent sessions** — col 2, row 4. 3 rows: day, note, form %, pain chip.
- **Common form errors** — col 3, rows 3–4. Mistake name (from the model/rules labels), count, amber bar, exercise, "Watch clips" (placeholder — no video is stored).

### T3 · AI plan review
Back, "Plan suggestion · week 3 → week 4", "Review {patient}'s next plan", "{n} of 3 reviewed".
Mint banner (sparkle): "**Drafted by AI from 12 sessions and 12 check-ins.** Nothing changes for the patient until you approve. Suggestions follow your limits: no progression while pain is above {limit}/10."
Suggestion cards: kind pill **Adjust** (coral) · **Keep** (neutral) · **Add** (mint) — never "Hold + adjust"; exercise; state; `from` (struck) → `to` (mint); **Why** bullets citing data; Accept / Edit (inline sets/reps/tempo/cue) / Dismiss.
Right: **Since last plan** as four **rings** (2×2): Sessions 12/14 (green) · Good form 83% (indigo) · Pain 5 "up from 2 · out of 10" (coral) · Effort smiley "Just right" (blue). **Message to patient** (AI-drafted, editable). "Approve & send plan" (grey until all decided) → new active plan + PT message for the patient → T1.

### T4 · Provider settings
**AI plan assistant** (on/off; "Suggest changes" Weekly / Every 5 sessions / Only when I ask; "Never suggest progressing when pain is above" stepper, default 4/10; "Biggest weekly change" +2 reps or +1 set; locked note "**Always requires your approval.** … This can't be turned off.") · **Alerts** (Pain at or above 5 → right away; Missed 3 days in a row; Form accuracy below 75%) · **Patient defaults** (Warm-up before every session; Ask patients to share video; Manage exercise library → the existing library, read-only for PTs) · **Profile & clinic** · **Security & privacy** (two-step sign-in, auto sign-out 15 min, access log, HIPAA note). These values drive T1 flags, the T2 banner, T3 rules and P1's pain reminder.

### Not designed (stub)
My progress, Messages, Invite patient, Edit plan (manual), Watch clips, Forgot password. Consistent "Coming soon in the demo" card in the app chrome, or a toast. Don't invent full screens.

---

## 5. Seed data (realistic, fictional)

One seed (e.g. `web/demo/seed.js` exporting JSON, mirrored by an optional ATP seed script `api/seed.js`). Dates relative to "today" so the demo never looks stale.

- **PT:** Dr. Maya Lee, DPT — Riverside Physical Therapy. AI pain limit 4; alert at ≥5. Caseload of 8.
- **Demo patient = the flagged patient** (so the loop is demoable): **Sam Rivera**, rotator cuff repair (right), week 3 of 8, next visit Tuesday. Plan: Warm-up 5 min · Bodyweight squat 3×12 (↑ from 3×10) · Shoulder abduction 3×10 (same) · Shoulder extension 2×8 slow (changed from 3×10). ~12 sessions over 3 weeks (5/4/4), pain 2,2,2,3,3,4,5,5; abduction form ~87–90% steady; extension 88% → 70%; errors: scapular elevation (shrugging) 14, lateral lean 9, too fast 7; notes "Tight on last set", "Felt fine". Deficits: shoulder flexion ROM 120° of 160°; external rotation strength 3+/5 of 5/5; function "can't reach overhead shelf; trouble sleeping on right side"; precautions "No lifting over 5 lb", "No behind-back reach until week 6".
- **Other patients** (plans only from the 8 available exercises): Priya Shah (frozen-shoulder rehab wk 6 — AROM + external rotation, ready to progress, draft ready) · Marcus Chen (post-op knee wk 2 — squat, missed 4 days) · Elena Torres (hip OA wk 8 — squat, form slipping: depth/lean) · Jordan Blake (shoulder impingement wk 4 — abduction + internal rotation, on track) · Aisha Nwosu (rotator cuff tendinopathy wk 5 — external rotation + circumduction, ready to progress, draft ready) · Tom Okafor (ACL rehab wk 10 — squat, on track) · Lily Park (shoulder stiffness wk 1 — circumduction + horizontal adduction, getting started).
- **AI drafts:** pending for Sam (Adjust extension 3×10 → 2×8 with 3 s lowering; Keep abduction + cue "Keep your body straight"; Add 1 min arm circles to the warm-up), plus progression drafts for Priya and Aisha.

Session shape should mirror `sessionMemory.context()` / the ATP `reps` rows (rep number, counted, verdict, mistake, cue) plus check-in `{pain 0–10, effort: too_easy|just_right|too_hard, note}` and `video_choice`.

---

## 6. Data, backends and demo mode

### Who owns what
- **ATP API (`api/`, Express + Oracle)** — system of record when configured: users/roles, patients, sessions, reps, sharing, goals. **Extend it** with a new migration `api/schema/002_kinetix.sql` (run via `migrate.js`) for what the wireframe needs:
  - `care_team` (patient_user_id, pt_user_id, invite_code, linked_at) — set by the invite code at sign-up/P6.
  - `plans` / `plan_items` (patient, version, status active|superseded, items: exercise, sets, reps, tempo, cue, change_tag, order) + `pt_messages`.
  - `checkins` (session_id, pain, effort, note, created_at).
  - `clinical_profile` (patient: condition, week, total_weeks, next_visit, deficits JSON, precautions JSON, function_note).
  - `ai_drafts` / `ai_suggestions` (kind adjust|keep|add, from/to JSON, why JSON, state, edits) .
  - `settings` (user_id, JSON) for P6/T4.
  - New endpoints (all `requireAuth` + role checks): `GET /api/me/plan`, `GET /api/caseload` (pt), `GET /api/patients/:id/overview` (pt, care-team only), `POST /api/checkins`, `GET/POST /api/drafts`, `POST /api/drafts/:id/decide`, `POST /api/drafts/:id/approve`, `GET/PUT /api/settings`, `POST /api/care-team/link`.
  - **Sharing bridge:** keep `session_shares`. When a patient is linked to a PT and "auto-share with my PT" is on (default on, editable in P6), share each new session with that PT automatically. PT views read only shared sessions + care-team profile/plan. Don't remove per-session revoke.
- **FastAPI (`backend/`)** — AI only (it auto-deploys, keep changes small and backward compatible): keep `/coach/*` and `/sessions`; add `POST /coach/plan-suggestions` that takes a patient history payload + PT settings and returns `{suggestions[], since_last_plan, patient_message, source}`. Implement the **rules engine** there (deterministic, always works) and use OCI GenAI (`oci_genai.py` pattern with a local template fallback) only to phrase `why` text and the patient message. Add the Vercel/local origins to CORS if needed.

### Demo mode (must work with no DB, no OCI, no TTS server)
- A small data layer `web/data.js` with one interface (`getPlan`, `saveSession`, `saveCheckin`, `getCaseload`, `getPatientOverview`, `getDrafts`, `decideSuggestion`, `approveDraft`, `getSettings`, `saveSettings`, …) and two implementations: **ATP** (uses `auth.api`) and **Demo** (seeded, persisted in `localStorage`, with "Reset demo data" in both settings screens).
- Pick ATP when a JWT exists and `/health` on the ATP base responds; otherwise Demo. Sign-in modal offers "Continue with demo account" for each role.
- AI drafts: call FastAPI `/coach/plan-suggestions`; if it's unreachable, run the same rules client-side (share the rule table as JSON or port it) so T3 always has content.
- Live sessions in Demo mode append real results to the demo store so P5, T1 and T2 reflect what was just done.

### AI plan rules (use PT settings)
- Pain in last 2 sessions > AI pain limit → **never progress**; for the painful exercise → **Adjust** (−1 set and −2 reps and/or slower tempo); cite pain trend + related mistakes.
- ≥ 85% good reps for the last 5 sessions **and** pain ≤ 2 **and** effort ≠ too hard → progress by at most the weekly cap (+2 reps or +1 set).
- One dominant mistake with stable pain → **Keep** dose + add a cue.
- Repeated tightness/stiffness notes → **Add** a gentle mobility item (e.g. Shoulder Circumduction) to the warm-up/plan.
- Missed ≥ 3 days → no dose change; suggest a check-in message.
- Every suggestion carries `why[]`. Nothing reaches the patient until the PT approves.

---

## 7. End-to-end demo script (acceptance)

1. Landing → "I'm a patient" → blurred sign-in modal → sign in (or demo) → **P1** shows Sam's plan, PT card, week.
2. Start today's session → **existing warm-up** (new logo only) → Done/Skip → **P3** video choice → **P4** runs the plan's exercises with the real engine (classifier or rules as appropriate) → End session → **P5** visual summary from real reps → pain faces + effort → Send to my PT → P1.
3. "Practise something else" still reaches the library and a single-exercise session works.
4. Sign out → sign in as Dr. Lee → **T1** shows Sam under "Needs your attention" with draft ready; search filters All patients.
5. Review → **T2** pain banner first; bento reflects the session just done.
6. Review AI plan → **T3** decide all, edit message → Approve & send → T1.
7. Back as Sam → P1 shows the new plan, change tags and the new PT message.
8. T4 pain limit change visibly changes T1 flags / T3 rules / P1 reminder. P6 text size + spoken-cue toggles work; sharing toggle respected.
9. Works fully in demo mode with only `npm run serve`; works against the ATP + FastAPI services when they're running.

---

## 8. Quality bar

- Matches the boards' layout, hierarchy, spacing and colours; responsive to phone width (cards stack, nav wraps, tables scroll horizontally, P4 camera above the big ring).
- Accessible: real `<button>`/`<a>`/`<label>`; radios/switches with roles + `aria-checked`; modals trap focus and close on Esc; icon buttons labelled; contrast ≥ 4.5:1; colour never the only signal.
- `prefers-reduced-motion` respected. No console errors on load. `npm test`, `npm run mobility`, `tests/load_check.py` pass.
- Update README (name, run both APIs + web, demo mode, demo accounts, reset) and `api/README.md` (new migration + endpoints). Never commit `.env`, wallets or keys.

## 9. Suggested build order
1. Branch from `main`. Tokens, logo, header component; rename to Kinetix; warm-up logo swap; restyle auth pages.
2. Hash router + role guards; landing + sign-in modal; `web/data.js` with Demo implementation + seed.
3. Patient: P1 → P2 exit routing → P3 → P4 restyle (plan mode + library mode) → P5 + check-ins → P6 (incl. sharing).
4. Provider: T1 → T2 → T3 (rules client-side first) → T4 settings wiring.
5. FastAPI `/coach/plan-suggestions` (rules + OCI wording) and ATP migration/endpoints + ATP data-layer implementation.
6. Stubs, responsive + accessibility pass, tests, READMEs. Commit per step; open a PR — don't push to `main`.
