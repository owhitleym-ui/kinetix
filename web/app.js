// Live form check: webcam/video -> MediaPipe Pose (in the browser) -> setup gate (whole body in frame, start
// position, still) -> rep detection -> rep validation (complete, deliberate reps only) -> per-user calibration ->
// per-rep error classifier -> verdict + spoken cue.
import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";
import { Calibrator, classify, decide, makeSegmenter, repFeatures } from "./features.js";
import { MOBILITY, SetupGate, framing, rulesFor, validateRep } from "./session.js";
import * as sessionMemory from "./sessionMemory.js";
import { fetchChat, fetchCue, fetchSummary } from "./coach.js";
import { ensureMicPermission, listen as listenSpeech, supported as speechSupported } from "./speechInput.js";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const POSE_MODEL = "models/pose_landmarker_full.task";
const EXERCISES = ["squat", "arm_abduction", "shoulder_extension"];
const HOWTO = {
  squat: "<b>Bodyweight Squat.</b> Stand facing the camera, far enough back that your <b>whole body, head to feet</b>, is in the frame. Hold still until it says <b>Go</b>, then squat down and stand all the way back up for each rep.",
  arm_abduction: "<b>Shoulder Abduction.</b> Stand facing the camera with your <b>whole body, head to feet</b>, in the frame and your right arm by your side. Hold still until it says <b>Go</b>, then raise your <b>right</b> arm out to the side and bring it all the way back down for each rep.",
  shoulder_extension: "<b>Shoulder Extension.</b> Stand facing the camera with your <b>whole body, head to feet</b>, in the frame and your right arm by your side. After <b>Go</b>, each time you hear <b>“Back”</b>, move your <b>right</b> arm straight back behind you and return before the next cue.",
};
const MOBILITY_NOTES = {
  slight: "<b>Slight mobility limits.</b> A slightly smaller range of motion counts, and small range issues are flagged less. Move only as far as is comfortable.",
  moderate: "<b>Moderate mobility limits.</b> A smaller range of motion counts, and only clear form problems are flagged. Move only as far as is comfortable.",
};
const mobilityNote = () => (MOBILITY_NOTES[mobility] ? `<br><br>${MOBILITY_NOTES[mobility]}` : "");
const CALIBRATE = "You get feedback on every rep. After your first few reps it also adapts to your body, which makes it more precise.";

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
};
const BONE_OK = "rgba(255,255,255,0.95)";
const BONE_BAD = "#ef4444";
const DOT_OK = "#ffffff";
const DOT_BAD = "#ef4444";
const HIGHLIGHT_MS = 3200;
// Joint angles drawn on the video: [label, a, b (vertex), c] as MediaPipe indices.
const ANGLES = {
  squat: [["L knee", 23, 25, 27], ["R knee", 24, 26, 28]],
  arm_abduction: [["R shoulder", 24, 12, 14]],
  shoulder_extension: [["R shoulder", 24, 12, 14]],
};
const STEP = 5;   // angles are shown in 5° steps

