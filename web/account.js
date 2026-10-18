// Who is signed in: a real ATP account (JWT from auth.js) or a seeded demo account.
import { atpBase, clearSession, getToken, getUser, login as atpLogin, register as atpRegister } from "./auth.js";
import { DEMO_PATIENT, DEMO_PT } from "./demo/seed.js";

const DEMO_KEY = "kinetix.demoUser";
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } };

/** { id, role: "patient" | "pt", mode: "demo" | "atp", dataId (record in the data store), name, first } or null */
export function currentUser() {
  const demo = read(DEMO_KEY);
  if (demo?.role) return { ...demo, mode: "demo", dataId: demo.id };
  const u = getUser();
  if (u && getToken()) {
    const role = u.role === "pt" ? "pt" : "patient";
    return { id: u.id, role, mode: "atp", dataId: role === "pt" ? DEMO_PT : DEMO_PATIENT, name: u.displayName || u.email,
      first: (u.displayName || "").split(" ")[0] || "there", email: u.email, patientId: u.patientId };
  }
  return null;
}

export function signInDemo(role, users) {
  const id = role === "pt" ? DEMO_PT : DEMO_PATIENT;
  const u = users?.[id] || {};
  write(DEMO_KEY, { id, role, name: u.name, first: u.first, email: u.email });
  return currentUser();
}

export async function signInAtp(email, password) {
  write(DEMO_KEY, null);
  await atpLogin(email, password);
  return currentUser();
}
export async function registerAtp(fields) {
  write(DEMO_KEY, null);
  await atpRegister(fields);
  return currentUser();
}

export function signOut() {
  write(DEMO_KEY, null);
  clearSession();
}

let reach = null, reachAt = 0;
/** Is the ATP API up? (cached for 30 s) */
export async function atpReachable() {
  if (reach !== null && Date.now() - reachAt < 30000) return reach;
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`${atpBase()}/health`, { signal: ctrl.signal });
    clearTimeout(t); reach = res.ok;
  } catch { reach = false; }
  reachAt = Date.now();
  return reach;
}

export const homeFor = (user) => (user?.role === "pt" ? "#/provider" : "#/patient");
