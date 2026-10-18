// T3 · AI plan review: every suggestion shows its evidence; nothing reaches the patient until the PT approves.
import { EFFORT_FACES, ICON, esc, face, ring, toast } from "../ui.js";
import { doseShort, exName } from "../exerciseText.js";
import { approveDraft, decideSuggestion, getDraft, setDraftMessage, undoDecision } from "../data.js";
import { renderPage, stubPage } from "./chrome.js";
import { go } from "../router.js";

const KIND = { adjust: ["Adjust", "alert"], keep: ["Keep", ""], add: ["Add", "mint"] };

export async function aiPlanRoute({ user, params }) {
  const ptId = user.dataId;
  const d = await getDraft(ptId, params.draftId);
  if (!d) { stubPage("This plan draft has already been handled", { active: "drafts", user }); return; }
  const first = d.patient.first;
  const editing = new Set();

  const card = (s) => {
    const dec = d.decisions[s.id], st = dec?.state;
    const to = { ...s.to, ...(dec?.edits || {}) };
    const [kind, cls] = KIND[s.kind];
    const title = s.kind === "add" && s.warmup ? `Warm-up · ${exName(s.ex)}` : exName(s.ex);
    return `<article class="sugg ${st === "ok" ? "ok" : st === "no" ? "no" : ""}" aria-labelledby="sg-${s.id}">
      <div class="row-between" style="align-items:center;flex-wrap:wrap"><div style="display:flex;align-items:center;gap:10px"><span class="tag ${cls}">${kind}</span><h2 id="sg-${s.id}">${esc(title)}</h2></div>
        <span style="font-size:.8125rem;font-weight:700;color:${st === "ok" ? "var(--primary-strong)" : "var(--muted)"}">${st === "ok" ? (dec.edits ? "Accepted with edits" : "Accepted") : st === "no" ? "Dismissed" : "Needs review"}</span></div>
      <div class="from-to"><span class="from">${esc(s.from ? doseShort(s.from) : "Not in plan")}</span>${ICON.arrow}<span class="to">${esc(doseShort(to))}</span></div>
      <div class="stack" style="gap:6px"><div class="lbl">Why</div><ul class="why">${s.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>
      ${editing.has(s.id) ? `<form class="stack" data-editform="${s.id}" style="gap:10px;padding:14px;border-radius:18px;background:var(--bg)">
          <div class="edit-grid"><label class="field">Sets<input type="number" name="sets" min="1" max="6" value="${to.sets}"></label><label class="field">Reps<input type="number" name="reps" min="1" max="30" value="${to.reps}"></label>
            <label class="field">Tempo<select name="tempo"><option value="normal"${to.tempo !== "slow" ? " selected" : ""}>Normal</option><option value="slow"${to.tempo === "slow" ? " selected" : ""}>Slow (3 s down)</option></select></label></div>
          <label class="field">Cue for the patient<input name="cue" value="${esc(to.cue || "")}" placeholder="e.g. Keep your body straight"></label>
          <div style="display:flex;gap:8px"><button class="btn btn-primary sm">Save and accept</button><button type="button" class="btn btn-secondary sm" data-canceledit="${s.id}">Cancel</button></div></form>`
        : `<div style="display:flex;flex-wrap:wrap;gap:8px">${st ? `<button type="button" class="btn btn-secondary sm" data-undo="${s.id}">Undo</button>` : `<button type="button" class="btn btn-primary sm" data-accept="${s.id}">Accept</button>
          <button type="button" class="btn btn-secondary sm" data-editbtn="${s.id}">Edit</button><button type="button" class="btn btn-secondary sm" style="color:var(--muted)" data-dismiss="${s.id}">Dismiss</button>`}</div>`}
    </article>`;
  };

  const render = () => {
    const n = d.suggestions.length, decided = d.suggestions.filter((s) => d.decisions[s.id]).length;
    const sl = d.since_last_plan, eff = EFFORT_FACES.find((f) => f.v === sl.effort) || EFFORT_FACES[1];
    const root = renderPage(`
      <div class="t2-head">
        <a class="back-pill" style="border-radius:12px" href="#/provider/patient/${encodeURIComponent(d.patientId)}" aria-label="Back to ${esc(d.patient.name)}">${ICON.back}</a>
        <div style="flex:1 1 300px"><div class="lbl">Plan suggestion · week ${d.profile.week} → week ${Math.min(d.profile.week + 1, d.profile.totalWeeks)}</div><h1 style="margin:2px 0 0;font-size:1.625rem;font-weight:700">Review ${esc(first)}’s next plan</h1></div>
        <div style="font-size:.9375rem;color:#4a524d;font-weight:600" aria-live="polite">${decided} of ${n} reviewed</div>
      </div>
      <div class="note mint" style="font-size:.9375rem;border:1px solid #c9e8d2;background:#eef8f1">${ICON.sparkle}<span><b>Drafted by AI from ${sl.sessions} sessions and ${sl.checkins} check-ins.</b> Nothing changes for the patient until you approve. Suggestions follow your limits: no progression while pain is above ${d.settings.painLimit}/10.</span></div>
      <div class="t3-grid">
        <section class="t3-main" aria-label="Suggestions">${d.suggestions.map(card).join("")}</section>
        <aside class="t3-side">
          <section class="card bordered stack" style="padding:20px"><h2 style="font-size:1rem;font-weight:700">Since last plan</h2>
            <div class="rings4">
              <div>${ring({ size: 104, value: sl.sessions / Math.max(1, sl.expected), label: `${sl.sessions}/${sl.expected}`, aria: `${sl.sessions} of ${sl.expected} sessions done` })}<b>Sessions</b><small>sessions done</small></div>
              <div>${ring({ size: 104, value: sl.goodPct / 100, color: "var(--indigo)", label: `${sl.goodPct}%`, aria: `${sl.goodPct}% good form` })}<b>Good form</b><small>of reps</small></div>
              <div>${ring({ size: 104, value: (sl.pain ?? 0) / 10, color: "var(--alert)", label: `<span style="color:var(--alert-ink);font-size:1.375rem">${sl.pain ?? "–"}</span>`, aria: `Pain ${sl.pain} out of 10` })}<b>Pain</b><small>${sl.painFrom != null && sl.pain > sl.painFrom ? `up from ${sl.painFrom} · ` : ""}out of 10</small></div>
              <div><div class="ring" style="width:104px;height:104px" role="img" aria-label="Effort: ${eff.word}"><svg viewBox="0 0 100 100" width="104" height="104"><circle cx="50" cy="50" r="44" fill="none" stroke="var(--accent)" stroke-width="10"/></svg><div class="ring-label">${face({ mouth: eff.mouth }, 34, "#1e4fa8")}</div></div><b>Effort</b><small>“${eff.word}”</small></div>
            </div></section>
          <section class="card bordered stack" style="padding:20px;gap:10px">
            <label for="ptMsg" style="font-size:1rem;font-weight:700">Message to patient</label><span class="muted" style="font-size:.8125rem">AI draft · edit before sending</span>
            <div class="field"><textarea id="ptMsg" rows="5">${esc(d.message)}</textarea></div></section>
          <button type="button" class="btn ${decided === n ? "btn-primary " : ""}md block" data-approve aria-disabled="${decided !== n}">Approve &amp; send plan</button>
          <span class="muted" style="font-size:.8125rem;text-align:center">${decided === n ? `${esc(first)} sees the new plan on their Today screen.` : "Accept, edit or dismiss every suggestion to approve."}</span>
        </aside>
      </div>`, { active: "drafts", user, title: `Review ${first}’s plan` });
    const approve = root.querySelector("[data-approve]");
    const decide = (id, state, edits) => { decideSuggestion(d.id, id, state, edits); d.decisions[id] = { state, edits: edits || null }; editing.delete(id); render(); };
    root.querySelectorAll("[data-accept]").forEach((b) => b.addEventListener("click", () => decide(b.dataset.accept, "ok")));
    root.querySelectorAll("[data-dismiss]").forEach((b) => b.addEventListener("click", () => decide(b.dataset.dismiss, "no")));
    root.querySelectorAll("[data-undo]").forEach((b) => b.addEventListener("click", () => { undoDecision(d.id, b.dataset.undo); delete d.decisions[b.dataset.undo]; render(); }));
    root.querySelectorAll("[data-editbtn]").forEach((b) => b.addEventListener("click", () => { editing.add(b.dataset.editbtn); render(); root.querySelector(`[data-editform="${b.dataset.editbtn}"] input`)?.focus(); }));
    root.querySelectorAll("[data-canceledit]").forEach((b) => b.addEventListener("click", () => { editing.delete(b.dataset.canceledit); render(); }));
    root.querySelectorAll("[data-editform]").forEach((f) => f.addEventListener("submit", (e) => {
      e.preventDefault(); const fd = new FormData(f);
      decide(f.dataset.editform, "ok", { sets: Math.max(1, Number(fd.get("sets")) || 1), reps: Math.max(1, Number(fd.get("reps")) || 1), tempo: fd.get("tempo"), cue: String(fd.get("cue") || "").trim() });
    }));
    root.querySelector("#ptMsg").addEventListener("input", (e) => { d.message = e.target.value; setDraftMessage(d.id, d.message); });
    approve.addEventListener("click", async () => {
      if (decided !== n) { toast("Review every suggestion first."); return; }
      approve.disabled = true;
      await approveDraft(ptId, d.id);
      toast(`New plan sent to ${first}.`);
      go("#/provider");
    });
  };
  render();
}
