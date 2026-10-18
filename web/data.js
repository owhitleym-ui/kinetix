// One data interface for every Kinetix view, with two backends:
//  - ATP: the Express/Oracle API (auth.api) when a JWT exists and /health answers. Endpoints it doesn't have yet
//    (plans, check-ins, caseload, drafts, settings) fall back to the demo store, so nothing breaks.
//  - Demo: the seeded store in localStorage ("Reset demo data" in both settings screens rebuilds it).
import { api, getToken } from "./auth.js";
import { atpReachable, currentUser } from "./account.js";
import { buildSeed, defaultPatientSettings, defaultPtSettings } from "./demo/seed.js";
import { alertAt, patientFlags, patientStatus, planSuggestions, recentMistakes, runRules, sessionGood, summarizeProgress } from "./planRules.js";
import { exName } from "./exerciseText.js";

const KEY = "kinetix.demo.v1";
const DAY = 864e5;
const DATE_KEYS = new Set(["startedAt", "endedAt", "createdAt", "at", "nextVisit", "visitDate", "linkedAt", "decidedAt", "approvedAt", "readAt"]);
let db = null;

function shiftDates(node, ms) {   // keep the seeded story relative to today
  if (Array.isArray(node)) { node.forEach((n) => shiftDates(n, ms)); return; }
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    if (DATE_KEYS.has(k) && typeof v === "string" && !Number.isNaN(Date.parse(v))) node[k] = new Date(Date.parse(v) + ms).toISOString();
    else if (v && typeof v === "object") shiftDates(v, ms);
  }
}
function store() {
  if (db) return db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db || db.version !== 1) db = buildSeed();
  const days = Math.floor((Date.now() - Date.parse(db.seededAt)) / DAY);
  if (days >= 1) { shiftDates(db, days * DAY); db.seededAt = new Date(Date.parse(db.seededAt) + days * DAY).toISOString(); }
  save();
  return db;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked: keep in memory */ } }
export function resetDemo() { db = buildSeed(); save(); }

let modeCache = null;
/** "atp" or "demo" */
export async function dataMode() {
  if (modeCache) return modeCache;
  modeCache = getToken() && currentUser()?.mode === "atp" && (await atpReachable()) ? "atp" : "demo";
  return modeCache;
}
export function resetMode() { modeCache = null; }
async function viaAtp(path, opts, fallback) {
  if ((await dataMode()) !== "atp") return fallback();
  try { return await api(path, opts); } catch { return fallback(); }
}

// ---------- people ----------
export const users = () => store().users;
export const userRecord = (id) => store().users[id];
export const ptFor = (patientId) => store().users[store().careTeam[patientId]?.ptId] || null;
export const profileFor = (patientId) => store().profiles[patientId] || null;
export const careTeam = (patientId) => store().careTeam[patientId] || null;

// ---------- plans ----------
const plansOf = (pid) => store().plans[pid] || [];
export const activePlan = (pid) => plansOf(pid).find((p) => p.status === "active") || null;
function previousPlan(pid) {
  const act = activePlan(pid); if (!act) return null;
  return plansOf(pid).filter((p) => p.version < act.version).sort((a, b) => b.version - a.version)[0] || null;
}
/** Change tag for each plan item vs the previous version. */
export function changeTag(item, prev) {
  if (!prev) return { text: "New", cls: "mint" };
  if (item.reps > prev.reps && item.sets === prev.sets) return { text: `↑ ${item.reps - prev.reps} more reps`, cls: "mint" };
  if (item.sets > prev.sets) return { text: `↑ ${item.sets - prev.sets} more set${item.sets - prev.sets > 1 ? "s" : ""}`, cls: "mint" };
  if (item.tempo === "slow" && prev.tempo !== "slow") return { text: "Slower pace", cls: "blue" };
  if (item.sets < prev.sets || item.reps < prev.reps) return { text: "Fewer reps", cls: "blue" };
  if (item.cue && item.cue !== prev.cue) return { text: "New tip", cls: "blue" };
  return { text: "Same", cls: "white" };
}
export async function getPlan(pid) {
  const local = () => {
    const act = activePlan(pid), prev = previousPlan(pid);
    if (!act) return null;
    const items = act.items.map((it) => ({ ...it, name: exName(it.ex), tag: changeTag(it, prev?.items.find((p) => p.ex === it.ex)) }));
    return { ...act, items, changes: prev ? items.filter((i) => i.tag.text !== "Same").length : 0 };
  };
  const res = await viaAtp("/api/me/plan", {}, local);
  return res?.items ? res : local();
}

