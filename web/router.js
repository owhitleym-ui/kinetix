// Tiny hash router with role guards. Routes look like "/provider/patient/:id"; "?a=b" after the path is the query.
import { currentUser, homeFor } from "./account.js";

const routes = [];
let current = null;
const cleanups = [];

export function route(pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return "/([^/]+)"; }) + "/?$");
  routes.push({ re, keys, handler, ...opts });
}

/** Run when the next route renders (close modals, stop timers…). */
export const onLeave = (fn) => cleanups.push(fn);

export function go(hash) {
  if (location.hash === hash) run(); else location.hash = hash;
}
export function replace(hash) { history.replaceState(null, "", `${location.pathname}${location.search}${hash}`); }

export function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  return { path: path || "/", query: Object.fromEntries(new URLSearchParams(qs)) };
}

async function run() {
  const { path, query } = parseHash();
  while (cleanups.length) { try { cleanups.pop()(); } catch (e) { console.warn(e); } }
  for (const r of routes) {
    const m = path.match(r.re); if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const user = currentUser();
    const anonOk = r.allowAnon?.(query);
    if (r.role && !anonOk) {
      if (!user) { go(`#/signin?role=${r.role === "pt" ? "provider" : "patient"}&next=${encodeURIComponent("#" + path)}`); return; }
      const roles = Array.isArray(r.role) ? r.role : [r.role];
      if (!roles.includes(user.role)) { go(homeFor(user)); return; }
    }
    current = { path, params, query, user };
    await r.handler(current);
    return;
  }
  go("#/");
}

export function startRouter() {
  window.addEventListener("hashchange", run);
  return run();
}
export const currentRoute = () => current;

// The app has three top-level screens: routed views (#appRoot), the warm-up, and the camera/library app.
export function showScreen(name) {
  for (const [id, key] of [["appRoot", "app"], ["warmupScreen", "warmup"], ["coachApp", "coach"]]) {
    const el = document.getElementById(id); if (el) el.hidden = key !== name;
  }
}
