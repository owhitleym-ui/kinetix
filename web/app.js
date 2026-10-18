// Live form check: webcam/video -> MediaPipe Pose (in the browser) -> setup gate (whole body in frame, start
// position, still) -> rep detection -> rep validation (complete, deliberate reps only) -> per-user calibration ->
// per-rep error classifier -> verdict + spoken cue.
import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";
import { Calibrator, classify, decide, makeSegmenter, repFeatures } from "./features.js";
import { MOBILITY, SetupGate, framing, rulesFor, validateRep } from "./session.js";
import * as sessionMemory from "./sessionMemory.js";
import { fetchChat, fetchSummary } from "./coach.js";
import { ensureMicPermission, listen as listenSpeech, supported as speechSupported } from "./speechInput.js";
import { speakNatural, stopNatural, ttsHealth, FEMALE_VOICE } from "./naturalSpeak.js";
import { startAtpSession, logAtpRep, endAtpSession } from "./atpClient.js";
import { judgeRules, ruleValues } from "./rules.js";
import { ARROW, REGIONS, findExercise, regionArt } from "./catalog.js";
import { currentUser, homeFor } from "./account.js";
import { getSettings, ptFor, saveSession, saveSettings } from "./data.js";
import { PLAIN, plainCue, plainLine } from "./exerciseText.js";
import { beginLibraryRun, clearRun, getRun, saveRun } from "./planRun.js";
import { go, onLeave, replace, route, showScreen, startRouter } from "./router.js";
import { esc as escHtml, logo, toast } from "./ui.js";
import { headerHTML, bindHeader } from "./views/chrome.js";
import { openRecordChoice } from "./views/recordChoice.js";
import { applyUserPrefs } from "./views/index.js";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const POSE_MODEL = "models/pose_landmarker_full.task";
const EXERCISES = ["squat", "arm_abduction", "shoulder_extension", "shoulder_abduction_full", "shoulder_adduction",
  "shoulder_external_rotation", "shoulder_internal_rotation", "arm_circles"];
// Trained classifiers (REHAB26) for the first three; rule checks with clinical thresholds for the rest.
const MODEL_FILE = (ex) => (["squat", "arm_abduction", "shoulder_extension"].includes(ex) ? `models/rehab26_${ex}.json` : `models/rules_${ex}.json`);
const HOWTO = {
  squat: "<b>Bodyweight Squat.</b> Stand facing the camera, far enough back that your <b>whole body, head to feet</b>, is in the frame. Hold still until it says <b>Go</b>, then squat down and stand all the way back up for each rep.",
  arm_abduction: "<b>Shoulder Abduction.</b> Stand facing the camera with your <b>whole body, head to feet</b>, in the frame and your right arm by your side. Hold still until it says <b>Go</b>, then raise your <b>right</b> arm out to the side and bring it all the way back down for each rep.",
  shoulder_extension: "<b>Shoulder Extension.</b> Stand facing the camera with your <b>whole body, head to feet</b>, in the frame and your right arm by your side. After <b>Go</b>, each time you hear <b>“Back”</b>, move your <b>right</b> arm straight back behind you and return before the next cue.",
  shoulder_abduction_full: "<b>Shoulder Abduction AROM</b> (active range of motion). Stand facing the camera, <b>whole body in the frame</b>, right arm by your side. After <b>Go</b>, raise your <b>straight right arm</b> out to the side and all the way up beside your ear, then lower it.",
  shoulder_adduction: "<b>Shoulder Horizontal Adduction.</b> Stand facing the camera, <b>whole body in the frame</b>, right arm by your side. After <b>Go</b>, swing your <b>straight right arm</b> across the front of your body toward your left side, then back.",
  shoulder_external_rotation: "<b>External Rotation at 90° Abduction.</b> Stand facing the camera, <b>whole body in the frame</b>. Lift your right elbow out to <b>shoulder height</b>, bent at a <b>right angle</b> with the forearm pointing forward. After <b>Go</b>, rotate the forearm <b>up</b> toward the ceiling, keeping the elbow where it is, then back.",
  shoulder_internal_rotation: "<b>Internal Rotation at 90° Abduction.</b> Stand facing the camera, <b>whole body in the frame</b>. Lift your right elbow out to <b>shoulder height</b>, bent at a <b>right angle</b> with the forearm pointing forward. After <b>Go</b>, rotate the forearm <b>down</b> toward the floor, keeping the elbow where it is, then back.",
  arm_circles: "<b>Shoulder Circumduction.</b> Stand facing the camera, <b>whole body in the frame</b>, right arm by your side. After <b>Go</b>, move your straight right arm in <b>large, slow circles</b>, reaching up overhead each time.",
};
const MOBILITY_NOTES = {
  slight: "<b>Slight mobility limits.</b> A slightly smaller range of motion counts, and small range issues are flagged less. Move only as far as is comfortable.",
  moderate: "<b>Moderate mobility limits.</b> A smaller range of motion counts, and only clear form problems are flagged. Move only as far as is comfortable.",
};
const mobilityNote = () => (MOBILITY_NOTES[mobility] ? `<br><br>${MOBILITY_NOTES[mobility]}` : "");
const CALIBRATE = "You get feedback on every rep. After your first few reps it also adapts to your body, which makes it more precise.";
const RULES_NOTE = "You get feedback on every rep: each one is measured against clinical range-of-motion targets, and the panel shows what was measured.";
const note = () => (model?.type === "rules" ? RULES_NOTE : CALIBRATE);

// Body-only skeleton (no face points).
const JOINT = { ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28, lt: 31, rt: 32 };
const BONES = [["ls", "rs"], ["ls", "le"], ["le", "lw"], ["rs", "re"], ["re", "rw"], ["neck", "pelvis"], ["pelvis", "lh"],
  ["pelvis", "rh"], ["lh", "lk"], ["lk", "la"], ["rh", "rk"], ["rk", "ra"], ["la", "lt"], ["ra", "rt"]];
const DOTS = ["ls", "rs", "le", "re", "lw", "rw", "neck", "pelvis", "lh", "rh", "lk", "rk", "la", "ra"];
// Which joints light up red for each mistake (same idea as main's SkeletonOverlay).
const HIGHLIGHT = {
  ERR_KNEES_INSIDE: ["lk", "rk", "la", "ra"],
  ERR_TORSO_TO_SIDE: ["ls", "rs", "lh", "rh", "neck", "pelvis"],
  ERR_SHALLOW_SQUAT: ["lh", "rh", "lk", "rk"],
  ERR_KNEES_FORWARD: ["lk", "rk", "la", "ra"],
  ERR_LIFTED_HEELS: ["la", "ra", "lt", "rt"],
  ERR_ARM_FORWARD: ["rs", "re", "rw"],
  ERR_ELEVATED_SHOULDER: ["rs", "ls", "neck"],
  ERR_HEAD_TO_SIDE: ["ls", "rs", "neck"],
  ERR_LOW_ABDUCTION: ["rs", "re", "rw"],
  ERR_BENT_ARM: ["rs", "re", "rw"],
  ERR_TORSO_FORWARD: ["ls", "rs", "lh", "rh", "neck", "pelvis"],
  ERR_TORSO_ROTATION: ["ls", "rs", "lh", "rh", "neck", "pelvis"],
  ERR_ARM_TO_SIDE: ["rs", "re", "rw"],
  // rule-check exercises
  ERR_LOW_RAISE: ["rs", "re", "rw"], ERR_BENT_ELBOW: ["rs", "re", "rw"], ERR_NOT_ACROSS: ["rs", "re", "rw"],
  ERR_LOW_ROTATION: ["rs", "re", "rw"], ERR_ELBOW_ANGLE: ["rs", "re", "rw"], ERR_ELBOW_DROP: ["rs", "re"],
  ERR_ELBOW_HIGH: ["rs", "re"], ERR_SMALL_CIRCLE: ["rs", "re", "rw"],
  ERR_TRUNK_LEAN: ["ls", "rs", "lh", "rh", "neck", "pelvis"],
};
const BONE_OK = "rgba(255,255,255,0.95)";
const BONE_BAD = "#ef4444";
const DOT_OK = "#ffffff";
const DOT_BAD = "#ef4444";
const HIGHLIGHT_MS = 3200;
// Joint angles drawn on the video: [label, a, b (vertex), c] as MediaPipe indices.
const ANGLES = {
  squat: [["Left knee", 23, 25, 27], ["Right knee", 24, 26, 28]],
  arm_abduction: [["Right shoulder", 24, 12, 14]],
  shoulder_extension: [["Right shoulder", 24, 12, 14]],
  shoulder_abduction_full: [["Right shoulder", 24, 12, 14]],
  shoulder_adduction: [["Right elbow", 12, 14, 16]],
  shoulder_external_rotation: [["Right elbow", 12, 14, 16], ["Right shoulder", 24, 12, 14]],
  shoulder_internal_rotation: [["Right elbow", 12, 14, 16], ["Right shoulder", 24, 12, 14]],
  arm_circles: [["Right shoulder", 24, 12, 14]],
};
const STEP = 5;   // angles are shown in 5° steps