// ---------- sessions ----------
export function sessionsFor(pid, { forPt = null } = {}) {
  return store().sessions.filter((s) => s.patientId === pid && (!forPt || (s.sharedWith || []).includes(forPt)))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
export const getSession = (id) => store().sessions.find((s) => s.id === id) || null;
export function lastSession(pid) { const s = sessionsFor(pid); return s[s.length - 1] || null; }

/** Save a finished live session (reps already counted by the engine). Auto-shares with the PT when allowed. */
export function saveSession(rec) {
  const d = store();
  const pid = rec.patientId;
  const st = getSettings(pid);
  const pt = d.careTeam[pid]?.ptId;
  const s = { id: `s-${Date.now().toString(36)}`, sharedWith: st.autoShare !== false && pt ? [pt] : [], ...rec };
  d.sessions.push(s); save();
  return s;
}
export async function saveCheckin(sessionId, checkin) {
  const s = getSession(sessionId); if (!s) return null;
  s.checkin = { ...checkin, at: new Date().toISOString() }; save();
  await viaAtp("/api/checkins", { method: "POST", body: JSON.stringify({ sessionId: s.atpSessionIds?.[0] || sessionId, ...checkin }) }, () => null);
  return s;
}
export function setSessionShared(sessionId, ptId, on) {
  const s = getSession(sessionId); if (!s) return;
  const set = new Set(s.sharedWith || []); on ? set.add(ptId) : set.delete(ptId);
  s.sharedWith = [...set]; save();
}

// ---------- patient home ----------
export async function getPatientHome(pid) {
  const plan = await getPlan(pid);
  const pt = ptFor(pid), profile = profileFor(pid);
  const sessions = sessionsFor(pid);
  const ptSettings = pt ? getSettings(pt.id) : defaultPtSettings();
  const today = new Date(new Date().toDateString());
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today - (6 - i) * DAY);
    const done = sessions.some((s) => new Date(s.startedAt).toDateString() === d.toDateString());
    return { label: d.toLocaleDateString(undefined, { weekday: "narrow" }), full: d.toLocaleDateString(undefined, { weekday: "long" }), done, today: i === 6 };
  });
  const inRange = (from, to) => sessions.filter((s) => { const t = Date.parse(s.startedAt); return t >= from && t < to; });
  const thisWeek = inRange(+today - 6 * DAY, Date.now() + 1), lastWeek = inRange(+today - 13 * DAY, +today - 6 * DAY);
  const ratio = (ss) => { const g = ss.reduce((t, s) => t + s.exercises.reduce((a, e) => a + e.good, 0), 0), n = ss.reduce((t, s) => t + s.exercises.reduce((a, e) => a + e.done, 0), 0); return n ? g / n : null; };
  return { plan, pt, profile, week, sessionsThisWeek: thisWeek.length, goal: 5, goodThisWeek: ratio(thisWeek), goodLastWeek: ratio(lastWeek), alertAt: alertAt(ptSettings) };
}

// ---------- progress ----------
/** "My progress". ATP accounts send their own sessions (GET /api/me/sessions?detail=1, same shape as demo sessions);
 *  until that endpoint exists they fall back to the demo store like every other screen. */
export async function getProgress(pid) {
  const res = await viaAtp("/api/me/sessions?detail=1", {}, () => null);
  const sessions = Array.isArray(res?.sessions) ? res.sessions : sessionsFor(pid);
  const pt = ptFor(pid);
  return { ...summarizeProgress(sessions), pt, goal: 5, alertAt: alertAt(pt ? getSettings(pt.id) : defaultPtSettings()) };
}

