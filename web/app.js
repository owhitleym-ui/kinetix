// Live form check: webcam/video -> MediaPipe Pose (in the browser) -> setup gate (whole body in frame, start
// position, still) -> rep detection -> rep validation (complete, deliberate reps only) -> per-user calibration ->
// per-rep error classifier -> verdict + spoken cue.
import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";
import { Calibrator, classify, decide, makeSegmenter, repFeatures } from "./features.js";
import { MOBILITY, SetupGate, framing, rulesFor, validateRep } from "./session.js";
import { judgeRules, ruleValues } from "./rules.js";
import { ARROW, REGIONS, findExercise, regionArt } from "./catalog.js";

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
// Voice. Chrome's speech engine has three failure modes that made it go quiet mid-session:
//  1. online ("Google …") voices cut out after a while  -> prefer an on-device voice (localService)
//  2. an utterance can be garbage-collected before it plays -> keep a reference until it ends
//  3. after many cancel() calls the engine can stay stuck "speaking" -> watchdog: cancel + resume if a line
//     hasn't finished well past its expected length
const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
let voicePick = null, current = null, startedAt = 0, pendingTimer = null;
function pickVoice() {
  const vs = synth ? synth.getVoices().filter((v) => /^en/i.test(v.lang)) : [];
  const local = vs.filter((v) => v.localService);
  voicePick = local.find((v) => /en[-_]US/i.test(v.lang) && /Samantha|Ava|Allison|Susan|Zira|Aria|Jenny/i.test(v.name))
    || local.find((v) => /en[-_]US/i.test(v.lang)) || local[0] || vs[0] || null;
}
if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }
function speak(text) {
  if (!synth || !$("#voice").checked) return;
  const u = new SpeechSynthesisUtterance(text);
  if (voicePick) { u.voice = voicePick; u.lang = voicePick.lang; } else u.lang = "en-US";
  u.rate = 1.05;
  u.onstart = () => { startedAt = performance.now(); };
  u.onend = u.onerror = () => { if (current === u) current = null; };
  clearTimeout(pendingTimer);
  const go = () => { current = u; startedAt = performance.now(); synth.resume(); synth.speak(u); };
  if (synth.speaking || synth.pending) { synth.cancel(); pendingTimer = setTimeout(go, 80); } else go();
}
// watchdog: a short line should finish within ~10 s; if the engine still claims to be busy, unstick it
setInterval(() => {
  if (synth && (synth.speaking || synth.pending) && performance.now() - startedAt > 10000) { synth.cancel(); synth.resume(); current = null; }
}, 2000);

function showCount(sub = "") {
  $("#countNum").textContent = repCount;
  $("#countOf").textContent = `/${setSize()}`;
  $("#countSub").textContent = sub;
}

function showChip(text, kind, ms = 3000) {   // fades in, holds, fades out; no flashing
  const chip = $("#chip");
  chip.textContent = text; chip.className = `chip ${kind} show`;
  clearTimeout(chipTimer); chipTimer = setTimeout(() => chip.classList.remove("show"), ms);
}