const $ = (s) => document.querySelector(s);
// Optional URL parameters for quick tests: ?ex=squat&video=testvideos/clip.mp4&expected=CORRECT&autostart=1
const params = new URLSearchParams(location.search);
const TEST = params.has("test") || params.has("expected");   // testing aids + model details only in test mode
const video = $("#video"), canvas = $("#canvas"), ctx = canvas.getContext("2d");
const pageParams = new URLSearchParams(location.search);
// Coach greets this name at session start (?name=… overrides; otherwise the signed-in patient's first name).
const coachName = () => (pageParams.get("name") || currentUser()?.first || "Vaaisha").trim() || "Vaaisha";
let welcomeQuietUntil = 0;   // don't let setup prompts talk over the opening greeting
// Clear, professional names for what the model detects
const LABELS = {
  CORRECT: "Good form",
  ERR_KNEES_INSIDE: "Knee valgus", ERR_TORSO_TO_SIDE: "Lateral trunk lean", ERR_SHALLOW_SQUAT: "Insufficient squat depth",
  ERR_KNEES_FORWARD: "Excessive forward knee travel", ERR_LIFTED_HEELS: "Heel rise",
  ERR_ARM_FORWARD: "Forward arm drift", ERR_ELEVATED_SHOULDER: "Scapular elevation (shrug)", ERR_HEAD_TO_SIDE: "Lateral head tilt",
  ERR_LOW_ABDUCTION: "Limited abduction range", ERR_BENT_ARM: "Elbow not fully extended",
  ERR_TORSO_FORWARD: "Forward trunk lean", ERR_TORSO_ROTATION: "Trunk rotation", ERR_ARM_TO_SIDE: "Arm drifting into abduction",
};
const EX_TITLES = Object.fromEntries(REGIONS.flatMap((r) => r.exercises.map((e) => [e.ex, e.name])));
const nice = (code) => model?.names?.[code] || LABELS[code] || code.replace(/^ERR_/, "").toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const isRules = () => model?.type === "rules";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
let currentEx = EXERCISES[0], source = "webcam", setSizeVal = 10;
let mobility = "standard";
try { if (MOBILITY[localStorage.getItem("formcheck.mobility")]) mobility = localStorage.getItem("formcheck.mobility"); } catch (e) { /* storage blocked */ }
const rules = () => rulesFor(currentEx, mobility);
const cueFor = (label) => MOBILITY[mobility].cues[label] || model.cues[label];
const setSize = () => setSizeVal;

let landmarker, model, seg, cal, gate, stream, running = false, lastTime = -1;
let phase = "setup", outFrames = 0, repCount = 0, calAmps = [], chipTimer;
let facingHist = [], fpsT = [], tally = { n: 0, exact: 0, binary: 0 };
let smoothImg = null, shownAngle = {}, smoothAngle = {};
let highlightKeys = new Set(), highlightUntil = 0;

function setHighlight(label) {
  const keys = HIGHLIGHT[label];
  if (!keys?.length) { highlightKeys = new Set(); highlightUntil = 0; return; }
  highlightKeys = new Set(keys);
  highlightUntil = performance.now() + HIGHLIGHT_MS;
}
function clearHighlight() { highlightKeys = new Set(); highlightUntil = 0; }
function activeHighlight() {
  if (!highlightKeys.size || performance.now() > highlightUntil) {
    if (highlightKeys.size) clearHighlight();
    return null;
  }
  return highlightKeys;
}

// ---------- MediaPipe + model ----------
async function loadLandmarker() {
  if (landmarker) return landmarker;
  $("#status").textContent = "Loading MediaPipe…";
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: POSE_MODEL, delegate }, runningMode: "VIDEO", numPoses: 1 });
  try { landmarker = await PoseLandmarker.createFromOptions(fileset, opts("GPU")); }
  catch (e) { console.warn("GPU delegate failed, using CPU", e); landmarker = await PoseLandmarker.createFromOptions(fileset, opts("CPU")); }
  return landmarker;
}

async function loadModel(ex) {
  model = await (await fetch(MODEL_FILE(ex))).json();
  if (model.type === "rules") model.classes = ["CORRECT", ...Object.keys(model.names)];
  seg = makeSegmenter(model.segmenter);
  cal = new Calibrator(model.calibration ?? { reps: 3, window: 20 });   // rule checks don't calibrate
  gate = new SetupGate(rulesFor(ex, mobility));
  $("#howto").innerHTML = `${HOWTO[ex]}<br><br>${note()}${mobilityNote()}`;
  $("#expected").innerHTML = `<option value="">Not testing</option>` +
    model.classes.map((c) => `<option value="${c}">${esc(nice(c))}</option>`).join("");
  const m = model.metrics;
  $("#modelInfo").textContent = model.type === "rules"
    ? `${EX_TITLES[ex]}: rule checks with clinical thresholds (textbook range-of-motion norms and compensation limits), the ` +
      `joint-angle approach of Adarsh & Francis (NCECA 2026). Checks: ${model.checks.map((c) => c.label.toLowerCase()).join(", ")}. ` +
      `Tested on ${m.good_reps} reps from ${m.good_videos} videos that physiotherapists scored 90+ (MobiPhysio): ` +
      `${Math.round(m.good_reps_pass * 100)}% pass every check. Not trained on labeled mistakes, so which mistake is named isn't validated.`
    : `${EX_TITLES[ex]} model, trained on REHAB26-ViewAngles (${m.people} people, physiotherapist-labeled). ` +
      `Detects: ${model.classes.filter((c) => c !== "CORRECT").map((c) => nice(c).toLowerCase()).join(", ")}. ` +
      `On people it never saw, facing the camera: catches ${Math.round(m.mistakes_caught * 100)}% of mistakes, names the mistake ` +
      `right ${Math.round(m.mistakes_named_right * 100)}% of the time, leaves ${Math.round(m.good_left_alone * 100)}% of good reps alone.`;
  $("#angleLabel").textContent = model.segmenter.mode === "tempo" ? "Next cue" : ANGLES[ex][ANGLES[ex].length - 1][0];
  $("#angle").textContent = "–";
  shownAngle = {}; smoothAngle = {};
  currentEx = ex;
  const f = findExercise(ex);
  $("#sessRegion").textContent = f.item.tags.join(" · "); $("#backLabel").textContent = f.region.name;
  $("#exTitle").textContent = f.item.name; $("#exTarget").textContent = `Targets: ${f.item.targets}`;
  document.title = `${f.item.name} · Kinetix`;
  $("#modelInfo").hidden = !TEST;
}

// ---------- feedback UI ----------
// OpenAI neural TTS only (female voice). Queued so lines never overlap. No browser speechSynthesis.
function speak(text, { interrupt = false } = {}) {
  if (!$("#voice")?.checked) return;
  const line = String(text || "").trim();
  if (!line) return;
  return speakNatural(line, { voice: FEMALE_VOICE, interrupt });
}
function stopSpeak() { stopNatural(); }

const GOOD_EXTRAS = [
  "Keep it up!",
  "Nice work!",
  "That's the one — keep going!",
  "Looking strong!",
  "Great form — stay with it!",
  "You've got this — keep it up!",
];
let goodExtraIdx = 0;
function nextGoodExtra() {
  const line = GOOD_EXTRAS[goodExtraIdx % GOOD_EXTRAS.length];
  goodExtraIdx++;
  return line;
}

/** Friendly coaching sentences for spoken feedback (UI can still show short cues). */
const COACH_SAY = {
  ERR_KNEES_INSIDE: "You might want to push your knees out a bit more on the next rep, so they track over your toes.",
  ERR_KNEES_FORWARD: "Try sitting back into your hips a little more next time, so your knees stay behind your toes.",
  ERR_LIFTED_HEELS: "See if you can keep your heels planted on the floor for the next rep.",
  ERR_SHALLOW_SQUAT: "You might want to go a little deeper next rep — sit back until your thighs are near parallel.",
  ERR_TORSO_TO_SIDE: "Try to keep your torso centered next time — avoid leaning to one side.",
  ERR_ARM_FORWARD: "On the next rep, raise your arm out to the side in line with your body, not out in front.",
  ERR_BENT_ARM: "You might want to keep your elbow a bit straighter on the next rep.",
  ERR_ELEVATED_SHOULDER: "Try keeping that shoulder down next time — no shrug.",
  ERR_HEAD_TO_SIDE: "See if you can keep your head straight on the next rep, without tilting.",
  ERR_LOW_ABDUCTION: "You might want to lift your arm a little higher next time, at least to shoulder level.",
  ERR_ARM_TO_SIDE: "On the next rep, move your arm straight back, close to your body.",
  ERR_TORSO_FORWARD: "Try keeping your torso upright next time — avoid bending forward.",
  ERR_TORSO_ROTATION: "See if you can keep your chest facing forward on the next rep, without twisting.",
};

function coachSentence(label, fallbackCue) {
  if (COACH_SAY[label]) return COACH_SAY[label];
  if (fallbackCue) return `For the next rep, ${fallbackCue.charAt(0).toLowerCase()}${fallbackCue.slice(1).replace(/\.$/, "")}.`;
  return `You might want to adjust your form a little on the next rep.`;
}

function showCount(sub = "") {
  $("#countNum").textContent = repCount;
  $("#countOf").textContent = `/${setSize()}`;
  $("#countSub").textContent = sub;
  updateRepPanel();
}

