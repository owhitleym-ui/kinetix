// T2 · Patient progress: pain banner first, then a prioritised bento of pain, form, deficits, adherence, sessions, errors.
import { ICON, comingSoon, esc, initials, niceDate, toast } from "../ui.js";
import { exName } from "../exerciseText.js";
import { getPatientOverview } from "../data.js";
import { exGood } from "../planRules.js";
import { renderPage } from "./chrome.js";
import { go } from "../router.js";

const DAY = 864e5;

function painChart(sessions, A) {
  const pts = sessions.slice(-8).map((s) => s.checkin?.pain).filter((p) => p != null);
  if (pts.length < 2) return '<p class="muted">Not enough check-ins yet.</p>';
  const y = (p) => 250 - p * 24, x = (i) => (i / (pts.length - 1)) * 600;
  const line = pts.map((p, i) => `${x(i).toFixed(0)},${y(p)}`).join(" ");
  const last = pts[pts.length - 1];
  return `<svg class="chart" viewBox="0 0 600 260" preserveAspectRatio="none" role="img" aria-label="Reported pain over the last ${pts.length} sessions: ${pts.join(", ")} out of 10. Limit ${A}.">
      <path d="M0 ${y(2)}H600M0 ${y(8)}H600" stroke="#f1f4f2" vector-effect="non-scaling-stroke"/>
      <path d="M0 258H600" stroke="#e3e8e5" vector-effect="non-scaling-stroke"/>
      <path d="M0 ${y(A)}H600" stroke="#c2410c" stroke-width="1.5" stroke-dasharray="6 6" opacity=".55" vector-effect="non-scaling-stroke"/>
      <path d="M0 ${y(pts[0])} L${line.split(" ").slice(1).join(" L")} L600 258 L0 258Z" fill="#e4572e" opacity=".12"/>
      <polyline points="${line}" fill="none" stroke="#e4572e" stroke-width="4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="row-between" style="font-size:.8125rem;color:var(--muted)"><span>${pts.length} sessions ago</span><span style="display:flex;align-items:center;gap:8px"><span style="width:22px;border-top:2px dashed #c2410c;opacity:.6"></span>Your limit (${A})</span><span>Latest: ${last}/10</span></div>`;
}

