// App chrome shared by the routed views: header (logo, nav pills, gear, avatar menu) and the "coming soon" stub.
import { ICON, esc, initials, logo } from "../ui.js";
import { currentUser, signOut } from "../account.js";
import { resetMode } from "../data.js";
import { go } from "../router.js";

const NAV = {
  patient: [["today", "#/patient", "Today"], ["progress", "#/patient/progress", "My progress"], ["messages", "#/patient/messages", "Messages"]],
  pt: [["patients", "#/provider", "Patients"], ["drafts", "#/provider/drafts", "Plan drafts"], ["messages", "#/provider/messages", "Messages"]],
};

export function headerHTML({ active = "", user = currentUser(), center = null, right = null } = {}) {
  const role = user?.role === "pt" ? "pt" : "patient";
  const home = role === "pt" ? "#/provider" : "#/patient";
  const nav = center ?? `<nav class="k-nav" aria-label="Main">${NAV[role].map(([k, href, label]) =>
    `<a href="${href}"${k === active ? ' class="active" aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
  const tools = right ?? `<div class="k-tools">
      <a class="icon-pill" href="${role === "pt" ? "#/provider/settings" : "#/patient/settings"}" aria-label="Settings">${ICON.gear}</a>
      <button type="button" class="avatar" data-menu aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">${esc(initials(user?.name || ""))}</button>
      <div class="menu" role="menu" hidden>
        <div class="menu-head"><b>${esc(user?.name || "")}</b><span class="muted">${user?.mode === "demo" ? "Demo account" : esc(user?.email || "")}</span></div>
        ${role === "patient" ? '<a role="menuitem" href="#/library">Exercise library</a>' : '<a role="menuitem" href="#/library">Exercise library (read-only)</a>'}
        <a role="menuitem" href="${role === "pt" ? "#/provider/settings" : "#/patient/settings"}">Settings</a>
        <button type="button" role="menuitem" data-signout>Sign out</button>
      </div></div>`;
  return `<header class="k-header"><div class="k-header-in">
    <a class="brand" href="${home}">${logo(36)}Kinetix${role === "pt" ? ' <span class="role-tag">Provider</span>' : ""}</a>
    ${nav}${tools}</div></header>`;
}

document.addEventListener("click", (e) => {   // click outside closes any open account menu
  document.querySelectorAll(".menu:not([hidden])").forEach((m) => {
    if (!m.contains(e.target)) { m.hidden = true; m.previousElementSibling?.setAttribute("aria-expanded", "false"); }
  });
});

// Care-team "Message" controls (patient home / settings / PT alert) — delegated so a stale module
// can't leave a dead button after the messages route landed.
document.addEventListener("click", (e) => {
  const el = e.target.closest?.("[data-message], [data-msg]");
  if (!el || el.tagName === "A") return;
  e.preventDefault();
  const user = currentUser();
  if (!user) return;
  const withId = el.dataset.with || "";
  const base = user.role === "pt" ? "#/provider/messages" : "#/patient/messages";
  go(withId ? `${base}?with=${encodeURIComponent(withId)}` : base);
});

export function bindHeader(root) {
  const btn = root.querySelector("[data-menu]"), menu = btn?.nextElementSibling;
  if (btn && menu) {
    const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.hidden; menu.hidden = !open; btn.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector("a, button")?.focus();
    });
    menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); btn.focus(); } });
  }
  root.querySelectorAll("[data-signout]").forEach((b) => b.addEventListener("click", () => { signOut(); resetMode(); go("#/"); }));
}

/** Render a full routed page into #appRoot. */
export function renderPage(html, { active, user, title } = {}) {
  const root = document.getElementById("appRoot");
  root.innerHTML = headerHTML({ active, user }) + `<main class="k-main" id="main">${html}</main>`;
  bindHeader(root);
  if (title) document.title = `${title} · Kinetix`;
  window.scrollTo(0, 0);
  return root;
}

export function stubPage(what, { active, user } = {}) {
  renderPage(`<div class="card stub-card"><span class="stub-ic">${ICON.sparkle}</span><h1>${esc(what)}</h1>
    <p>Coming soon in the demo.</p><a class="btn btn-primary" href="${user?.role === "pt" ? "#/provider" : "#/patient"}">Back</a></div>`, { active, user, title: what });
}