// ---------- P4 rep panel: big ring, this set's dots, plain tally, "Focus on" ----------
let setDots = [];   // "g" good / "f" to fix, for the current set
const RING_LEN = 2 * Math.PI * 52;
function updateRepPanel() {
  const n = setSize(), c = Math.min(repCount, n);
  $("#ringFill").setAttribute("stroke-dasharray", `${(RING_LEN * c / n).toFixed(1)} ${RING_LEN.toFixed(1)}`);
  $("#ringFill").style.opacity = c ? 1 : 0;   // a round cap would show a dot at zero
  $("#ringNum").textContent = repCount; $("#ringOf").textContent = `of ${n} reps`;
  const g = setDots.filter((d) => d === "g").length, f = setDots.length - g;
  $("#bigRing").setAttribute("aria-label", `${repCount} of ${n} reps: ${g} good, ${f} to fix`);
  $("#repDots").innerHTML = Array.from({ length: Math.max(n, setDots.length) }, (_, i) => `<span class="${setDots[i] || ""}"></span>`).join("");
  $("#repTally").innerHTML = setDots.length ? `${g} good · <span class="fix">${f} to fix</span>` : "Let’s get started";
  const run = getRun(), it = run?.items[run.i];
  const name = it?.name || EX_TITLES[currentEx] || "";
  $("#setTitle").textContent = run?.fromPlan && it ? `${name} · Set ${run.set} of ${it.sets}` : name;
}
function setFocus(label) {
  const known = PLAIN[label];
  $("#focusCue").textContent = known ? plainCue(label) : (model?.short?.[label] || plainCue(label));
  $("#focusLine").textContent = plainLine(label);
}
function setFocusDefault(item) {
  $("#focusCue").textContent = item?.cue || (item?.tempo === "slow" ? "Go slow" : "Move slowly and with control");
  $("#focusLine").textContent = item?.tempo === "slow" ? "About 3 seconds on the way down." : "Smooth reps, all the way through.";
}
/** Count a rep (or a not-counted movement) toward the session in progress. */
function recordRep(kind, label, title) {
  const run = getRun(); if (!run) return;
  const r = run.results[run.i]; if (!r) return;
  if (kind === "skip") r.skip++;
  else {
    r.done++; r[kind === "good" ? "good" : "bad"]++;
    if (kind === "bad") {
      const m = r.mistakes.find((x) => x.code === label);
      if (m) m.n++; else r.mistakes.push({ code: label, title, n: 1 });
    }
  }
  saveRun(run);
}

function showChip(text, kind, ms = 3000) {   // fades in, holds, fades out; no flashing
  const chip = $("#chip");
  chip.textContent = text; chip.className = `chip ${kind} show`;
  clearTimeout(chipTimer); chipTimer = setTimeout(() => chip.classList.remove("show"), ms);
}

let lastSetupSpoken = "", lastSetupAt = 0;
function showSetup(g) {
  // say setup instructions out loud too (only when they change, at most every 2.5 s)
  // skip while the session-opening greeting is still playing
  if (performance.now() >= welcomeQuietUntil
      && g.title !== lastSetupSpoken && performance.now() - lastSetupAt > 2500) {
    speak(g.title === "Hold still" ? "Hold still" : `${g.title}. ${g.sub}`);
    lastSetupSpoken = g.title; lastSetupAt = performance.now();
  }
  $("#setup").hidden = false;
  $("#setupTitle").textContent = g.title; $("#setupSub").textContent = g.sub;
  $("#setupBar").style.width = `${Math.round((g.progress || 0) * 100)}%`;
}

function sessionWelcomeLine() {
  return `${coachName()}, how are you? Make sure you fit yourself in the screen so we can calibrate your movements. I'll start counting your reps whenever you're ready.`;
}
const hideSetup = () => { $("#setup").hidden = true; };

// ---------- per frame ----------
function onPose(res, t) {
  const img = res.landmarks[0].map((l) => [l.x, l.y, l.visibility ?? 1]);
  const P = res.worldLandmarks[0].map((l) => [l.x, l.y, l.z]);
  P.img = img; P.t = t; P.ok = framing(img).ok; P.aspect = (video.videoWidth || 16) / (video.videoHeight || 9);

  const hx = P[23][0] - P[24][0], hz = P[23][2] - P[24][2];
  facingHist.push(Math.atan2(Math.abs(hz), Math.abs(hx)) * 180 / Math.PI); if (facingHist.length > 30) facingHist.shift();
  const facing = median(facingHist);
  $("#facing").textContent = `${Math.round(facing / STEP) * STEP}°`;

  if (phase === "setup") {
    const g = gate.push(P, facing);
    showSetup(g);
    $("#state").textContent = "setting up";
    if (g.ready) {
      phase = "active"; outFrames = 0; seg.reset(); hideSetup(); lastSetupSpoken = "";
      showChip("Go!", "info", 1500); speak("Go");
      $("#state").textContent = "ready";
    }
    return;
  }

  // active: pause if the body leaves the frame for more than ~half a second
  outFrames = P.ok ? 0 : outFrames + 1;
  if (outFrames > 15) {
    phase = "setup"; seg.reset(); gate.reset();
    showSetup({ title: "Paused", sub: "Step back so your whole body is in the frame.", progress: 0 });
    speak("Paused. Step back into the frame.", { interrupt: true });
    return;
  }

  const rep = seg.push(P, t);
  if (model.segmenter.mode === "tempo") {
    if (seg.takeCue()) { speak(model.segmenter.cue, { interrupt: true }); showChip(model.segmenter.cue, "info", 1200); }
    $("#state").textContent = seg.inRep ? "move now" : "get ready";
    $("#angle").textContent = seg.value === null ? "–" : `${seg.value.toFixed(0)} s`;
  } else {
    $("#state").textContent = seg.inRep ? "in rep" : "at rest";
  }
  if (rep) onMovement(rep);
}

// A detected movement: count and assess it only if it is a complete, deliberate rep.
function onMovement(frames) {
  const v = validateRep(frames, seg, rules());
  if (!v.ok) {
    showChip(`Not counted · ${v.short}`, "muted", 3500);
    logRow("skip", "–", "Not counted", v.short, "");
    sessionMemory.pushSkip({ reason: v.reason, short: v.short });
    recordRep("skip");
    speak(`Not counted. ${v.reason}`);
    logAtpRep({
      repNumber: repCount + 1,
      counted: false,
      verdict: "NOT_COUNTED",
      mistake: v.reason,
      cue: v.short,
      exercise: model.exercise,
    });
    return;
  }
  repCount++;
  $("#status").textContent = "";

  // Feedback on every rep. Trained exercises: the early model (change from the rep's own start) until we know this
  // user's normal, then the calibrated model (compared with the user's own previous reps). Rule-check exercises: each
  // measured angle against its clinical limit; the most severe miss is named.
  const opts = MOBILITY[mobility];
  let out, ruleRows = null;
  if (isRules()) {
    const r = judgeRules(model, ruleValues(model, frames), mobility === "standard" ? null : opts);
    out = { label: r.label }; ruleRows = r.rows;
  } else {
    const x = repFeatures(frames, model.feature_set);
    out = cal.ready ? decide(model, classify(model, frames, cal.center(), x), opts) : decide(model.early, classify(model.early, frames), opts);
    learn(x, v.amp);
  }
  const good = out.label === "CORRECT", done = repCount === setSize();
  setDots.push(good ? "g" : "f");
  recordRep(good ? "good" : "bad", out.label, nice(out.label));
  if (!good) setFocus(out.label);
  showCount(done ? "set complete ✓" : "");
  showChip(good ? `✓ Good form${done ? " · set complete" : ""}` : `${model.short[out.label]}${done ? " · set complete" : ""}`, good ? "good" : "bad");
  if (good) clearHighlight(); else setHighlight(out.label);

  const expected = $("#expected").value;
  let tag = "";
  if (expected) {
    const exact = out.label === expected, binary = (out.label === "CORRECT") === (expected === "CORRECT");
    tally.n++; tally.exact += exact; tally.binary += binary;
    tag = `<span class="pill ${exact ? "ok" : "no"}">${exact ? "✓" : "✗ expected " + esc(nice(expected))}</span>`;
    $("#tally").textContent = `Test tally: exact ${tally.exact}/${tally.n} (${Math.round(100 * tally.exact / tally.n)}%), ` +
      `correct-vs-wrong ${tally.binary}/${tally.n} (${Math.round(100 * tally.binary / tally.n)}%)`;
  }
  const topProbs = out.probs ? Object.entries(out.probs).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([c, p]) => ({ label: c, title: nice(c), p: Math.round(p * 100) / 100 })) : [];
  const bars = ruleRows ? ruleRows.map((r) => {
    const f = (x) => (r.unit === "°" ? `${Math.round(x)}°` : x.toFixed(2));
    const target = r.lo != null && r.hi != null ? `${f(r.lo)}–${f(r.hi)}` : r.lo != null ? `≥ ${f(r.lo)}` : `≤ ${f(r.hi)}`;
    return `<div class="check ${r.ok ? "ok" : "no"}"><span>${r.ok ? "✓" : "✗"}</span><span>${esc(r.label)}</span><span>${f(r.value)}</span><span>target ${target}</span></div>`;
  }).join("") : Object.entries(out.probs).sort((a, b) => b[1] - a[1]).map(([c, p], i) =>
    `<div class="bar${i === 0 ? " top" : ""}"><span>${esc(nice(c))}</span><span><i style="width:${(p * 100).toFixed(0)}%"></i></span><span>${(p * 100).toFixed(0)}%</span></div>`).join("");
  const secs = ((frames[frames.length - 1].t - frames[0].t) / 1000).toFixed(1);
  const fixCue = good ? "Nice work. Keep it up." : (cueFor(out.label) || "");
  $("#latest").innerHTML = `<div class="rep-meta">Rep ${repCount} · ${secs} s</div>
    <div class="verdict" style="color:var(${good ? "--good-text" : "--bad-text"})">${esc(nice(out.label))}</div>
    <div class="cue">${esc(fixCue)}</div>${tag}
    <div class="rep-meta" style="margin:14px 0 8px">${ruleRows ? "Your measurements" : "Form breakdown"}</div><div class="bars">${bars}</div>`;
  logRow(good ? "good" : "bad", repCount, nice(out.label), good ? "" : model.short[out.label], tag || `${secs} s`);

  sessionMemory.pushRep({
    rep: repCount,
    label: out.label,
    title: nice(out.label),
    short: good ? "Good form" : (model.short[out.label] || ""),
    cue: fixCue,
    good,
    duration_s: Number(secs),
    top_probs: topProbs,
  });

  logAtpRep({
    repNumber: repCount,
    counted: true,
    verdict: good ? "CORRECT" : out.label,
    mistake: good ? null : out.label,
    cue: fixCue,
    exercise: model.exercise,
  });

  // Spoken coaching: natural sentences (not raw chip text). Queued so it won't overlap.
  // Session-complete summary is spoken separately after the last rep.
  const spoken = good
    ? `${repCount}. Good form. ${nextGoodExtra()}`
    : `${repCount}. ${coachSentence(out.label, fixCue)}`;
  speak(spoken);

  if (done) {
    if (getRun()?.fromPlan) planSetDone();
    else showSetSummary();
  }
}