function formChart(sessions, items) {
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const series = items.map((it) => {
    const all = sessions.map((s) => exGood(s, it.ex)).filter((v) => v != null).map((v) => Math.round(v * 100));
    const trend = all.length > 3 ? mean(all.slice(-3)) - mean(all.slice(0, 3)) : 0;   // recent vs. start of the plan
    return { ex: it.ex, vals: all.slice(-7), trend };
  }).filter((s) => s.vals.length > 1);
  if (!series.length) return '<p class="muted">Not enough sessions yet.</p>';
  // the exercise slipping most, next to the steadiest one
  const chosen = [...series].sort((a, b) => a.trend - b.trend);
  const steadiest = chosen.slice(1).sort((a, b) => Math.abs(a.trend) - Math.abs(b.trend))[0];
  const pick = steadiest ? [chosen[0], steadiest] : chosen;
  const y = (v) => Math.max(4, Math.min(196, 200 - (v - 50) * 3.7));
  const color = (s) => (s.trend < -5 ? ["#f59e0b", "var(--warn-soft)", "#92400e"] : ["#4f63d2", "var(--indigo-soft)", "var(--indigo-ink)"]);
  const word = (t) => (t < -5 ? "dropping" : t > 5 ? "improving" : "steady");
  const lines = pick.map((s) => `<polyline points="${s.vals.map((v, i) => `${(i / (s.vals.length - 1) * 300).toFixed(0)},${y(v).toFixed(0)}`).join(" ")}" fill="none" stroke="${color(s)[0]}" stroke-width="3.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join("");
  return `<svg class="chart" viewBox="0 0 300 200" preserveAspectRatio="none" role="img" aria-label="${pick.map((s) => `${exName(s.ex)} ${s.vals[s.vals.length - 1]}% good reps, ${word(s.trend)}`).join("; ")}">
      <path d="M0 ${y(90)}H300M0 ${y(75)}H300M0 ${y(60)}H300" stroke="#f1f4f2" vector-effect="non-scaling-stroke"/>${lines}</svg>
    <div class="stack" style="gap:8px">${pick.map((s) => { const [c, bg, ink] = color(s); return `<div class="legend-pill" style="background:${bg}"><span style="display:flex;align-items:center;gap:8px;font-weight:600"><span class="dot" style="width:12px;height:12px;background:${c}"></span>${esc(exName(s.ex).replace(/^Shoulder /, ""))}</span><b style="color:${ink}">${s.vals[s.vals.length - 1]}% · ${word(s.trend)}</b></div>`; }).join("")}</div>`;
}

export async function patientDetailRoute({ user, params }) {
  const o = await getPatientOverview(user.dataId, params.id);
  if (!o) { toast("That patient isn’t on your care team."); go("#/provider"); return; }
  const { sessions, profile: p, user: pu, plan, alertAt: A } = o;
  const painFlag = o.flags.find((f) => f.kind === "pain");
  const painfulEx = o.draft?.suggestions.find((s) => s.kind === "adjust" && !s.progress)?.ex;
  const now = Date.now();
  const weeks = [2, 1, 0].map((w) => ({ l: `Wk ${3 - w}`, v: sessions.filter((s) => { const a = (now - Date.parse(s.startedAt)) / DAY; return a >= w * 7 && a < (w + 1) * 7; }).length }));
  const maxErr = Math.max(1, ...o.mistakes.slice(0, 3).map((m) => m.n));
  const recent = sessions.slice(-3).reverse();
  const pctOf = (s) => { const g = s.exercises.reduce((t, e) => t + e.good, 0), n = s.exercises.reduce((t, e) => t + e.done, 0); return n ? Math.round(g / n * 100) : 0; };

  const root = renderPage(`
    <div class="t2-head">
      <a class="back-pill" href="#/provider" aria-label="Back to all patients">${ICON.back}</a>
      <span class="avatar lg">${esc(initials(pu.name))}</span>
      <div style="flex:1 1 300px"><h1>${esc(pu.name)}</h1><div class="sub">${esc(p.condition)} · Week ${p.week} of ${p.totalWeeks} · Next visit ${esc(niceDate(p.nextVisit))}</div></div>
      <button type="button" class="btn btn-secondary" data-edit>Edit plan</button>
      ${o.draft ? `<a class="btn btn-primary" href="#/provider/plan/${encodeURIComponent(o.draft.id)}">Review AI plan</a>` : '<button type="button" class="btn btn-primary" disabled title="No AI draft right now">No AI draft</button>'}
    </div>
    ${painFlag ? `<div class="alert-banner" role="alert">${ICON.warn}<div class="txt"><b>Pain is above your limit.</b> Reported ${painFlag.pain}/10 in the last 2 sessions (was ${painFlag.was})${painfulEx ? `, mostly during ${esc(exName(painfulEx).toLowerCase())}` : ""}.</div><button type="button" class="link-btn" data-message>Message patient</button></div>` : ""}
    <div class="bento">
      <section class="card b-pain" aria-labelledby="painH">
        <div class="row-between" style="align-items:flex-start"><div><h2 id="painH">Reported pain</h2><div class="muted" style="font-size:.875rem">0-10 after each session</div></div>
          ${painFlag ? `<div style="text-align:right"><div style="font-size:2.125rem;font-weight:800;line-height:1;color:#c2410c">${painFlag.pain}<span style="font-size:1rem;color:var(--muted)">/10</span></div><div style="font-size:.8125rem;font-weight:700;color:#c2410c">↑ from ${painFlag.was}</div></div>`
            : `<div style="text-align:right;font-size:2.125rem;font-weight:800;line-height:1">${sessions[sessions.length - 1]?.checkin?.pain ?? "-"}<span style="font-size:1rem;color:var(--muted)">/10</span></div>`}</div>
        ${painChart(sessions, A)}
      </section>
      <section class="card b-form" aria-labelledby="formH"><h2 id="formH">Form accuracy</h2>${formChart(sessions, plan?.items || [])}</section>
      <section class="card b-def" aria-labelledby="defH">
        <div><h2 id="defH">Health deficits</h2><div class="muted" style="font-size:.8125rem">From clinic visit ${esc(new Date(p.visitDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</div></div>
        ${p.deficits.map((d) => `<div class="stack" style="gap:6px"><div class="row-between" style="font-size:.875rem"><span style="font-weight:600">${esc(d.label)}</span><span style="color:#55615a">${esc(d.value)}</span></div>
          <div class="bar-track" style="background:var(--indigo-soft)" role="img" aria-label="${d.pct}% of goal"><span style="width:${d.pct}%;background:var(--indigo);border-radius:99px"></span></div></div>`).join("")}
        <div style="font-size:.875rem;line-height:1.45"><b>Function:</b> <span style="color:#55615a">${esc(p.functionNote)}</span></div>
        ${p.precautions.length ? `<div class="stack" style="gap:6px;margin-top:auto"><div style="font-size:.8125rem;font-weight:700;color:var(--alert-ink)">Precautions</div><div class="chip-list">${p.precautions.map((x) => `<span class="tag alert" style="font-size:.75rem">${esc(x)}</span>`).join("")}</div></div>` : ""}
      </section>
      <section class="card b-adh" aria-labelledby="adhH">
        <div class="row-between"><h2 id="adhH" style="font-size:1rem">Adherence</h2><span class="muted" style="font-size:.8125rem">sessions/week · goal 5</span></div>
        <div class="adh-bars" role="img" aria-label="${weeks.map((w) => `${w.l}: ${w.v} sessions`).join(", ")}">${weeks.map((w) => `<div><span>${w.v}</span><i class="${w.v >= 5 ? "" : "under"}" style="height:${Math.max(6, w.v * 18)}px"></i><small>${w.l}</small></div>`).join("")}</div>
      </section>
      <section class="card b-recent" aria-labelledby="recH">
        <div class="row-between"><h2 id="recH" style="font-size:1rem">Recent sessions</h2></div>
        <div>${recent.map((s) => { const pain = s.checkin?.pain; return `<div class="recent-row"><span style="color:var(--muted);font-weight:600">${new Date(s.startedAt).toLocaleDateString(undefined, { weekday: "short" })}</span><span class="n">${s.checkin?.note ? `“${esc(s.checkin.note)}”` : "No note"}</span><span style="font-weight:600">${pctOf(s)}%</span><span class="tag ${pain >= A ? "alert" : ""}" style="font-size:.75rem;justify-content:center">Pain ${pain ?? "-"}</span></div>`; }).join("") || '<p class="muted">No shared sessions yet.</p>'}</div>
      </section>
      <section class="card b-err" aria-labelledby="errH">
        <div><h2 id="errH">Common form errors</h2><div class="muted" style="font-size:.8125rem">Last 3 sessions</div></div>
        ${o.mistakes.slice(0, 3).map((m) => `<div class="stack" style="gap:6px"><div class="row-between" style="font-size:.875rem"><span style="font-weight:600">${esc(m.title)}</span><span style="color:#55615a">${m.n} reps</span></div>
          <div class="bar-track" style="background:var(--warn-soft)"><span style="width:${Math.round(m.n / maxErr * 100)}%;background:var(--warn);border-radius:99px"></span></div>
          <div class="row-between" style="font-size:.75rem;color:var(--muted)"><span>${esc(exName(m.ex))}</span><button type="button" class="link-btn" style="min-height:0;font-size:.75rem" data-clips>Watch clips</button></div></div>`).join("") || '<p class="muted">No form errors recorded.</p>'}
      </section>
    </div>`, { active: "patients", user, title: pu.name });
  root.querySelector("[data-edit]").onclick = () => comingSoon("Manual plan editing");
  root.querySelector("[data-message]")?.addEventListener("click", () => {
    go(`#/provider/messages?with=${encodeURIComponent(o.id)}`);
  });
  root.querySelectorAll("[data-clips]").forEach((b) => b.addEventListener("click", () => comingSoon("Watching clips")));
}