const $ = (s) => document.querySelector(s);
const video = $("#video"), canvas = $("#canvas"), ctx = canvas.getContext("2d");
// Clear, professional names for what the model detects
const LABELS = {
  CORRECT: "Good form",
  ERR_KNEES_INSIDE: "Knees caving in", ERR_TORSO_TO_SIDE: "Leaning to one side", ERR_SHALLOW_SQUAT: "Not deep enough",
  ERR_KNEES_FORWARD: "Knees past toes", ERR_LIFTED_HEELS: "Heels lifting",
  ERR_ARM_FORWARD: "Arm drifting forward", ERR_ELEVATED_SHOULDER: "Shoulder shrugging", ERR_HEAD_TO_SIDE: "Head tilting",
  ERR_LOW_ABDUCTION: "Arm not high enough", ERR_BENT_ARM: "Elbow bending",
  ERR_TORSO_FORWARD: "Leaning forward", ERR_TORSO_ROTATION: "Torso twisting", ERR_ARM_TO_SIDE: "Arm drifting out",
};
const EX_TITLES = { squat: "Bodyweight Squat", arm_abduction: "Shoulder Abduction", shoulder_extension: "Shoulder Extension" };
const nice = (code) => LABELS[code] || code.replace(/^ERR_/, "").toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
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
  model = await (await fetch(`models/rehab26_${ex}.json`)).json();
  seg = makeSegmenter(model.segmenter);
  cal = new Calibrator(model.calibration);
  gate = new SetupGate(rulesFor(ex, mobility));
  $("#howto").innerHTML = `${HOWTO[ex]}<br><br>${CALIBRATE}${mobilityNote()}`;
  $("#expected").innerHTML = `<option value="">Not testing</option>` +
    model.classes.map((c) => `<option value="${c}">${esc(nice(c))}</option>`).join("");
  const m = model.metrics;
  $("#modelInfo").textContent = `${EX_TITLES[ex]} model, trained on REHAB26-ViewAngles (${m.people} people, physiotherapist-labeled). ` +
    `Detects: ${model.classes.filter((c) => c !== "CORRECT").map((c) => nice(c).toLowerCase()).join(", ")}. ` +
    `On people it never saw, facing the camera: catches ${Math.round(m.mistakes_caught * 100)}% of mistakes, names the mistake ` +
    `right ${Math.round(m.mistakes_named_right * 100)}% of the time, leaves ${Math.round(m.good_left_alone * 100)}% of good reps alone.`;
  $("#angleLabel").textContent = model.segmenter.mode === "tempo" ? "Next cue" : ANGLES[ex][ANGLES[ex].length - 1][0];
  $("#angle").textContent = "–";
  shownAngle = {}; smoothAngle = {};
  currentEx = ex;
  document.querySelectorAll(".ex-card").forEach((c) => c.setAttribute("aria-checked", String(c.dataset.ex === ex)));
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
  P.img = img; P.t = t; P.ok = framing(img).ok;

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
    sessionMemory.pushSkip({ reason: v.reason, short: v.short });
    speak(`Not counted. ${v.reason}`);
    return;
  }
  repCount++;
  $("#status").textContent = "";

  // Feedback on every rep: the early model (change from the rep's own start) until we know this user's normal,
  // then the calibrated model (compared with the user's own previous reps). Both run automatically.
  const x = repFeatures(frames, model.feature_set);
  const opts = MOBILITY[mobility];
  const out = cal.ready ? decide(model, classify(model, frames, cal.center(), x), opts) : decide(model.early, classify(model.early, frames), opts);
  learn(x, v.amp);
  const good = out.label === "CORRECT", done = repCount === setSize();
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
  const topProbs = Object.entries(out.probs).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([c, p]) => ({ label: c, title: nice(c), p: Math.round(p * 100) / 100 }));
  const bars = Object.entries(out.probs).sort((a, b) => b[1] - a[1]).map(([c, p], i) =>
    `<div class="bar${i === 0 ? " top" : ""}"><span>${esc(nice(c))}</span><span><i style="width:${(p * 100).toFixed(0)}%"></i></span><span>${(p * 100).toFixed(0)}%</span></div>`).join("");
  const secs = ((frames[frames.length - 1].t - frames[0].t) / 1000).toFixed(1);
  const fixCue = good ? "Nice work. Keep it up." : (cueFor(out.label) || "");
  $("#latest").innerHTML = `<div class="rep-meta">Rep ${repCount} · ${secs} s</div>
    <div class="verdict" style="color:var(${good ? "--good-text" : "--bad-text"})">${esc(nice(out.label))}</div>
    <div class="cue">${esc(fixCue)}</div>${tag}
    <div class="rep-meta" style="margin:14px 0 8px">What the model saw</div><div class="bars">${bars}</div>`;
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

  // Spoken cue: GenAI paraphrase (≤10 words) with local fallback; UI stays on classifier copy.
  const cuePayload = {
    exercise: model.exercise,
    rep: repCount,
    label: out.label,
    short: good ? "Good form" : (model.short[out.label] || ""),
    cue: fixCue,
    good,
    probs: Object.fromEntries(topProbs.map((t) => [t.label, t.p])),
    reps_done: repCount,
    reps_target: setSize(),
  };
  const localSpoken = good
    ? `${repCount}. Good.${done ? " Set complete." : ""}`
    : `${repCount}. ${model.short[out.label]}.${done ? " Set complete." : ""}`;
  speak(localSpoken);
  const cueToken = ++cueRequestId;
  fetchCue(cuePayload).then((r) => {
    if (cueToken !== cueRequestId || !r.text || r.source === "local") return;
    // Upgrade spoken line if GenAI returned a short cue (skip if set already done — summary speaks next).
    if (!done) speak(`${repCount}. ${r.text}`);
  });

  if (done) showSetSummary();
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
  $("#coachMic")?.classList.remove("listening");
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