// ---------- plan mode: sets, then the next exercise, then the summary ----------
function planSetDone() {
  const run = getRun(), it = run.items[run.i];
  if (run.set < it.sets) {
    run.set++; saveRun(run);
    setTimeout(() => { if (running) nextSet(); }, 2500);
  } else if (run.i < run.items.length - 1) {
    run.i++; run.set = 1; saveRun(run);
    speak(`Nice work. Next up: ${run.items[run.i].name}.`);
    setTimeout(() => { if (running) advanceExercise(); }, 3500);
  } else {
    speak("That’s your whole plan for today. Great work!");
    setTimeout(() => endSession(), 3000);
  }
}
function nextSet() {
  const run = getRun(), it = run.items[run.i];
  repCount = 0; setDots = []; phase = "setup"; outFrames = 0; seg.reset(); gate.reset(); lastSetupSpoken = "";
  showCount("get into position"); renderPlanSteps();
  showChip(`Set ${run.set} of ${it.sets}`, "info", 2500);
  speak(`Set ${run.set} of ${it.sets}. Get back into position.`);
}
async function advanceExercise() {
  const run = getRun(), it = run.items[run.i];
  stop();
  await loadModel(it.ex);
  usePlanItem(it);
  renderPlanSteps();
  await start({ quiet: true });
}
function usePlanItem(it) {
  setSizeVal = it.reps;
  pressed($("#setSizeSeg"), $(`#setSizeSeg [data-n="${it.reps}"]`));
  repCount = 0; setDots = [];
  setFocusDefault(it);
  showCount("");
}
function renderPlanSteps() {
  const ol = $("#planSteps"), run = getRun(); if (!ol || !run) return;
  ol.innerHTML = run.items.map((it, i) => {
    const cls = i < run.i ? "done" : i === run.i ? "current" : "";
    const label = i < run.i ? `✓ ${escHtml(it.name)}` : `${i + 1} · ${escHtml(it.name)}`;
    return `${i ? '<li class="sep" aria-hidden="true">›</li>' : ""}<li class="step ${cls}"${i === run.i ? ' aria-current="step"' : ""}>${label}</li>`;
  }).join("");
}

/** End the session: save what was counted (never video) and open the summary. */
async function endSession({ hurt = false } = {}) {
  const run = getRun();
  if (running || paused) stop();
  const user = currentUser();
  if (!run || user?.role !== "patient") {   // not signed in (tests, direct links): just stop
    $("#status").textContent = "Stopped.";
    return;
  }
  const total = run.results.reduce((t, r) => t + r.done, 0);
  if (!total && !hurt) { clearRun(); toast("No reps were counted, so nothing was saved."); go(run.fromPlan ? "#/patient" : "#/library"); return; }
  const startedAt = new Date(run.startedAt || Date.now());
  const s = saveSession({
    patientId: run.patientId, startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(),
    durationMin: Math.max(1, Math.round((Date.now() - startedAt) / 60000)), fromPlan: run.fromPlan,
    exercises: run.fromPlan ? run.results : run.results.filter((r) => r.done), videoChoice: run.videoChoice || "local",
    atpSessionIds: run.atpIds || [], checkin: null,
  });
  clearRun();
  go(`#/patient/summary?id=${encodeURIComponent(s.id)}${hurt ? "&hurt=1" : ""}`);
}

// Pause keeps the camera on but stops judging; resuming re-checks the start position.
let paused = false;
function togglePause() {
  if (!paused && !running) return;
  if (!paused) {
    paused = true; running = false; video.pause();
    $("#pauseBtn").textContent = "Resume";
    showChip("Paused", "muted", 600000); $("#state").textContent = "paused";
  } else {
    paused = false; seg.reset(); gate.reset(); phase = "setup"; outFrames = 0; lastTime = -1;
    $("#pauseBtn").textContent = "Pause"; $("#chip").classList.remove("show");
    video.play().then(() => { running = true; loop(); });
  }
}

// Rep log: one concise row per movement (newest first) + a running summary.
let logCounts = { good: 0, bad: 0, skip: 0 };
function logRow(kind, num, title, detail, meta) {
  logCounts[kind]++;
  $("#logEmpty").hidden = true;
  $("#history").insertAdjacentHTML("afterbegin",
    `<li class="${kind}"><span class="num">${num}</span><span class="what">${esc(title)}${detail ? `<small>${esc(detail)}</small>` : ""}</span>` +
    `<span class="meta">${meta}</span></li>`);
  const { good, bad, skip } = logCounts;
  $("#summary").innerHTML = `<span class="g">${good} good</span><span class="b">${bad} to fix</span>` + (skip ? `<span class="s">${skip} not counted</span>` : "");
}
function resetLog() {
  logCounts = { good: 0, bad: 0, skip: 0 };
  $("#history").innerHTML = ""; $("#summary").innerHTML = ""; $("#logEmpty").hidden = false;
}

// ---------- GenAI coach UI ----------
let cueRequestId = 0;
let chatHistory = [];
let micHandle = null;

function resetCoachUi() {
  chatHistory = [];
  cueRequestId++;
  const box = $("#coachMsgs");
  if (box) {
    box.innerHTML = `<div class="coach-msg system">Ask about your last rep, how many are left, or what to fix. Use the mic or type.</div>`;
  }
  const sum = $("#setSummary");
  if (sum) sum.hidden = true;
  $("#setSummaryBody").textContent = "";
  $("#setSummaryTips").innerHTML = "";
  if (micHandle) { micHandle.stop(); micHandle = null; }
  setVoiceCmdListening(false);
}

function appendCoachMsg(role, text) {
  const box = $("#coachMsgs");
  if (!box) return;
  const div = document.createElement("div");
  div.className = `coach-msg ${role}`;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function askCoach(raw) {
  const message = (raw || "").trim();
  if (!message) return;
  $("#coachInput").value = "";
  appendCoachMsg("user", message);
  chatHistory.push({ role: "user", content: message });
  $("#coachSend").disabled = true;
  const { reply } = await fetchChat({
    message,
    history: chatHistory.slice(-8),
    session_context: sessionMemory.context(),
  });
  $("#coachSend").disabled = false;
  appendCoachMsg("assistant", reply);
  chatHistory.push({ role: "assistant", content: reply });
  speak(reply);
}

function localSessionSummary(ctx) {
  const ex = ctx.exercise_title || "this exercise";
  const good = ctx.tallies?.good || 0;
  const bad = ctx.tallies?.bad || 0;
  const skip = ctx.tallies?.skip || 0;
  const target = ctx.reps_target || ctx.reps_done || 0;
  const done = ctx.reps_done || 0;

  const mistakeCounts = {};
  for (const r of ctx.reps || []) {
    if (r.good) continue;
    const key = r.title || r.short || r.label || "form issue";
    mistakeCounts[key] = (mistakeCounts[key] || 0) + 1;
  }
  const topMistakes = Object.entries(mistakeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, n]) => (n > 1 ? `${name} (${n} times)` : name));

  let spoken = `Session complete. You finished ${done} of ${target} ${ex} reps. `;
  spoken += `${good} looked good`;
  if (bad) spoken += `, and ${bad} need some work`;
  spoken += ".";
  if (skip) spoken += ` ${skip} movement${skip === 1 ? " wasn't" : "s weren't"} counted.`;
  if (topMistakes.length) {
    spoken += ` The main things to practice next time: ${topMistakes.join(", ")}.`;
  } else {
    spoken += " Great consistency — keep that form going next session.";
  }
  return spoken.trim();
}

