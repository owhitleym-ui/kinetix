// P6 · My progress: sessions, good-form trend, pain, each exercise, and what to keep working on, in plain language.
import { PAIN_FACES, esc, face, ring } from "../ui.js";
import { exIcon, exName, plainCue, plainLine } from "../exerciseText.js";
import { getProgress } from "../data.js";
import { renderPage } from "./chrome.js";

const in10 = (v) => Math.round(v * 10);
const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const FLOOR = 0.4;   // chart starts at 4 in 10 so session-to-session changes are visible
const barH = (g) => Math.max(3, Math.round((Math.max(g, FLOOR) - FLOOR) / (1 - FLOOR) * 100));
const painFace = (p) => PAIN_FACES.reduce((a, b) => (Math.abs(b.v - p) < Math.abs(a.v - p) ? b : a));

function changeTag(then, now, sessions) {
  if (sessions < 4) return '<span class="tag white">Just started</span>';
  const d = in10(now) - in10(then);
  if (d > 0) return `<span class="tag mint">↑ up from ${in10(then)}</span>`;
  if (d < 0) return `<span class="tag warn">↓ was ${in10(then)}</span>`;
  return '<span class="tag blue">Steady</span>';
}

export async function progressRoute({ user }) {
  const pr = await getProgress(user.dataId);
  const ptName = pr.pt?.short || "your PT";

  if (!pr.count) {
    renderPage(`<div class="card stub-card"><span class="stub-ic">${face(PAIN_FACES[0], 40, "#166534")}</span><h1>My progress</h1>
      <p>Your progress shows up here after your first session.</p><a class="btn btn-primary" href="#/patient">Go to today’s plan</a></div>`,
    { active: "progress", user, title: "My progress" });
    return;
  }

  const goodNow = in10(pr.goodNow), goodThen = in10(pr.goodThen);
  const goodLine = pr.count < 4 ? "Keep going. Your trend shows up after a few sessions."
    : goodNow > goodThen ? `Up from ${goodThen} in 10 when you started.`
    : goodNow < goodThen ? `It was ${goodThen} in 10 at the start. Slow, steady reps help.` : "Same as when you started. Nice and steady.";
  const pf = pr.painNow == null ? null : painFace(pr.painNow);
  const painLine = pr.painNow == null ? "Rate your pain after a session to see it here."
    : pr.painNow >= pr.alertAt ? `That’s high. Let ${esc(ptName)} know before your next session.`
    : pr.painThen != null && pr.painNow < pr.painThen ? `Down from ${pr.painThen} when you started.`
    : pr.painThen != null && pr.painNow > pr.painThen ? `Up from ${pr.painThen}. Tell ${esc(ptName)} if it keeps climbing.` : "About the same as when you started.";

  const bars = pr.perSession.slice(-16);
  renderPage(`
    <div><h1 class="pr-title">My progress</h1>
      <p class="muted pr-sub">Since ${esc(shortDate(pr.since))} · ${pr.count} session${pr.count === 1 ? "" : "s"} · ${pr.totalReps.toLocaleString()} reps</p></div>
    <div class="stat3">
      <section class="card"><span class="stat-h">This week</span>
        ${ring({ size: 104, value: pr.thisWeek / pr.goal, label: `${pr.thisWeek}/${pr.goal}`, sub: "sessions", aria: `${pr.thisWeek} of ${pr.goal} sessions this week` })}
        <span class="muted">${pr.count} sessions in total</span></section>
      <section class="card"><span class="stat-h">Good form</span>
        ${ring({ size: 104, value: pr.goodNow, color: "var(--indigo)", label: `${goodNow}<span style="font-size:.875rem"> in 10</span>`, sub: "reps", aria: `${goodNow} in 10 reps looked good recently` })}
        <span class="muted">${goodLine}</span></section>
      <section class="card"><span class="stat-h">Pain</span>
        ${pf ? `<span class="pr-face" role="img" aria-label="Last pain rating ${pr.painNow} out of 10, ${pf.word}">${face(pf, 84)}</span><b>${pr.painNow}/10 · ${esc(pf.word)}</b>` : ""}
        <span class="muted">${painLine}</span></section>
    </div>
    <div class="pr-grid">
      <section class="card pr-chart-card" aria-labelledby="trendTitle">
        <div class="row-between"><h2 id="trendTitle" class="card-title">Good reps, session by session</h2><span class="muted" style="font-size:.875rem;white-space:nowrap">Last ${bars.length}</span></div>
        <div class="pr-plot"><div class="pr-grid-lines" aria-hidden="true"><span>10 in 10</span><span>7 in 10</span><span>4 in 10</span></div>
        <div class="pr-bars" role="img" aria-label="Share of good reps per session: ${bars.map((b) => `${in10(b.good)} in 10`).join(", ")}">
          ${bars.map((b, i) => `<span class="${i === bars.length - 1 ? "last" : ""}" style="--h:${barH(b.good)}%;--i:${i}" title="${esc(shortDate(b.at))}: ${in10(b.good)} in 10 good${b.pain != null ? ` · pain ${b.pain}/10` : ""}"></span>`).join("")}
        </div></div>
        <div class="pr-axis"><span>${esc(shortDate(bars[0].at))}</span><span>${bars.length > 1 ? esc(shortDate(bars[bars.length - 1].at)) : ""}</span></div>
      </section>
      <section class="card pr-focus-card" aria-labelledby="focusTitle">
        <h2 id="focusTitle" class="card-title">Keep working on</h2>
        ${pr.focus.length ? `<ol class="pr-focus">${pr.focus.map((m) => `<li><span class="pr-ic">${exIcon(m.ex)}</span><div><b>${esc(plainCue(m.code))}</b><small>${esc(plainLine(m.code))}</small><small class="pr-ex-name">${esc(exName(m.ex))} · ${m.n} rep${m.n === 1 ? "" : "s"} lately</small></div></li>`).join("")}</ol>`
          : '<p class="muted" style="margin:0">Nothing stands out. Your recent reps look great.</p>'}
      </section>
    </div>
    <section class="card" aria-labelledby="exTitle">
      <h2 id="exTitle" class="card-title">Each exercise</h2>
      <ul class="pr-exlist">${pr.exercises.map((e) => `<li><span class="pr-ic">${exIcon(e.ex)}</span>
          <div class="pr-ex-main"><div class="row-between"><b>${esc(exName(e.ex))}</b>${changeTag(e.then, e.now, e.sessions)}</div>
            <div class="bar-track" aria-hidden="true"><span class="pr-fill" style="width:${Math.round(e.now * 100)}%"></span></div>
            <small class="muted">${in10(e.now)} in 10 reps look good · ${e.sessions} session${e.sessions === 1 ? "" : "s"}</small></div></li>`).join("")}</ul>
    </section>`, { active: "progress", user, title: "My progress" });
}