async function showSetSummary() {
  const panel = $("#setSummary");
  if (!panel) return;
  panel.hidden = false;
  $("#setSummaryBody").textContent = "Writing your summary…";
  $("#setSummaryTips").innerHTML = "";
  const result = await fetchSummary(sessionMemory.context());
  $("#setSummaryBody").textContent = result.summary;
  $("#setSummaryTips").innerHTML = (result.tips || []).map((t) => `<li>${esc(t)}</li>`).join("");
  const first = (result.summary || "").split(/(?<=[.!?])\s+/)[0];
  if (first) speak(first);
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

$("#coachMic")?.addEventListener("click", async () => {
  if (!speechSupported()) {
    appendCoachMsg("system", "Speech recognition needs Chrome or Edge. You can still type questions below.");
    $("#coachInput")?.focus();
    return;
  }
  if (micHandle) {
    stopMic();
    return;
  }

  try { synth?.cancel(); } catch { /* ignore */ }

  $("#coachMic").classList.add("listening");
  $("#coachMic").setAttribute("aria-pressed", "true");
  appendCoachMsg("system", "Requesting mic…");

  try {
    await ensureMicPermission();
  } catch (e) {
    stopMic();
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

  let gotFinal = false;
  const handle = listenSpeech({
    onInterim: (text) => {
      if (text) $("#coachInput").value = text;
    },
    onResult: (text) => {
      gotFinal = true;
      $("#coachInput").value = text;
      clearListeningHint();
      askCoach(text);
    },
    onError: (err) => {
      clearListeningHint();
      const msg = micErrorMessage(err);
      if (msg) appendCoachMsg("system", msg);
      if (err === "network" || err === "not-allowed") $("#coachInput")?.focus();
    },
    onEnd: () => {
      micHandle = null;
      $("#coachMic")?.classList.remove("listening");
      $("#coachMic")?.setAttribute("aria-pressed", "false");
    },
  });

  if (!handle) {
    stopMic();
    appendCoachMsg("system", micErrorMessage("unsupported"));
    return;
  }
  micHandle = handle;
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
    const u = world[a].map((v, i) => v - world[b][i]), w = world[c].map((v, i) => v - world[b][i]);
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
    ctx.strokeStyle = "rgba(96, 165, 250, 0.95)"; ctx.lineWidth = px(3);
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
    ctx.fillStyle = "rgba(37, 99, 235, 0.92)";
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
    seg.reset(); gate.reset(); cal = new Calibrator(model.calibration); calAmps = [];
    phase = "setup"; outFrames = 0; repCount = 0; lastTime = -1; facingHist = []; smoothImg = null; shownAngle = {}; smoothAngle = {};
    clearHighlight();
    $("#latest").innerHTML = `<div class="muted">${CALIBRATE}</div>`;
    showCount("get into position"); resetLog(); resetCoachUi();
    sessionMemory.start({ exercise: model.exercise, target: setSize() });
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

// ---------- controls ----------
const pressed = (group, btn) => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
document.querySelectorAll(".ex-card").forEach((card) => card.addEventListener("click", () => {
  if (card.dataset.ex === currentEx) return;
  stop(); hideSetup(); loadModel(card.dataset.ex);
}));
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
  if (model) $("#howto").innerHTML = `${HOWTO[currentEx]}<br><br>${CALIBRATE}${mobilityNote()}`;
}
$("#mobilitySeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMobility(b.dataset.m); });

$("#start").onclick = start;
$("#stop").onclick = () => { stop(); $("#status").textContent = "Stopped."; };
$("#resetTally").onclick = () => { tally = { n: 0, exact: 0, binary: 0 }; $("#tally").textContent = ""; };

// Optional URL parameters for quick tests: ?ex=squat&video=testvideos/clip.mp4&expected=CORRECT&autostart=1
const params = new URLSearchParams(location.search);
const ex0 = EXERCISES.includes(params.get("ex")) ? params.get("ex") : EXERCISES[0];
await loadModel(ex0);
setMobility(params.get("mobility") || mobility);
showCount("");
if (params.get("video")) { setSource("file"); $("#fileName").textContent = params.get("video").split("/").pop(); }
// The model detects the mistake type by itself. The "I'm doing…" selector is only a testing aid (?test=1).
const TEST = params.has("test") || params.has("expected");
$("#testWrap").hidden = !TEST; $("#resetTally").hidden = !TEST;
if (params.get("expected")) $("#expected").value = params.get("expected");
if (params.get("autostart")) start();