async function showSetSummary() {
  const panel = $("#setSummary");
  const ctx = sessionMemory.context();
  const local = localSessionSummary(ctx); // always starts with "Session complete."

  if (panel) {
    panel.hidden = false;
    $("#setSummaryBody").textContent = "Writing your patient summary…";
    $("#setSummaryTips").innerHTML = "";
    const focusEl = $("#setSummaryFocus");
    if (focusEl) focusEl.innerHTML = "";
  }

  endAtpSession();

  let displaySummary = local;
  let tips = [];
  let spoken = local;
  let focus = [];
  let source = "local";
  try {
    const result = await fetchSummary(ctx);
    source = result.source || "local";
    if (result?.summary) displaySummary = result.summary;
    if (Array.isArray(result?.tips)) tips = result.tips;
    if (result?.spoken_summary) spoken = result.spoken_summary;
    else if (tips.length) spoken = `${local} Tips for next time: ${tips.slice(0, 3).join(". ")}.`;
    if (Array.isArray(result?.focus_areas)) focus = result.focus_areas;
  } catch { /* keep local summary */ }

  if (!String(spoken).toLowerCase().startsWith("session complete")) {
    spoken = `Session complete. ${spoken}`;
  }

  if (panel) {
    $("#setSummaryBody").textContent = displaySummary;
    $("#setSummaryTips").innerHTML = tips.map((t) => `<li>${esc(t)}</li>`).join("");
    const focusEl = $("#setSummaryFocus");
    if (focusEl) {
      focusEl.innerHTML = focus.length
        ? `<b>Focus next session:</b> ${focus.map((f) => esc(f)).join(" · ")}`
        : "";
    }
    const src = $("#setSummarySource");
    if (src) src.textContent = source === "oci" ? "Summary by OCI Generative AI" : "Summary (local)";
  }
  appendCoachMsg("assistant", spoken);
  speak(spoken); // queued after the last-rep cue
}

$("#coachForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  askCoach($("#coachInput").value);
});

function clearListeningHint() {
  const box = $("#coachMsgs");
  const last = box?.lastElementChild;
  if (last?.classList.contains("system") && /Listening|Requesting mic|Starting mic/i.test(last.textContent || "")) {
    last.remove();
  }
}

function stopMic() {
  if (micHandle) {
    try { micHandle.stop(); } catch { /* ignore */ }
    micHandle = null;
  }
  $("#coachMic")?.classList.remove("listening");
  $("#coachMic")?.setAttribute("aria-pressed", "false");
  clearListeningHint();
}

function micErrorMessage(err) {
  if (err === "aborted") return null;
  if (err === "no-speech") return "Didn't catch that — click the mic and speak clearly.";
  if (err === "not-allowed" || err === "service-not-allowed" || err === "no-media-devices") {
    return "Mic blocked — click the lock/tune icon in the address bar and allow Microphone for this site.";
  }
  if (err === "audio-capture") return "No microphone found. Check your input device in Windows settings.";
  if (err === "network") {
    return "Speech recognition needs internet (Chrome uses Google's speech service). Check your connection, or type instead.";
  }
  if (err === "unsupported") return "Speech recognition needs Chrome or Edge (not Firefox). Or type your question.";
  return `Mic error: ${err}`;
}

function setVoiceCmdListening(on) {
  $("#coachMic")?.classList.toggle("listening", on);
  $("#coachMic")?.setAttribute("aria-pressed", String(on));
  $("#voiceCmd")?.classList.toggle("listening", on);
  if ($("#voiceCmd")) $("#voiceCmd").textContent = on ? "Listening…" : "Voice command";
}

async function startVoiceCommand() {
  if (!speechSupported()) {
    appendCoachMsg("system", "Speech recognition needs Chrome or Edge. You can still type questions below.");
    $("#coachInput")?.focus();
    return;
  }
  if (micHandle) {
    stopMic();
    setVoiceCmdListening(false);
    return;
  }

  stopSpeak();
  setVoiceCmdListening(true);
  appendCoachMsg("system", "Requesting mic…");

  try {
    await ensureMicPermission();
  } catch (e) {
    stopMic();
    setVoiceCmdListening(false);
    const name = e?.name || "";
    const msg = (name === "NotAllowedError" || name === "SecurityError")
      ? micErrorMessage("not-allowed")
      : (name === "NotFoundError" ? micErrorMessage("audio-capture") : `Mic permission failed: ${e?.message || e}`);
    appendCoachMsg("system", msg);
    $("#coachInput")?.focus();
    return;
  }

  clearListeningHint();
  appendCoachMsg("system", "Listening… speak now.");

  const handle = listenSpeech({
    onInterim: (text) => {
      if (text) $("#coachInput").value = text;
    },
    onResult: (text) => {
      $("#coachInput").value = text;
      clearListeningHint();
      askCoach(text);
    },
    onError: (err) => {
      clearListeningHint();
      setVoiceCmdListening(false);
      const msg = micErrorMessage(err);
      if (msg) appendCoachMsg("system", msg);
      if (err === "network" || err === "not-allowed") $("#coachInput")?.focus();
    },
    onEnd: () => {
      micHandle = null;
      setVoiceCmdListening(false);
    },
  });

  if (!handle) {
    stopMic();
    setVoiceCmdListening(false);
    appendCoachMsg("system", micErrorMessage("unsupported"));
    return;
  }
  micHandle = handle;
}

$("#coachMic")?.addEventListener("click", () => startVoiceCommand());
$("#voiceCmd")?.addEventListener("click", () => startVoiceCommand());

// Show whether neural TTS proxy is up (Voice checkbox still gates speaking).
ttsHealth().then((h) => {
  const el = $("#ttsStatus");
  if (!el) return;
  if (h?.keyConfigured) el.textContent = "Natural voice ready";
  else if (h) el.textContent = "TTS proxy up — add OPENAI_API_KEY";
  else el.textContent = "Natural voice offline (browser voice fallback)";
});

// Learn this user's normal from their valid reps (silently). A rep much smaller than the others isn't used.
function learn(x, amp) {
  if (model.segmenter.mode !== "tempo" && amp != null && calAmps.length && amp < 0.6 * Math.max(...calAmps)) return;
  cal.add(x); calAmps.push(amp ?? 1); if (calAmps.length > model.calibration.window) calAmps.shift();
}

// ---------- drawing ----------
function draw(res, world) {
  if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!res.landmarks?.length) { smoothImg = null; return; }
  // display-only smoothing so the overlay doesn't jitter (analysis uses the raw landmarks)
  const raw = res.landmarks[0];
  smoothImg = raw.map((l, i) => {
    const s = smoothImg?.[i];
    return s ? { x: s.x + 0.45 * (l.x - s.x), y: s.y + 0.45 * (l.y - s.y), v: l.visibility ?? 1 } : { x: l.x, y: l.y, v: l.visibility ?? 1 };
  });
  const W = canvas.width, H = canvas.height;
  const scale = Math.min(canvas.clientWidth / W, canvas.clientHeight / H) || 1;
  const px = (n) => n / scale;                      // n screen pixels in canvas units
  const p = {};
  for (const [k, i] of Object.entries(JOINT)) p[k] = { x: smoothImg[i].x * W, y: smoothImg[i].y * H, v: smoothImg[i].v };
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });
  p.neck = mid(p.ls, p.rs); p.pelvis = mid(p.lh, p.rh);

  const bad = activeHighlight();
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = px(6);
  ctx.lineWidth = px(4.5);
  // Draw each bone separately so offending segments can turn red (like main SkeletonOverlay).
  for (const [a, b] of BONES) {
    if (p[a].v < 0.4 || p[b].v < 0.4) continue;
    const hot = bad && (bad.has(a) || bad.has(b));
    ctx.strokeStyle = hot ? BONE_BAD : BONE_OK;
    ctx.shadowColor = hot ? "rgba(239,68,68,0.45)" : "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.moveTo(p[a].x, p[a].y); ctx.lineTo(p[b].x, p[b].y);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  for (const k of DOTS) {
    if (p[k].v < 0.4) continue;
    const hot = bad && bad.has(k);
    ctx.beginPath();
    ctx.arc(p[k].x, p[k].y, px(hot ? 7.5 : 5.5), 0, 2 * Math.PI);
    ctx.fillStyle = hot ? DOT_BAD : DOT_OK;
    ctx.fill();
    if (hot) {
      ctx.strokeStyle = "rgba(239,68,68,0.4)";
      ctx.lineWidth = px(5);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = px(1.5);
      ctx.stroke();
    }
  }
  if (world && model) drawAngles(world, px, W, H);
  ctx.restore();
}

