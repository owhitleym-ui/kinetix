// P5 · Session summary + check-in, built from the reps the engine actually counted.
import { EFFORT_FACES, ICON, PAIN_FACES, esc, face, logo, ring, toast } from "../ui.js";
import { plainCue, plainLine } from "../exerciseText.js";
import { getSession, getSettings, lastSession, ptFor, saveCheckin, sessionsFor } from "../data.js";
import { alertAt } from "../planRules.js";
import { go } from "../router.js";
import { renderPage } from "./chrome.js";

const WORDS = ["No", "One", "Two", "Three", "Four", "Five"];
const ratio = (s) => { const g = s.exercises.reduce((t, e) => t + e.good, 0), n = s.exercises.reduce((t, e) => t + e.done, 0); return n ? g / n : 0; };

export function summaryRoute({ user, query }) {
  const pid = user.dataId;
  const s = (query.id && getSession(query.id)) || lastSession(pid);
  if (!s || s.patientId !== pid) { go("#/patient"); return; }
  const pt = ptFor(pid), ptName = pt?.short || "your PT";
  const A = alertAt(pt ? getSettings(pt.id) : null);
  const shareOn = getSettings(pid).autoShare !== false;
  const done = s.exercises.reduce((t, e) => t + e.done, 0), target = s.exercises.reduce((t, e) => t + e.target, 0);
  const good = s.exercises.reduce((t, e) => t + e.good, 0);
  const in10 = done ? Math.round(good / done * 10) : 0;
  const prior = sessionsFor(pid).filter((x) => x.id !== s.id && x.startedAt < s.startedAt && x.exercises.some((e) => e.done));
  const prev = prior[prior.length - 1];
  const prev10 = prev ? Math.round(ratio(prev) * 10) : null;
  const diff = prev10 == null ? null : in10 - prev10;
  const cmpText = diff == null ? "Your first session. A great start." : diff > 0 ? `${WORDS[Math.min(diff, 5)]} more good rep${diff > 1 ? "s" : ""} in every 10.` : diff === 0 ? "Same as last time. Steady work." : "A few more to fix than last time. The tips below can help.";
  const repsText = !target ? "" : done >= target ? "You did every rep." : done / target >= 0.9 ? "You did almost every rep." : `You finished ${done} of ${target} reps.`;
  let pain = s.checkin?.pain ?? (query.hurt ? 8 : null), effort = s.checkin?.effort ?? null;

  const root = renderPage(`
    <div class="p5-grid">
      <section class="p5-main">
        <div style="display:flex;align-items:center;gap:14px"><span class="done-badge">${ICON.check}</span>
          <div><div style="font-size:.9375rem;font-weight:800;color:var(--primary-strong)">Session complete · ${Math.max(1, s.durationMin || 1)} min</div><h1 style="margin:0;font-size:2rem;font-weight:800">Nice work, ${esc(user.first || "")}!</h1></div></div>
        ${query.hurt ? `<div class="note alert">${ICON.warn}<span><b>You stopped because it hurt.</b> Tell ${esc(ptName)} how it feels below. If the pain is sharp or doesn’t ease, contact your clinic.</span></div>` : ""}
        <div class="stat3">
          <div class="card bordered"><div class="stat-h">Reps finished</div>${ring({ size: 120, value: target ? done / target : 0, stroke: 12, label: `<span style="font-size:2.125rem">${done}</span>`, sub: `of ${target}`, aria: `${done} of ${target} reps finished` })}<div>${repsText}</div></div>
          <div class="card bordered"><div class="stat-h">Good form</div>
            <div class="form-circles" role="img" aria-label="${in10} out of 10 reps had good form">${Array.from({ length: 10 }, (_, i) => `<span class="${done ? (i < in10 ? "" : "fix") : "none"}"></span>`).join("")}</div>
            <div>${done ? `<b>${in10} out of 10</b> reps looked good.` : "No reps were counted this time."}</div></div>
          <div class="card bordered" style="align-items:stretch"><div class="stat-h" style="text-align:center">Compared to last time</div>
            <div class="compare" style="flex:1;justify-content:center">
              ${prev10 != null ? `<div class="row-between"><span>Last time</span><span>${prev10} / 10</span></div><div class="bar-track"><span style="width:${prev10 * 10}%;background:#b9c4bc;border-radius:99px"></span></div>` : ""}
              <div class="row-between" style="color:var(--text);font-weight:800;margin-top:6px"><span>Today</span><span style="color:var(--primary-strong)">${in10} / 10</span></div><div class="bar-track"><span style="width:${in10 * 10}%;background:var(--primary);border-radius:99px"></span></div>
            </div><div style="text-align:center">${cmpText}</div></div>
        </div>
        <section class="card bordered" style="flex:1;display:flex;flex-direction:column;gap:6px"><h2 style="font-size:1.25rem;font-weight:800;margin:0 0 6px">Tips for next time</h2>
          ${s.exercises.map((e) => {
            const g = e.done ? Math.round(e.good / e.done * 100) : 0;
            const top = [...(e.mistakes || [])].sort((a, b) => b.n - a.n)[0];
            const tip = !e.done ? "Not started this time." : top ? `${plainCue(top.code)}. ${plainLine(top.code)}` : "Great. Your form stayed steady.";
            return `<div class="tips-row"><b>${esc(e.name)}</b><div class="bar-track" role="img" aria-label="${g}% good reps"><span style="width:${g}%;background:var(--primary)"></span><span style="width:${e.done ? 100 - g : 0}%;background:var(--warn)"></span></div><div style="color:#4a524d;line-height:1.35">${esc(tip)}</div></div>`;
          }).join("")}
        </section>
      </section>
      <aside class="card bordered p5-side">
        <div><h2 style="font-size:1.3125rem;font-weight:800;margin:0 0 4px">How did it feel?</h2><p class="muted" style="margin:0;font-size:.875rem">${shareOn ? `Shared with ${esc(ptName)} to help adjust your plan.` : `Saved to your history. Sharing with ${esc(ptName)} is off in Settings.`}</p></div>
        <fieldset class="plain"><legend>Pain during exercises</legend>
          <div class="faces" role="radiogroup" aria-label="Pain from 0 to 10" style="grid-template-columns:repeat(6,minmax(0,1fr))">
            ${PAIN_FACES.map((f) => `<button type="button" class="face-btn" role="radio" aria-checked="${pain === f.v}" aria-label="${f.v}. ${f.word}" data-pain="${f.v}">${face(f, 40)}<span>${f.v}</span></button>`).join("")}
          </div><div class="row-between lbl"><span>No pain</span><span>Worst pain</span></div></fieldset>
        <fieldset class="plain"><legend>How hard was today?</legend>
          <div class="faces" role="radiogroup" aria-label="How hard was today" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
            ${EFFORT_FACES.map((f) => `<button type="button" class="face-btn" role="radio" aria-checked="${effort === f.v}" data-effort="${f.v}">${face(f, 38)}<small>${f.word}</small></button>`).join("")}
          </div></fieldset>
        <label class="field" style="font-size:1rem;font-weight:800">Anything to tell your PT? <span class="hint" style="font-weight:600">Optional</span>
          <textarea rows="3" data-note placeholder="e.g. Right shoulder felt tight on the last set">${esc(s.checkin?.note || "")}</textarea></label>
        <div class="note alert" data-highpain hidden style="font-weight:600">${esc(ptName)} will be told about this pain level right away.</div>
        <p class="form-error" data-err hidden>Pick a pain level and how hard it felt.</p>
        <button type="button" class="btn btn-primary md block" style="margin-top:auto" data-send>${shareOn ? "Send to my PT" : "Save check-in"}</button>
      </aside>
    </div>`, { user, title: "Session summary", active: "today" });
  // P5 header: logo + Back to Today (no nav)
  root.querySelector(".k-header-in").innerHTML = `<a class="brand" href="#/patient">${logo(36)}Kinetix</a><a href="#/patient" style="font-weight:800">Back to Today</a>`;

  const hp = root.querySelector("[data-highpain]");
  const sync = () => {
    root.querySelectorAll("[data-pain]").forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.pain) === pain)));
    root.querySelectorAll("[data-effort]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.effort === effort)));
    hp.hidden = !(pain != null && pain >= A && shareOn);
  };
  root.querySelectorAll("[data-pain]").forEach((b) => b.addEventListener("click", () => { pain = Number(b.dataset.pain); sync(); }));
  root.querySelectorAll("[data-effort]").forEach((b) => b.addEventListener("click", () => { effort = b.dataset.effort; sync(); }));
  sync();
  root.querySelector("[data-send]").addEventListener("click", async () => {
    if (pain == null || !effort) { root.querySelector("[data-err]").hidden = false; return; }
    await saveCheckin(s.id, { pain, effort, note: root.querySelector("[data-note]").value.trim() });
    toast(shareOn ? `Sent to ${ptName}.` : "Check-in saved.");
    go("#/patient");
  });
}