let lastSetupSpoken = "", lastSetupAt = 0;
function showSetup(g) {
  // say setup instructions out loud too (only when they change, at most every 2.5 s)
  if (g.title !== lastSetupSpoken && performance.now() - lastSetupAt > 2500) {
    speak(g.title === "Hold still" ? "Hold still" : `${g.title}. ${g.sub}`);
    lastSetupSpoken = g.title; lastSetupAt = performance.now();
  }
  $("#setup").hidden = false;
  $("#setupTitle").textContent = g.title; $("#setupSub").textContent = g.sub;
  $("#setupBar").style.width = `${Math.round((g.progress || 0) * 100)}%`;
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
    speak("Paused. Step back into the frame.", true);
    return;
  }

  const rep = seg.push(P, t);
  if (model.segmenter.mode === "tempo") {
    if (seg.takeCue()) { speak(model.segmenter.cue, true); showChip(model.segmenter.cue, "info", 1200); }
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
    speak(`Not counted. ${v.reason}`);
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
  showCount(done ? "set complete ✓" : "");
  showChip(good ? `✓ Good form${done ? " · set complete" : ""}` : `${model.short[out.label]}${done ? " · set complete" : ""}`, good ? "good" : "bad");

  const expected = $("#expected").value;
  let tag = "";
  if (expected) {
    const exact = out.label === expected, binary = (out.label === "CORRECT") === (expected === "CORRECT");
    tally.n++; tally.exact += exact; tally.binary += binary;
    tag = `<span class="pill ${exact ? "ok" : "no"}">${exact ? "✓" : "✗ expected " + esc(nice(expected))}</span>`;
    $("#tally").textContent = `Test tally: exact ${tally.exact}/${tally.n} (${Math.round(100 * tally.exact / tally.n)}%), ` +
      `correct-vs-wrong ${tally.binary}/${tally.n} (${Math.round(100 * tally.binary / tally.n)}%)`;
  }
  const bars = ruleRows ? ruleRows.map((r) => {
    const f = (x) => (r.unit === "°" ? `${Math.round(x)}°` : x.toFixed(2));
    const target = r.lo != null && r.hi != null ? `${f(r.lo)}–${f(r.hi)}` : r.lo != null ? `≥ ${f(r.lo)}` : `≤ ${f(r.hi)}`;
    return `<div class="check ${r.ok ? "ok" : "no"}"><span>${r.ok ? "✓" : "✗"}</span><span>${esc(r.label)}</span><span>${f(r.value)}</span><span>target ${target}</span></div>`;
  }).join("") : Object.entries(out.probs).sort((a, b) => b[1] - a[1]).map(([c, p], i) =>
    `<div class="bar${i === 0 ? " top" : ""}"><span>${esc(nice(c))}</span><span><i style="width:${(p * 100).toFixed(0)}%"></i></span><span>${(p * 100).toFixed(0)}%</span></div>`).join("");
  const secs = ((frames[frames.length - 1].t - frames[0].t) / 1000).toFixed(1);
  $("#latest").innerHTML = `<div class="rep-meta">Rep ${repCount} · ${secs} s</div>
    <div class="verdict" style="color:var(${good ? "--good-text" : "--bad-text"})">${esc(nice(out.label))}</div>
    <div class="cue">${good ? "Nice work. Keep it up." : esc(cueFor(out.label))}</div>${tag}
    <div class="rep-meta" style="margin:14px 0 8px">${ruleRows ? "Your measurements" : "Form breakdown"}</div><div class="bars">${bars}</div>`;
  logRow(good ? "good" : "bad", repCount, nice(out.label), good ? "" : model.short[out.label], tag || `${secs} s`);
  // spoken feedback every rep: the count + "good", or the mistake with how to fix it
  const how = model.segmenter.mode === "tempo" ? "" : ` ${cueFor(out.label)}`;   // tempo: keep it short before the next cue
  speak(good ? `${repCount}. Good.${done ? " Set complete." : ""}` : `${repCount}. ${model.short[out.label]}.${how}${done ? " Set complete." : ""}`);
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

  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = px(6);
  ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = px(4.5);
  ctx.beginPath();
  for (const [a, b] of BONES) {
    if (p[a].v < 0.4 || p[b].v < 0.4) continue;    // skip joints MediaPipe is guessing
    ctx.moveTo(p[a].x, p[a].y); ctx.lineTo(p[b].x, p[b].y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0; ctx.fillStyle = "#fff"; ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = px(1.5);
  for (const k of DOTS) {
    if (p[k].v < 0.4) continue;
    ctx.beginPath(); ctx.arc(p[k].x, p[k].y, px(5.5), 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
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

async function start() {
  try {
    $("#start").disabled = true;
    speak("Starting");                     // spoken inside the click, which also unlocks audio in the browser
    await loadLandmarker();
    seg.reset(); gate.reset(); cal = new Calibrator(model.calibration ?? { reps: 3, window: 20 }); calAmps = [];
    phase = "setup"; outFrames = 0; repCount = 0; lastTime = -1; facingHist = []; smoothImg = null; shownAngle = {}; smoothAngle = {};
    $("#latest").innerHTML = `<div class="muted">${note()}</div>`;
    showCount("get into position"); resetLog(); lastSetupSpoken = ""; lastSetupAt = 0;
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
    running = true; $("#stop").disabled = false; $("#status").textContent = "";
    loop();
  } catch (e) {
    $("#status").textContent = "Error: " + e.message; $("#start").disabled = false;
  }
}

function stop() {
  running = false;
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
  video.pause();
  $("#start").disabled = false; $("#stop").disabled = true;
}

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
async function route() {
  const [regionId, ex] = location.hash.replace(/^#\/?/, "").split("/");
  const region = REGIONS.find((r) => r.id === regionId), found = ex ? findExercise(ex) : null;
  if (found && !found.item.soon) {
    if (found.item.ex !== currentEx || !model) { stop(); hideSetup(); await loadModel(found.item.ex); }
    showView("viewSession");
  } else {
    if (running) { stop(); $("#status").textContent = ""; }
    if (region) { renderExercises(region); showView("viewExercises"); } else showView("viewRegions");
  }
  window.scrollTo(0, 0);
}
$("#regions").addEventListener("click", (e) => { const b = e.target.closest(".region"); if (b) location.hash = `#/${b.dataset.region}`; });
$("#exList").addEventListener("click", (e) => {
  const b = e.target.closest(".ex-card"); if (!b || b.classList.contains("soon")) return;
  location.hash = `#/${findExercise(b.dataset.ex).region.id}/${b.dataset.ex}`;
});
$("#backToRegions").onclick = () => { location.hash = "#/"; };
$("#backToExercises").onclick = () => { location.hash = `#/${findExercise(currentEx).region.id}`; };
window.addEventListener("hashchange", route);

// ---------- controls ----------
const pressed = (group, btn) => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
$("#setSizeSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  setSizeVal = Number(b.dataset.n); pressed($("#setSizeSeg"), b); showCount($("#countSub").textContent);
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
  if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey && !e.target.closest("input, select, textarea")) toggleFullscreen();
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

// ?ex=<exercise> opens that exercise's session directly (used by the tests)
const exParam = params.get("ex") && findExercise(params.get("ex"));
if (exParam && !exParam.item.soon) history.replaceState(null, "", `${location.pathname}${location.search}#/${exParam.region.id}/${exParam.item.ex}`);
renderRegions();
await route();
setMobility(params.get("mobility") || mobility);
showCount("");
if (params.get("video")) { setSource("file"); $("#fileName").textContent = params.get("video").split("/").pop(); }
// The model detects the mistake type by itself. The "I'm doing…" selector is only a testing aid (?test=1).
$("#testWrap").hidden = !TEST; $("#resetTally").hidden = !TEST;
if (params.get("expected")) $("#expected").value = params.get("expected");
if (params.get("autostart")) start();