// Joint angle (3D, from world landmarks) shown at the joint with an arc; smoothed and stepped so it reads steadily.
function drawAngles(world, px, W, H) {
  const mirrored = $("#stage").classList.contains("mirror");
  for (const [label, a, b, c] of ANGLES[model.exercise]) {
    const vis = smoothImg[a].v > 0.5 && smoothImg[b].v > 0.5 && smoothImg[c].v > 0.5;
    if (!vis) continue;
    const asp = W / H, im = (i) => [smoothImg[i].x * asp, smoothImg[i].y, 0];
    const pt = isRules() ? im : (i) => world[i];   // rule exercises: image-plane angles, like the checks
    const u = pt(a).map((v, i) => v - pt(b)[i]), w = pt(c).map((v, i) => v - pt(b)[i]);
    const deg = Math.acos(Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1] + u[2] * w[2]) / (Math.hypot(...u) * Math.hypot(...w) + 1e-9)))) * 180 / Math.PI;
    smoothAngle[label] = smoothAngle[label] === undefined ? deg : smoothAngle[label] + 0.2 * (deg - smoothAngle[label]);
    const s = smoothAngle[label];
    // hysteresis: only move the shown value when the angle has really changed by most of a step
    if (shownAngle[label] === undefined || Math.abs(s - shownAngle[label]) >= STEP * 0.8) shownAngle[label] = Math.round(s / STEP) * STEP;
    const shown = shownAngle[label];

    const B = { x: smoothImg[b].x * W, y: smoothImg[b].y * H };
    const A = { x: smoothImg[a].x * W, y: smoothImg[a].y * H }, C = { x: smoothImg[c].x * W, y: smoothImg[c].y * H };
    const a1 = Math.atan2(A.y - B.y, A.x - B.x), a2 = Math.atan2(C.y - B.y, C.x - B.x);
    let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    ctx.strokeStyle = "rgba(134, 214, 150, 0.95)"; ctx.lineWidth = px(3);
    ctx.beginPath(); ctx.arc(B.x, B.y, px(26), a1, a1 + d, d < 0); ctx.stroke();

    // label sits beside the joint on the outside of the body, clear of the face and torso
    const centerX = (smoothImg[23].x + smoothImg[24].x) / 2 * W;
    const side = B.x >= centerX ? 1 : -1;
    const lx = B.x + side * px(52), ly = B.y + px(label.includes("knee") ? 0 : 14);
    const text = `${shown}°`;
    ctx.save();
    ctx.translate(lx, ly); if (mirrored) ctx.scale(-1, 1);   // keep text readable when the webcam view is mirrored
    ctx.font = `600 ${px(15)}px "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const tw = ctx.measureText(text).width, bw = tw + px(18), bh = px(26);
    ctx.fillStyle = "rgba(47, 129, 64, 0.94)";
    ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, px(13)); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, 0, px(1));
    ctx.restore();
    if (model.segmenter.mode !== "tempo" && label === ANGLES[model.exercise][ANGLES[model.exercise].length - 1][0])
      $("#angle").textContent = `${shown}°`;
  }
}

// ---------- loop ----------
function loop() {
  if (!running) return;
  if (video.readyState >= 2 && video.currentTime !== lastTime) {
    lastTime = video.currentTime;
    const now = performance.now();
    const res = landmarker.detectForVideo(video, now);
    fpsT.push(now); if (fpsT.length > 30) fpsT.shift();
    if (fpsT.length > 1) $("#fps").textContent = ((fpsT.length - 1) * 1000 / (fpsT[fpsT.length - 1] - fpsT[0])).toFixed(0);
    const world = res.worldLandmarks?.[0]?.map((l) => [l.x, l.y, l.z]);
    draw(res, world);
    const t = source === "file" ? video.currentTime * 1000 : now;  // follow the video's clock
    if (world) onPose(res, t);
  }
  if (source === "file" && video.ended) { stop(); $("#status").textContent = `Video finished: ${repCount} reps counted.`; return; }
  requestAnimationFrame(loop);
}

// Give the stage the video's own shape (portrait phone clips stay portrait), capped to the viewport height.
function fitStage() {
  const st = $("#stage"), ratio = (video.videoWidth || 16) / (video.videoHeight || 9);
  const cw = st.parentElement.clientWidth, h = Math.min(window.innerHeight * 0.72, cw / ratio);
  st.style.width = `${Math.round(h * ratio)}px`; st.style.height = `${Math.round(h)}px`; st.style.aspectRatio = "auto";
}
window.addEventListener("resize", () => { if (video.videoWidth) fitStage(); });

async function start({ quiet = false } = {}) {
  try {
    $("#start").disabled = true;
    paused = false;
    // Welcome plays only on the first Start of a session (click also unlocks audio in the browser).
    const welcome = sessionWelcomeLine();
    if (!quiet) {
      welcomeQuietUntil = performance.now() + 16000;
      speak(welcome, { interrupt: true });
    } else {
      const it = getRun()?.items[getRun().i];
      if (it) speak(`${it.name}. ${it.sets} set${it.sets === 1 ? "" : "s"} of ${it.reps}. Get into position.`, { interrupt: true });
    }
    await loadLandmarker();
    seg.reset(); gate.reset(); cal = new Calibrator(model.calibration ?? { reps: 3, window: 20 }); calAmps = [];
    phase = "setup"; outFrames = 0; repCount = 0; lastTime = -1; facingHist = []; smoothImg = null; shownAngle = {}; smoothAngle = {};
    setDots = [];
    clearHighlight();
    $("#latest").innerHTML = `<div class="muted">${note()}</div>`;
    showCount("get into position"); resetLog(); resetCoachUi();
    sessionMemory.start({ exercise: model.exercise, title: EX_TITLES[currentEx], target: setSize() });
    const run = getRun();
    if (run && !run.startedAt) { run.startedAt = Date.now(); saveRun(run); }
    const atpId = await startAtpSession(model.exercise);
    if (run && atpId) { const r = getRun(); r.atpIds = [...(r.atpIds || []), atpId]; saveRun(r); }
    lastSetupSpoken = ""; lastSetupAt = 0;
    $("#idle").hidden = true; $("#counter").hidden = false; $("#stage").classList.add("live");
    if (source === "webcam") {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" }, audio: false });
      video.srcObject = stream; $("#stage").classList.add("mirror");
    } else {
      const f = $("#file").files[0];
      if (!f && !params.get("video")) throw new Error("Choose a video file first.");
      video.srcObject = null; video.src = f ? URL.createObjectURL(f) : params.get("video"); $("#stage").classList.remove("mirror");
    }
    await video.play();
    fitStage();
    showSetup({ title: "Show your whole body", sub: "Step back until you're fully in the frame, head to feet.", progress: 0 });
    appendCoachMsg("system", welcome);
    running = true; $("#stop").disabled = false; $("#status").textContent = "";
    $("#start").hidden = true; $("#pauseBtn").hidden = false; $("#pauseBtn").textContent = "Pause";
    loop();
  } catch (e) {
    const blocked = e?.name === "NotAllowedError" || e?.name === "SecurityError";
    $("#status").textContent = blocked ? "Camera access is blocked. Allow the camera for this site, then press Start." : "Error: " + e.message;
    $("#start").disabled = false;
    if (!running) { $("#idle").hidden = false; $("#counter").hidden = true; $("#stage").classList.remove("live"); }
  }
}

function stop() {
  running = false; paused = false;
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
  video.pause();
  $("#start").disabled = false; $("#stop").disabled = true;
  $("#start").hidden = false; $("#pauseBtn").hidden = true;
  endAtpSession();
}

// A short, camera-free preparation sequence before the form check.
const WARMUP = [
  [60, "March in place", "Easy pace, small knee lifts, relaxed arms.", "warmups/cropped/march-in-place.gif"],
  [30, "Shoulder rolls", "Roll forward for 15 seconds, then reverse direction for 15 seconds.", "warmups/cropped/shoulder-rolls.gif"],
  [30, "Arm circles", "Make small circles and switch direction halfway through.", "warmups/cropped/arm-circles.gif"],
  [30, "Standing side bend", "Move slowly and gently, alternating sides.", "warmups/cropped/standing-side-bend.gif"],
  [30, "Hip circles", "Place your hands on your hips and switch direction halfway through.", "warmups/cropped/hip-circles.gif"],
  [30, "Knee circles", "Keep your knees slightly bent and make small circles.", "warmups/cropped/knee-circles.gif"],
  [40, "Ankle circles", "Circle one ankle for 20 seconds, then switch sides.", "warmups/cropped/ankle-circles.gif"],
  [30, "Calf raises", "Rise slowly onto your toes, then lower slowly with control.", "warmups/cropped/calf-raises.gif"],
  [20, "Breathe and reset", "Take a few slow, deep breaths, then start your home exercise program.", null],
];
const warmupPhase = (i) => (i === 0 ? "warm" : i <= 6 ? "mobilize" : "reset");
const WARMUP_PHASE_NAMES = { warm: "Get warm", mobilize: "Mobilize", reset: "Reset" };
const RING_C = 2 * Math.PI * 70;
const warmupTotal = WARMUP.reduce((sum, [seconds]) => sum + seconds, 0);
let warmupIndex = 0, warmupRemaining = WARMUP[0][0], warmupElapsed = 0, warmupRunning = false, warmupClock, warmupShown = -1;
const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>';

WARMUP.forEach(([seconds], i) => {
  const seg = document.createElement("span");
  seg.className = "warmup-seg"; seg.dataset.phase = warmupPhase(i); seg.style.flexGrow = seconds;
  seg.appendChild(document.createElement("i"));
  $("#warmupSegments").appendChild(seg);
});
$("#warmupRing").style.strokeDasharray = RING_C;

function renderWarmup() {
  const [duration, title, instruction, gif] = WARMUP[warmupIndex];
  const phase = warmupPhase(warmupIndex);
  const screen = $("#warmupScreen");
  screen.dataset.phase = phase;
  screen.classList.toggle("is-ending", warmupRunning && warmupRemaining <= 3);
  $("#warmupPhaseName").textContent = WARMUP_PHASE_NAMES[phase];
  $("#warmupPhase").textContent = warmupIndex + 1;
  $("#warmupElapsed").textContent = `${formatTime(warmupElapsed)} / ${formatTime(warmupTotal)}`;
  document.querySelectorAll(".warmup-seg i").forEach((fill, i) => {
    const pct = i < warmupIndex ? 100 : i > warmupIndex ? 0 : ((duration - warmupRemaining) / duration) * 100;
    fill.style.width = `${pct}%`;
  });

  // Only swap the text and illustration when the move changes, so the GIF doesn't restart every tick.
  if (warmupShown !== warmupIndex) {
    warmupShown = warmupIndex;
    $("#warmupTitle").textContent = title;
    $("#warmupInstruction").textContent = instruction;
    const img = $("#warmupGif");
    img.hidden = !gif; $("#warmupRest").hidden = !!gif;
    if (gif) { img.src = `assets/${gif}`; img.alt = `Animated illustration of ${title.toLowerCase()}`; }
    for (const el of [$("#warmupText"), gif ? img : $("#warmupRest")]) { el.classList.remove("warmup-swap"); void el.offsetWidth; el.classList.add("warmup-swap"); }
    const next = WARMUP[warmupIndex + 1];
    $("#warmupNextName").textContent = next ? next[1] : "Posture check";
    $("#warmupNextTime").textContent = next ? formatTime(next[0]) : "";
    $("#warmupNextThumb").innerHTML = next && next[3]
      ? `<img src="assets/${next[3]}" alt="">`
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    document.querySelectorAll(".warmup-step").forEach((step, i) => {
      step.dataset.state = i < warmupIndex ? "done" : i === warmupIndex ? "current" : "todo";
      step.setAttribute("aria-current", i === warmupIndex ? "step" : "false");
    });
  }
  if (!gif) $("#warmupBreath").textContent = warmupRunning ? ((duration - warmupRemaining) % 8 < 4 ? "Breathe in…" : "Breathe out…") : "Breathe in…";

  $("#warmupTime").textContent = formatTime(warmupRemaining);
  $("#warmupTimeLabel").textContent = warmupRunning ? "Left" : (warmupElapsed ? "Paused" : "Ready");
  $("#warmupRing").style.strokeDashoffset = RING_C * (1 - warmupRemaining / duration);
  $("#warmupStart").innerHTML = warmupRunning ? `${ICON_PAUSE}Pause` : `${ICON_PLAY}${warmupElapsed ? "Resume" : "Start warm-up"}`;
  $("#warmupNext").hidden = !warmupRunning;
}
function finishWarmup() {
  warmupRunning = false; clearInterval(warmupClock);
  const screen = $("#warmupScreen");
  screen.classList.remove("is-ending"); screen.classList.add("is-complete");
  const confetti = $("#warmupConfetti"); confetti.innerHTML = "";
  const colors = ["#16a34a", "#22c55e", "#86efac", "#15803d", "#bbf7d0"];
  for (let i = 0; i < 28; i++) {
    const bit = document.createElement("i");
    bit.style.left = `${Math.random() * 100}%`; bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = `${Math.random() * .6}s`;
    confetti.appendChild(bit);
  }
  $("#warmupContinue").focus();
}
function advanceWarmup() {
  warmupElapsed = WARMUP.slice(0, warmupIndex + 1).reduce((sum, [seconds]) => sum + seconds, 0);
  if (warmupIndex >= WARMUP.length - 1) return finishWarmup();
  warmupIndex++; warmupRemaining = WARMUP[warmupIndex][0]; renderWarmup();
}
function toggleWarmup() {
  warmupRunning = !warmupRunning;
  clearInterval(warmupClock);
  if (warmupRunning) {
    warmupClock = setInterval(() => {
      warmupRemaining--; warmupElapsed++;
      if (warmupRemaining <= 0) advanceWarmup();
      else renderWarmup();
    }, 1000);
  }
  renderWarmup();
}
function jumpToWarmup(index) {
  warmupIndex = index; warmupRemaining = WARMUP[index][0];
  warmupElapsed = WARMUP.slice(0, index).reduce((sum, [seconds]) => sum + seconds, 0);
  renderWarmup();
}
// Done / Skip: started from Today's plan -> recording choice -> the plan. Reached any other way -> the library.
function exitWarmup() {
  warmupRunning = false; clearInterval(warmupClock);
  go(getRun()?.fromPlan && currentUser()?.role === "patient" ? "#/patient/record" : "#/library");
}
$("#warmupStart").onclick = toggleWarmup;
$("#warmupNext").onclick = advanceWarmup;
$("#warmupSkip").onclick = exitWarmup;
$("#warmupContinue").onclick = exitWarmup;
$("#warmupRestart").onclick = () => { $("#warmupScreen").classList.remove("is-complete"); jumpToWarmup(0); };
document.querySelectorAll(".warmup-step").forEach((step) => step.addEventListener("click", () => jumpToWarmup(Number(step.dataset.warmupStep))));
document.addEventListener("keydown", (e) => {
  const screen = $("#warmupScreen");
  if (e.code !== "Space" || screen.hidden || screen.classList.contains("is-complete")) return;
  if (e.target.closest("button, input, select, textarea, [contenteditable]")) return;
  e.preventDefault(); toggleWarmup();
});
renderWarmup();

// ---------- exercise library: body region -> exercises -> session (#/<region>/<exercise>) ----------
function renderRegions() {
  $("#regions").innerHTML = REGIONS.map((r) => {
    const live = r.exercises.filter((e) => !e.soon).length, soon = r.exercises.length - live;
    const n = (k) => `${k} exercise${k === 1 ? "" : "s"}`;
    const count = live ? `${n(live)}${soon ? ` <span>· ${soon} coming soon</span>` : ""}` : `${n(soon)} <span>· coming soon</span>`;
    return `<button class="region" data-region="${r.id}"><span class="region-art">${regionArt(r.id)}</span>
      <span class="region-name">${esc(r.name)}</span><span class="region-desc">${esc(r.desc)}</span>
      <span class="region-foot"><span class="region-count">${count}</span><span class="go">${ARROW}</span></span></button>`;
  }).join("");
}
function renderExercises(r) {
  $("#coachApp").classList.toggle("read-only", currentUser()?.role === "pt");
  $("#regionBadge").innerHTML = regionArt(r.id);
  $("#regionTitle").textContent = r.name; $("#regionLede").textContent = r.lede;
  $("#exList").innerHTML = r.exercises.map((e) => `<button class="ex-card${e.soon ? " soon" : ""}" data-ex="${e.ex}"${e.soon ? ' aria-disabled="true" tabindex="-1"' : ""}>
      <span class="ex-icon">${e.icon}</span>
      <span class="ex-text"><span class="ex-top"><span class="ex-name">${esc(e.name)}</span>${e.soon ? '<span class="soon-tag">Coming soon</span>' : `<span class="start-tag">Start ${ARROW}</span>`}</span>
        <span class="ex-target">Targets: ${esc(e.targets)}</span><span class="ex-why">${esc(e.why)}</span>
        <span class="ex-meta">${e.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</span></span></button>`).join("");
}
const VIEWS = ["viewRegions", "viewExercises", "viewSession"];
const showView = (id) => VIEWS.forEach((v) => { $("#" + v).hidden = v !== id; });

// Header of the camera/library screen: the app header in the library; logo + plan steps + End session in a session.
function renderCoachHeader(kind) {
  const h = $("#coachHeader"), user = currentUser(), run = getRun();
  if (kind === "session") {
    h.innerHTML = `<header class="k-header"><div class="k-header-in"><a class="brand" href="${user ? homeFor(user) : "#/"}">${logo(36)}Kinetix</a>
      ${run?.fromPlan ? '<ol class="plan-steps" id="planSteps" aria-label="Today’s exercises"></ol>' : `<a href="#/library/${findExercise(currentEx)?.region.id || ""}" style="font-weight:700">Exercise library</a>`}
      <button type="button" class="link-btn" id="endSessionBtn" style="font-size:.9375rem;font-weight:800">End session</button></div></header>`;
    renderPlanSteps();
    $("#endSessionBtn").onclick = () => endSession();
  } else if (user) {
    h.innerHTML = headerHTML({ user, active: "" }); bindHeader(h);
  } else {
    h.innerHTML = `<header class="k-header"><div class="k-header-in"><a class="brand" href="#/">${logo(36)}Kinetix</a><a class="btn btn-secondary" href="#/signin">Sign in</a></div></header>`;
  }
}
function applySessionPrefs() {
  const user = currentUser();
  if (user?.role !== "patient") return;
  $("#voice").checked = getSettings(user.dataId).spokenCues !== false;
}
function showRecBadge(run) {
  const share = run?.videoChoice === "share";
  $("#recBadge").hidden = !share;
  if (share) $("#recText").textContent = `Recording · shared with ${ptFor(run.patientId)?.short || "your PT"}`;
}

// Exercise library: #/library -> #/library/<region> -> #/library/<region>/<exercise> (a single exercise, no plan)
async function libraryRoute({ params, user }) {
  showScreen("coach"); applyUserPrefs(user);
  $("#viewSession").classList.remove("plan-mode");
  const region = REGIONS.find((r) => r.id === params.region), found = params.ex ? findExercise(params.ex) : null;
  if (found && !found.item.soon && user?.role !== "pt") {
    if (found.item.ex !== currentEx || !model) { stop(); hideSetup(); await loadModel(found.item.ex); }
    if (!running) { beginLibraryRun(user?.dataId, found.item.ex, found.item.name, setSize()); setDots = []; repCount = 0; }
    renderCoachHeader("session"); applySessionPrefs(); showRecBadge(null); setFocusDefault(null); showCount("");
    showView("viewSession");
    document.title = `${found.item.name} · Kinetix`;
  } else {
    if (running) { stop(); $("#status").textContent = ""; }
    renderCoachHeader("library");
    if (region) { renderExercises(region); showView("viewExercises"); } else { $("#coachApp").classList.toggle("read-only", user?.role === "pt"); showView("viewRegions"); }
    document.title = "Exercise library · Kinetix";
  }
  window.scrollTo(0, 0);
}
const libraryOpts = { role: ["patient", "pt"], allowAnon: () => TEST || params.has("ex") || params.has("autostart") };
route("/library", libraryRoute, libraryOpts);
route("/library/:region", libraryRoute, libraryOpts);
route("/library/:region/:ex", libraryRoute, libraryOpts);

// P2 · warm-up (unchanged screen)
route("/patient/warmup", ({ user }) => {
  if (running) stop();
  showScreen("warmup"); applyUserPrefs(user);
  $("#warmupScreen").classList.remove("is-complete");
  if (!warmupRunning) jumpToWarmup(0);
  document.title = "Warm-up · Kinetix";
  window.scrollTo(0, 0);
  $("#warmupStart").focus({ preventScroll: true });
  onLeave(() => { if (warmupRunning) toggleWarmup(); });
}, { role: "patient" });

// P4 in plan mode: the plan's current exercise, ready to start.
async function prepPlanSession(run) {
  showScreen("coach"); applyUserPrefs(currentUser());
  const it = run.items[run.i];
  $("#viewSession").classList.add("plan-mode");
  if (it.ex !== currentEx || !model) { stop(); hideSetup(); await loadModel(it.ex); }
  if (!running) usePlanItem(it);
  renderCoachHeader("session"); applySessionPrefs(); showRecBadge(run);
  showView("viewSession");
  document.title = "Today’s session · Kinetix";
  window.scrollTo(0, 0);
}

// P3 · recording choice over the blurred session, then the camera starts.
route("/patient/record", async ({ user }) => {
  const run = getRun();
  if (!run?.fromPlan) { go("#/patient"); return; }
  await prepPlanSession(run);
  onLeave(() => { closeModal?.(); if (running || paused) stop(); });
  const pid = user.dataId, st = getSettings(pid);
  const proceed = (choice, remember) => {
    const r = getRun(); r.videoChoice = choice; saveRun(r);
    saveSettings(pid, remember ? { videoChoice: choice, askEachSession: false, rememberChoice: true } : { videoChoice: choice });
    replace("#/patient/session");
    showRecBadge(r);
    start();
  };
  let closeModal = null;
  if (st.askEachSession === false) { proceed(st.videoChoice, false); return; }
  closeModal = openRecordChoice({ ptName: ptFor(pid)?.short || "your PT", choice: st.videoChoice,
    onCamera: (c, rem) => { closeModal = null; proceed(c, rem); },
    onNotNow: () => { closeModal = null; clearRun(); go("#/patient"); } });
}, { role: "patient" });

route("/patient/session", async () => {
  const run = getRun();
  if (!run?.fromPlan) { go("#/patient"); return; }
  await prepPlanSession(run);
  onLeave(() => { if (running || paused) stop(); });
}, { role: "patient" });

$("#regions").addEventListener("click", (e) => { const b = e.target.closest(".region"); if (b) location.hash = `#/library/${b.dataset.region}`; });
$("#exList").addEventListener("click", (e) => {
  const b = e.target.closest(".ex-card"); if (!b || b.classList.contains("soon")) return;
  if (currentUser()?.role === "pt") { toast("The library is read-only for providers."); return; }
  location.hash = `#/library/${findExercise(b.dataset.ex).region.id}/${b.dataset.ex}`;
});
$("#backToRegions").onclick = () => { location.hash = "#/library"; };
$("#backToExercises").onclick = () => { location.hash = `#/library/${findExercise(currentEx).region.id}`; };
$("#pauseBtn").onclick = togglePause;
$("#hurtBtn").onclick = () => endSession({ hurt: true });
$("#voice").addEventListener("change", () => {
  const user = currentUser();
  if (user?.role === "patient") saveSettings(user.dataId, { spokenCues: $("#voice").checked });
});

// ---------- controls ----------
const pressed = (group, btn) => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
$("#setSizeSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  setSizeVal = Number(b.dataset.n); pressed($("#setSizeSeg"), b); showCount($("#countSub").textContent);
  const run = getRun();
  if (run) { run.items[run.i].reps = setSizeVal; run.results[run.i].reps = setSizeVal; run.results[run.i].target = run.items[run.i].sets * setSizeVal; saveRun(run); updateRepPanel(); }
});
function setSource(src) {
  source = src;
  pressed($("#sourceSeg"), $(`#sourceSeg [data-src="${src}"]`));
  $("#fileWrap").hidden = src !== "file";
}
$("#sourceSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setSource(b.dataset.src); });
$("#file").addEventListener("change", () => { $("#fileName").textContent = $("#file").files[0]?.name || "Choose a video…"; });
// Full screen: the video stage (with its overlays) fills the display. Button on the video, or press F; Esc exits.
const ICON_EXPAND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`;
const ICON_COLLAPSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>`;
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
function toggleFullscreen() {
  const st = $("#stage");
  if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (st.requestFullscreen || st.webkitRequestFullscreen).call(st);
}
function onFullscreenChange() {
  const on = !!fsElement();
  $("#fsBtn").innerHTML = on ? ICON_COLLAPSE : ICON_EXPAND;
  $("#fsBtn").setAttribute("aria-label", on ? "Exit full screen" : "Full screen");
  $("#fsBtn").title = on ? "Exit full screen (Esc)" : "Full screen (F)";
  if (!on && video.videoWidth) fitStage();
}
$("#fsBtn").innerHTML = ICON_EXPAND;
$("#fsBtn").onclick = toggleFullscreen;
document.addEventListener("fullscreenchange", onFullscreenChange);
document.addEventListener("webkitfullscreenchange", onFullscreenChange);
document.addEventListener("keydown", (e) => {
  if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.target.closest("input, select, textarea")
      && !$("#coachApp").hidden && !$("#viewSession").hidden && !document.querySelector(".modal-backdrop")) toggleFullscreen();
});

