// P6 · Patient settings: video & privacy, reminders, accessibility, care team (incl. session sharing), account.
import { ICON, comingSoon, esc, initials, niceDate, toast } from "../ui.js";
import { careTeam, getSettings, profileFor, ptFor, resetDemo, resetMode, saveSettings, sessionsFor, setSessionShared, userRecord } from "../data.js";
import { signOut } from "../account.js";
import { go } from "../router.js";
import { renderPage } from "./chrome.js";

export const applyTextSize = (n) => { document.documentElement.dataset.text = String(n || 0); };
const sw = (key, on, label) => `<button type="button" class="switch" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" data-switch="${key}"></button>`;
const DAYS = ["M", "T", "W", "T", "F", "S", "S"], DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function settingsNav(sections) {
  return `<nav class="settings-nav" aria-label="Settings sections"><h1>Settings</h1>${sections.map(([id, t], i) => `<a href="#${id}" data-sec="${id}"${i ? "" : ' class="active"'}>${t}</a>`).join("")}</nav>`;
}
export function bindSettingsNav(root) {
  root.querySelectorAll("[data-sec]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    root.querySelectorAll("[data-sec]").forEach((x) => x.classList.toggle("active", x === a));
    document.getElementById(a.dataset.sec)?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById(a.dataset.sec)?.focus({ preventScroll: true });
  }));
}