// ---------- settings ----------
export function getSettings(userId) {
  const d = store(); const u = d.users[userId];
  const base = u?.role === "pt" ? defaultPtSettings() : defaultPatientSettings();
  return { ...base, ...(d.settings[userId] || {}) };
}
export function saveSettings(userId, patch) {
  const d = store();
  d.settings[userId] = { ...getSettings(userId), ...patch };
  save();
  viaAtp("/api/settings", { method: "PUT", body: JSON.stringify(d.settings[userId]) }, () => null);
  return d.settings[userId];
}

// ---------- provider: caseload, overview, drafts ----------
const draftId = (pid) => { const p = activePlan(pid); return p ? `${pid}.v${p.version}` : null; };
function sinceActive(pid, ptId) {
  const p = activePlan(pid);
  return sessionsFor(pid, { forPt: ptId }).filter((s) => !p || s.startedAt >= p.createdAt);
}
function localDraft(pid, ptId) {
  const id = draftId(pid); if (!id) return null;
  const st = store().drafts[id];
  if (st?.approvedAt) return null;
  const settings = getSettings(ptId);
  if (settings.aiOn === false) return null;
  const res = runRules({ plan: activePlan(pid), sessions: sinceActive(pid, ptId), settings, patientFirst: userRecord(pid)?.first });
  if (!res.suggestions.length) return null;
  return { id, patientId: pid, ...res };
}
export function patientsOf(ptId) {
  const d = store();
  return Object.keys(d.careTeam).filter((pid) => d.careTeam[pid].ptId === ptId);
}
export async function getCaseload(ptId) {
  const local = () => {
    const settings = getSettings(ptId);
    const rows = patientsOf(ptId).map((pid) => {
      const sessions = sessionsFor(pid, { forPt: ptId });
      const flags = patientFlags(sessions, settings);
      const draft = localDraft(pid, ptId);
      return { id: pid, user: userRecord(pid), profile: profileFor(pid), sessions, last: sessions[sessions.length - 1] || null, flags, draft, status: patientStatus(sessions, flags, draft) };
    });
    return { rows, attention: rows.filter((r) => r.flags.length), settings };
  };
  const res = await viaAtp("/api/caseload", {}, local);
  return res?.rows ? res : local();
}
export async function getPatientOverview(ptId, pid) {
  if (!patientsOf(ptId).includes(pid)) return null;   // care-team only
  const settings = getSettings(ptId);
  const sessions = sessionsFor(pid, { forPt: ptId });
  return {
    id: pid, user: userRecord(pid), profile: profileFor(pid), plan: await getPlan(pid), sessions, settings,
    flags: patientFlags(sessions, settings), mistakes: recentMistakes(sessions), draft: localDraft(pid, ptId), alertAt: alertAt(settings),
    goodPct: sessions.map(sessionGood),
  };
}
export async function getDraft(ptId, id) {
  const pid = id.split(".v")[0];
  if (!patientsOf(ptId).includes(pid) || draftId(pid) !== id) return null;
  const settings = getSettings(ptId);
  const res = await planSuggestions({ plan: activePlan(pid), sessions: sinceActive(pid, ptId), settings, patientFirst: userRecord(pid)?.first });
  const st = store().drafts[id] || {};
  return { id, patientId: pid, patient: userRecord(pid), profile: profileFor(pid), plan: activePlan(pid), settings, alertAt: alertAt(settings),
    ...res, decisions: st.decisions || {}, message: st.message ?? res.patient_message, approvedAt: st.approvedAt || null };
}
function draftStore(id) { const d = store(); d.drafts[id] = d.drafts[id] || { decisions: {} }; return d.drafts[id]; }
export function decideSuggestion(id, sugId, state, edits) {
  const st = draftStore(id);
  st.decisions[sugId] = { state, edits: edits || st.decisions[sugId]?.edits || null, decidedAt: new Date().toISOString() };
  save();
}
export function undoDecision(id, sugId) { const st = draftStore(id); delete st.decisions[sugId]; save(); }
export function setDraftMessage(id, text) { draftStore(id).message = text; save(); }
/** Approve: accepted/edited suggestions become the new active plan + a PT message for the patient. */
export async function approveDraft(ptId, id) {
  const draft = await getDraft(ptId, id); if (!draft) return null;
  const d = store(); const pid = draft.patientId;
  const act = activePlan(pid);
  let items = act.items.map((i) => ({ ...i }));
  for (const s of draft.suggestions) {
    const dec = draft.decisions[s.id]; if (dec?.state !== "ok") continue;
    const to = { ...s.to, ...(dec.edits || {}) };
    if (s.kind === "add") items = s.warmup ? [to, ...items] : [...items, to];
    else items = items.map((i) => (i.ex === s.ex ? { ...i, ...to } : i));
  }
  act.status = "superseded";
  const now = new Date().toISOString();
  d.plans[pid].push({ version: act.version + 1, status: "active", createdAt: now, items, message: { from: ptId, text: draft.message, at: now }, draftId: id });
  draftStore(id).approvedAt = now;
  save();
  await viaAtp(`/api/drafts/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ message: draft.message }) }, () => null);
  return d.plans[pid][d.plans[pid].length - 1];
}

// ---------- messages (patient ↔ PT, demo store) ----------
function allMessages() {
  const d = store();
  if (!Array.isArray(d.messages)) d.messages = [];
  return d.messages;
}
/** Chronological messages for a care-team pair. */
export function messagesBetween(patientId, ptId) {
  return allMessages()
    .filter((m) => m.patientId === patientId && m.ptId === ptId)
    .sort((a, b) => a.at.localeCompare(b.at));
}
/** Whether viewer may message this counterpart (care-team only). */
export function canMessage(viewerId, counterpartId) {
  const u = userRecord(viewerId);
  if (!u || !counterpartId) return false;
  if (u.role === "patient") return careTeam(viewerId)?.ptId === counterpartId;
  if (u.role === "pt") return patientsOf(viewerId).includes(counterpartId);
  return false;
}
/** Resolve patientId + ptId for a viewer opening a thread with counterpart. */
export function threadPair(viewerId, counterpartId) {
  const u = userRecord(viewerId);
  if (!u || !canMessage(viewerId, counterpartId)) return null;
  if (u.role === "patient") return { patientId: viewerId, ptId: counterpartId };
  return { patientId: counterpartId, ptId: viewerId };
}
/** Inbox rows for a user: one per care-team counterpart, newest activity first. */
export function threadsFor(userId) {
  const u = userRecord(userId);
  if (!u) return [];
  const counterparts = u.role === "pt"
    ? patientsOf(userId)
    : (careTeam(userId)?.ptId ? [careTeam(userId).ptId] : []);
  return counterparts.map((cid) => {
    const pair = threadPair(userId, cid);
    const msgs = pair ? messagesBetween(pair.patientId, pair.ptId) : [];
    const last = msgs[msgs.length - 1] || null;
    const unread = msgs.filter((m) => m.from !== userId && !m.readAt).length;
    return {
      counterpartId: cid,
      counterpart: userRecord(cid),
      patientId: pair?.patientId,
      ptId: pair?.ptId,
      last,
      unread,
    };
  }).sort((a, b) => {
    const ta = a.last?.at || "";
    const tb = b.last?.at || "";
    if (tb !== ta) return tb.localeCompare(ta);
    return (a.counterpart?.name || "").localeCompare(b.counterpart?.name || "");
  });
}
export function sendMessage({ from, patientId, ptId, text }) {
  const body = (text || "").trim();
  if (!body || !from || !patientId || !ptId) return null;
  if (!canMessage(from, from === patientId ? ptId : patientId)) return null;
  const msg = {
    id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    patientId, ptId, from, text: body,
    at: new Date().toISOString(),
    readAt: null,
  };
  allMessages().push(msg);
  save();
  return msg;
}
/** Mark messages in the thread as read for the viewer (messages they did not send). */
export function markThreadRead(viewerId, patientId, ptId) {
  const now = new Date().toISOString();
  let n = 0;
  for (const m of messagesBetween(patientId, ptId)) {
    if (m.from !== viewerId && !m.readAt) { m.readAt = now; n += 1; }
  }
  if (n) save();
  return n;
}