function setMobility(m) {
  if (m === "limited") m = "moderate";   // older saved names
  if (m === "small") m = "slight";
  mobility = MOBILITY[m] ? m : "standard";
  try { localStorage.setItem("formcheck.mobility", mobility); } catch (e) { /* storage blocked */ }
  pressed($("#mobilitySeg"), $(`#mobilitySeg [data-m="${mobility}"]`));
  if (gate) gate.rules = rulesFor(currentEx, mobility);   // applies right away, even mid-session
  if (model) $("#howto").innerHTML = `${HOWTO[currentEx]}<br><br>${note()}${mobilityNote()}`;
}
$("#mobilitySeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMobility(b.dataset.m); });

$("#start").onclick = start;
$("#stop").onclick = () => { stop(); $("#status").textContent = "Stopped."; };
$("#resetTally").onclick = () => { tally = { n: 0, exact: 0, binary: 0 }; $("#tally").textContent = ""; };

// ?ex=<exercise> opens that exercise's session directly (used by the tests); ?autostart / ?test / ?expected skip the
// landing and warm-up and go straight to the library.
const exParam = params.get("ex") && findExercise(params.get("ex"));
if (exParam && !exParam.item.soon) replace(`#/library/${exParam.region.id}/${exParam.item.ex}`);
else if ((params.get("autostart") || TEST) && !location.hash.startsWith("#/library")) replace("#/library");
renderRegions();
setFocusDefault(null);
if (TEST || params.get("autostart")) $("#coachDrawer").open = true;   // test aids + rep log visible
await startRouter();
setMobility(params.get("mobility") || mobility);
showCount("");
if (params.get("video")) { setSource("file"); $("#fileName").textContent = params.get("video").split("/").pop(); }
// The model detects the mistake type by itself. The "I'm doing…" selector is only a testing aid (?test=1).
$("#testWrap").hidden = !TEST; $("#resetTally").hidden = !TEST;
if (params.get("expected")) $("#expected").value = params.get("expected");
if (params.get("autostart")) start();