export function patientSettingsRoute({ user }) {
  const pid = user.dataId;
  const pt = ptFor(pid), prof = profileFor(pid), me = userRecord(pid) || {};
  const ptName = pt?.short || "your PT";
  let st = getSettings(pid);
  const render = () => {
    const sessions = sessionsFor(pid).slice(-8).reverse();
    const root = renderPage(`<div class="settings-grid">
      ${settingsNav([["video", "Video &amp; privacy"], ["reminders", "Reminders"], ["access", "Accessibility"], ["care", "My care team"], ["account", "Account"]])}
      <div class="settings-cards">
        <section id="video" tabindex="-1" class="card full" aria-labelledby="vidH">
          <div><h2 id="vidH" class="card-title">Video &amp; privacy</h2><p class="card-sub">What happens to your camera video during sessions.</p></div>
          <div role="radiogroup" aria-label="Video setting" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
            <button type="button" class="radio-card" role="radio" aria-checked="${st.videoChoice === "share"}" data-video="share"><span class="radio-dot"></span><span><b>Record and share with ${esc(ptName)}</b><span class="desc">Short clips your PT can review. Only your care team can see them.</span></span></button>
            <button type="button" class="radio-card" role="radio" aria-checked="${st.videoChoice !== "share"}" data-video="local"><span class="radio-dot"></span><span><b>Don’t save video</b><span class="desc">Live feedback only. Video never leaves this device.</span></span></button>
          </div>
          <div class="setting-row" style="border-top:1px solid var(--track);padding-top:14px"><div><b>Ask me before each session</b><small>Show the video choice every time you start.</small></div>${sw("askEachSession", st.askEachSession !== false, "Ask me before each session")}</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px"><button type="button" class="btn btn-secondary" data-download>Download my data</button><button type="button" class="btn btn-danger-line" data-delrec>Delete my recordings</button></div>
          <div class="note blue">${ICON.shield}<span>All your health data, including any video, is encrypted and handled in accordance with HIPAA.</span></div>
        </section>
        <section id="reminders" tabindex="-1" class="card" aria-labelledby="remH">
          <h2 id="remH" class="card-title">Reminders</h2>
          <div class="setting-row"><b>Daily practice reminder</b>${sw("reminders.on", st.reminders.on, "Daily practice reminder")}</div>
          <label class="setting-row" style="font-weight:600;color:#55615a">Time <input type="time" class="input" style="min-width:9em;text-align:center" value="${esc(st.reminders.time)}" data-remtime></label>
          <div class="day-pills" role="group" aria-label="Reminder days">${DAYS.map((d, i) => `<button type="button" aria-pressed="${!!st.reminders.days[i]}" aria-label="${DAY_NAMES[i]}" data-day="${i}">${d}</button>`).join("")}</div>
        </section>
        <section id="access" tabindex="-1" class="card" aria-labelledby="accH">
          <h2 id="accH" class="card-title">Accessibility</h2>
          <div class="stack" style="gap:8px"><b>Text size</b>
            <div class="seg-pill" role="radiogroup" aria-label="Text size">${["Default", "Large", "Extra large"].map((l, i) => `<button type="button" role="radio" aria-checked="${(st.textSize || 0) === i}" data-size="${i}">${l}</button>`).join("")}</div></div>
          <div class="setting-row"><div><b>Spoken cues</b><small>Hear form tips out loud</small></div>${sw("spokenCues", st.spokenCues !== false, "Spoken cues")}</div>
        </section>
        <section id="care" tabindex="-1" class="card" aria-labelledby="careH">
          <h2 id="careH" class="card-title">My care team</h2>
          ${pt ? `<div style="display:flex;align-items:center;gap:12px"><span class="avatar" style="width:48px;height:48px;background:var(--accent-soft);color:var(--accent-ink)">${esc(initials(pt.name))}</span><div><b>${esc(pt.name)}</b><div class="muted" style="font-size:.875rem">${esc(pt.clinic)} · Next visit ${esc(prof?.nextVisit ? niceDate(prof.nextVisit) : "not booked")}</div></div></div>` : '<p class="muted" style="margin:0">Not linked to a physical therapist yet.</p>'}
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn btn-primary" data-msg>Message</button><button type="button" class="btn btn-secondary" data-invite aria-expanded="false">Add invite code</button></div>
          <form data-inviteform hidden style="display:flex;gap:8px;flex-wrap:wrap"><label class="sr-only" for="inviteCode">Invite code</label><input id="inviteCode" class="input" style="flex:1 1 140px" placeholder="e.g. 4F7-K2Q" autocomplete="off"><button class="btn btn-secondary">Link</button></form>
          <div class="setting-row" style="border-top:1px solid var(--track);padding-top:14px"><div><b>Auto-share sessions with ${esc(ptName)}</b><small>Rep counts, form scores and check-ins. Never video.</small></div>${sw("autoShare", st.autoShare !== false, "Auto-share sessions with my PT")}</div>
          <details><summary style="cursor:pointer;font-weight:700;min-height:44px;display:flex;align-items:center">Shared sessions (${sessions.length} most recent)</summary>
            <div class="share-list">${sessions.map((s) => {
              const on = pt && (s.sharedWith || []).includes(pt.id);
              return `<div class="share-item"><span><b>${esc(new Date(s.startedAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}</b>${esc(s.exercises.map((e) => e.name).join(", "))}</span>
                <span style="display:flex;align-items:center;gap:8px;font-weight:600">${on ? "Shared" : "Private"}<button type="button" class="switch" role="switch" aria-checked="${!!on}" aria-label="Share session from ${esc(new Date(s.startedAt).toLocaleDateString())} with ${esc(ptName)}" data-share="${esc(s.id)}" ${pt ? "" : "disabled"}></button></span></div>`;
            }).join("") || '<p class="muted">No sessions yet.</p>'}</div>
            ${user.mode === "atp" ? '<p style="font-size:.875rem;margin:8px 0 0"><a href="permissions.html">Manage sharing for account sessions</a></p>' : ""}
          </details>
        </section>
        <section id="account" tabindex="-1" class="card" aria-labelledby="accountH">
          <h2 id="accountH" class="card-title">Account</h2>
          <div style="font-size:.9375rem;line-height:1.7"><span class="muted">Name</span> · ${esc(user.name || me.name)}<br><span class="muted">Email</span> · ${esc(user.email || me.email || "")}</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn btn-secondary" data-signout2>Sign out</button><button type="button" class="btn" style="color:var(--alert-ink);background:none" data-delacct>Delete account</button></div>
          ${user.mode === "demo" ? '<button type="button" class="btn btn-ghost" data-reset>Reset demo data</button>' : ""}
        </section>
      </div></div>`, { user, title: "Settings" });
    bindSettingsNav(root);
    const set = (patch, msg) => { st = saveSettings(pid, patch); if (msg) toast(msg); };
    root.querySelectorAll("[data-video]").forEach((b) => b.addEventListener("click", () => { set({ videoChoice: b.dataset.video }); root.querySelectorAll("[data-video]").forEach((x) => x.setAttribute("aria-checked", String(x === b))); }));
    root.querySelectorAll("[data-switch]").forEach((b) => b.addEventListener("click", () => {
      const on = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", String(on));
      const k = b.dataset.switch;
      if (k === "reminders.on") set({ reminders: { ...st.reminders, on } });
      else if (k === "askEachSession") set({ askEachSession: on, rememberChoice: !on });
      else set({ [k]: on });
      if (k === "spokenCues") { const v = document.getElementById("voice"); if (v) v.checked = on; }
    }));
    root.querySelector("[data-remtime]").addEventListener("change", (e) => set({ reminders: { ...st.reminders, time: e.target.value } }, "Reminder time saved."));
    root.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => {
      const days = [...st.reminders.days]; const i = Number(b.dataset.day); days[i] = days[i] ? 0 : 1;
      b.setAttribute("aria-pressed", String(!!days[i])); set({ reminders: { ...st.reminders, days } });
    }));
    root.querySelectorAll("[data-size]").forEach((b) => b.addEventListener("click", () => {
      const n = Number(b.dataset.size); set({ textSize: n }); applyTextSize(n);
      root.querySelectorAll("[data-size]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    }));
    root.querySelectorAll("[data-share]").forEach((b) => b.addEventListener("click", () => {
      const on = b.getAttribute("aria-checked") !== "true"; setSessionShared(b.dataset.share, pt.id, on);
      b.setAttribute("aria-checked", String(on)); b.previousSibling.textContent = on ? "Shared" : "Private";
    }));
    root.querySelector("[data-download]").onclick = () => {
      const blob = new Blob([JSON.stringify({ account: { name: user.name, email: user.email }, settings: st, careTeam: careTeam(pid), sessions: sessionsFor(pid) }, null, 2)], { type: "application/json" });
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "kinetix-my-data.json" });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    root.querySelector("[data-delrec]").onclick = () => toast("No recordings are stored by Kinetix — video stays on your device.", 4000);
    root.querySelector("[data-msg]").onclick = () => comingSoon("Messaging");
    root.querySelector("[data-invite]").onclick = (e) => { const f = root.querySelector("[data-inviteform]"); f.hidden = !f.hidden; e.currentTarget.setAttribute("aria-expanded", String(!f.hidden)); if (!f.hidden) f.querySelector("input").focus(); };
    root.querySelector("[data-inviteform]").addEventListener("submit", (e) => { e.preventDefault(); toast(pt ? `You’re already linked to ${ptName}.` : "Invite code saved."); e.currentTarget.hidden = true; });
    root.querySelector("[data-signout2]").onclick = () => { signOut(); resetMode(); go("#/"); };
    root.querySelector("[data-delacct]").onclick = () => comingSoon("Account deletion");
    root.querySelector("[data-reset]")?.addEventListener("click", () => { resetDemo(); st = getSettings(pid); applyTextSize(0); toast("Demo data reset."); render(); });
  };
  render();
}
