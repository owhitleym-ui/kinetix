// T4 · Provider settings. These values drive T1 flags, the T2 banner, T3 rules and the patient's pain reminder.
import { ICON, comingSoon, esc, initials, toast } from "../ui.js";
import { getSettings, resetDemo, saveSettings, userRecord } from "../data.js";
import { renderPage } from "./chrome.js";
import { bindSettingsNav, settingsNav } from "./patientSettings.js";

const sw = (key, on, label) => `<button type="button" class="switch" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" data-switch="${key}"></button>`;
const CADENCE = [["weekly", "Weekly"], ["every5", "Every 5 sessions"], ["ask", "Only when I ask"]];

export function providerSettingsRoute({ user }) {
  const id = user.dataId, me = userRecord(id) || {};
  let st = getSettings(id);
  const render = () => {
    const A = st.painLimit + 1;
    const root = renderPage(`<div class="settings-grid">
      ${settingsNav([["ai", "AI plan assistant"], ["alerts", "Alerts"], ["defaults", "Patient defaults"], ["profile", "Profile &amp; clinic"], ["security", "Security &amp; privacy"]])}
      <div class="settings-cards">
        <section id="ai" tabindex="-1" class="card full" aria-labelledby="aiH">
          <div class="setting-row" style="align-items:flex-start;padding:0"><div><h2 id="aiH" class="card-title">AI plan assistant</h2><p class="card-sub">Drafts plan changes from your patients’ sessions and check-ins.</p></div>${sw("aiOn", st.aiOn, "Draft plan suggestions")}</div>
          <div class="stack" style="gap:8px"><b>Suggest changes</b>
            <div class="seg-pill" role="radiogroup" aria-label="How often" style="max-width:560px">${CADENCE.map(([v, l]) => `<button type="button" role="radio" aria-checked="${st.cadence === v}" data-cadence="${v}">${l}</button>`).join("")}</div></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
            <div class="soft-tile"><div><b>Never suggest progressing</b><br><span class="muted">when pain is above</span></div>
              <div class="stepper"><button type="button" aria-label="Lower pain limit" data-pain="-1">−</button><b aria-live="polite">${st.painLimit}/10</b><button type="button" aria-label="Raise pain limit" data-pain="1">+</button></div></div>
            <div class="soft-tile"><div><b>Biggest weekly change</b><br><span class="muted">per exercise</span></div><span class="tag white" style="font-size:.875rem;padding:10px 14px;color:var(--text)">${esc(st.weeklyCap)}</span></div>
          </div>
          <div class="note mint" style="font-size:.875rem">${ICON.lock}<span><b>Always requires your approval.</b> Patients never see an AI change until you accept it. This can’t be turned off.</span></div>
        </section>
        <section id="alerts" tabindex="-1" class="card" aria-labelledby="alH">
          <h2 id="alH" class="card-title">Alerts</h2>
          ${[["pain", `Pain at or above ${A}`, "Notify me right away", "var(--alert)"], ["missed", `Missed ${st.missedDays} days in a row`, "Daily summary", "var(--warn)"], ["form", `Form accuracy below ${st.formBelow}%`, "Daily summary", "var(--indigo)"]].map(([k, t, d, c]) =>
            `<div class="setting-row"><div style="display:flex;align-items:center;gap:10px"><span class="dot" style="width:12px;height:12px;background:${c}"></span><div><b>${t}</b><small>${d}</small></div></div>${sw(`alerts.${k}`, st.alerts[k] !== false, t)}</div>`).join("")}
        </section>
        <section id="defaults" tabindex="-1" class="card" aria-labelledby="defH">
          <h2 id="defH" class="card-title">Patient defaults</h2>
          <div class="setting-row"><div><b>Warm-up before every session</b><small>Patients can still skip it</small></div>${sw("warmupDefault", st.warmupDefault, "Warm-up before every session")}</div>
          <div class="setting-row"><div><b>Ask patients to share video</b><small>They always choose for themselves</small></div>${sw("askVideo", st.askVideo, "Ask patients to share video")}</div>
          <a href="#/library" style="font-weight:700;font-size:.875rem">Manage exercise library</a>
        </section>
        <section id="profile" tabindex="-1" class="card" aria-labelledby="profH">
          <h2 id="profH" class="card-title">Profile &amp; clinic</h2>
          <div style="display:flex;align-items:center;gap:12px"><span class="avatar lg">${esc(initials(me.name || user.name))}</span><div><b>${esc(me.name || user.name)}</b><div class="muted" style="font-size:.875rem">${esc(me.clinic || "")} · ${esc(me.clinicAddress || "")}</div></div></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" class="btn btn-secondary" data-soon="Profile editing">Edit profile</button><button type="button" class="btn btn-secondary" data-soon="Invite codes">Invite codes</button></div>
        </section>
        <section id="security" tabindex="-1" class="card" aria-labelledby="secH">
          <h2 id="secH" class="card-title">Security &amp; privacy</h2>
          <div class="setting-row"><b>Two-step sign-in</b>${sw("twoStep", st.twoStep, "Two-step sign-in")}</div>
          <div class="setting-row"><b>Auto sign-out</b><span class="tag" style="font-size:.875rem;padding:8px 14px">After ${st.autoSignout} min</span></div>
          <button type="button" class="link-btn" style="align-self:flex-start" data-soon="The access log">View access log</button>
          <div class="note blue" style="font-size:.8125rem;margin-top:auto">${ICON.shield}<span>Patients’ camera video stays on their device. You see rep results, form checks and check-ins.</span></div>
          ${user.mode === "demo" ? '<button type="button" class="btn btn-ghost" data-reset>Reset demo data</button>' : ""}
        </section>
      </div></div>`, { user, title: "Settings" });
    bindSettingsNav(root);
    const set = (patch) => { st = saveSettings(id, patch); };
    root.querySelectorAll("[data-switch]").forEach((b) => b.addEventListener("click", () => {
      const on = b.getAttribute("aria-checked") !== "true"; b.setAttribute("aria-checked", String(on));
      const k = b.dataset.switch;
      if (k.startsWith("alerts.")) set({ alerts: { ...st.alerts, [k.slice(7)]: on } }); else set({ [k]: on });
    }));
    root.querySelectorAll("[data-cadence]").forEach((b) => b.addEventListener("click", () => {
      set({ cadence: b.dataset.cadence }); root.querySelectorAll("[data-cadence]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    }));
    root.querySelectorAll("[data-pain]").forEach((b) => b.addEventListener("click", () => {
      set({ painLimit: Math.max(1, Math.min(9, st.painLimit + Number(b.dataset.pain))) });
      const y = window.scrollY; render(); window.scrollTo(0, y);
      document.querySelector(`[data-pain="${b.dataset.pain}"]`)?.focus();
    }));
    root.querySelectorAll("[data-soon]").forEach((b) => b.addEventListener("click", () => comingSoon(b.dataset.soon)));
    root.querySelector("[data-reset]")?.addEventListener("click", () => { resetDemo(); st = getSettings(id); toast("Demo data reset."); render(); });
  };
  render();
}
