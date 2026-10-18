// P1 · Patient home: greeting, Today's plan (warm-up, then numbered exercises), PT feedback card, Your week.
import { ICON, esc, greeting, initials, longDate, niceDate, ring } from "../ui.js";
import { exIcon, dose } from "../exerciseText.js";
import { getPatientHome } from "../data.js";
import { renderPage } from "./chrome.js";
import { go } from "../router.js";
import { beginPlanRun } from "../planRun.js";

export async function patientHomeRoute({ user }) {
  const pid = user.dataId;
  const h = await getPatientHome(pid);
  const g = greeting();
  const items = h.plan?.items || [];
  const minutes = 5 + items.reduce((t, i) => t + Math.ceil(i.sets * i.reps / 6), 0);
  const msg = h.plan?.message;
  const ptName = h.pt?.short || "your PT";
  const good = h.goodThisWeek, prev = h.goodLastWeek;
  const in10 = good == null ? null : Math.round(good * 10), prev10 = prev == null ? null : Math.round(prev * 10);
  const trend = in10 == null ? "Finish a session to see how your reps look." :
    prev10 == null ? "" : in10 > prev10 ? `That’s up from ${prev10} last week.` : in10 < prev10 ? `Last week it was ${prev10}. You’ve got this.` : "Same as last week — nice and steady.";

  const root = renderPage(`
    <div class="greet"><span class="sun-badge ${g.cls}">${g.icon}</span><div><div class="greet-date">${esc(longDate())}</div><h1>${g.word}, ${esc(user.first || "")}</h1></div></div>
    <div class="p1-grid">
      <section class="card p1-plan" aria-labelledby="planTitle">
        <div class="row-between"><h2 id="planTitle" style="font-size:1.375rem;font-weight:800">Today’s plan</h2><span class="muted" style="font-weight:500">About ${minutes} minutes</span></div>
        <div class="warm-block"><div style="flex:1;min-width:0"><b>Warm-up</b><small>9 gentle moves · 5 min · no camera needed</small></div><span class="tag white" style="color:var(--primary-ink)">Start here</span></div>
        <div class="then-row">${ICON.down}then your exercises</div>
        <ol class="ex-row" style="list-style:none;margin:0;padding:0">
          ${items.map((it, i) => `<li class="ex-step"><div class="ex-tile">
              <div class="ex-tile-top"><span class="ex-num" aria-label="Exercise ${i + 1}">${i + 1}</span><span class="tag ${it.tag.cls}">${esc(it.tag.text)}</span></div>
              <div class="ex-art">${exIcon(it.ex)}</div>
              <div><b>${esc(it.name)}</b><small>${esc(dose(it))}</small>${it.cue ? `<small style="color:var(--accent-strong)">Tip: ${esc(it.cue)}</small>` : ""}</div>
            </div>${i < items.length - 1 ? ICON.arrow : ""}</li>`).join("") || '<li class="muted">Your PT hasn’t set a plan yet.</li>'}
        </ol>
        <div class="center-row" style="padding-top:4px"><button type="button" class="btn btn-primary lg" data-start ${items.length ? "" : "disabled"}>${ICON.play}Start today’s session</button></div>
        <div class="center-row"><a href="#/library" style="font-weight:700;font-size:.9375rem">Practise something else</a></div>
      </section>
      <aside class="p1-side">
        ${h.pt ? `<section class="pt-card" aria-label="Feedback from your PT">
          <div class="who"><span class="avatar blue">${esc(initials(h.pt.name))}</span><div><b>From ${esc(ptName)}</b><small>${h.plan?.changes ? `Updated your plan · ${h.plan.changes} change${h.plan.changes === 1 ? "" : "s"}` : "Your current plan"}</small></div></div>
          ${msg?.text ? `<blockquote>“${esc(msg.text)}”</blockquote>` : ""}
          <div class="pt-limit">${ICON.info}<span>Stop and message me if pain goes above ${h.alertAt} out of 10.</span></div>
          <div class="pt-foot"><span>${ICON.calendar}Next visit <b>${esc(h.profile?.nextVisit ? niceDate(h.profile.nextVisit) : "not booked")}</b></span><button type="button" class="link-btn" data-message>Message</button></div>
        </section>` : ""}
        <section class="card" style="flex:1;display:flex;flex-direction:column;gap:16px" aria-labelledby="weekTitle">
          <div class="row-between"><h3 id="weekTitle" style="font-size:1.125rem;font-weight:800">Your week</h3><span class="muted" style="font-weight:500">${h.sessionsThisWeek} of ${h.goal} sessions</span></div>
          <div class="week-dots" role="list">${h.week.map((d) => `<div role="listitem" aria-label="${d.full}: ${d.done ? "done" : d.today ? "today" : "rest"}"><span aria-hidden="true">${d.label}</span><span class="wd${d.done ? " done" : ""}${d.today ? " today" : ""}" aria-hidden="true"></span></div>`).join("")}</div>
          <div class="week-ring">${ring({ size: 54, value: good ?? 0, stroke: 14, track: "#fff" })}
            <div>${in10 == null ? trend : `<b>${in10} in 10 reps</b> looked good this week. ${trend}`}</div></div>
        </section>
      </aside>
    </div>`, { active: "today", user, title: "Today" });
  root.querySelector("[data-start]")?.addEventListener("click", () => { beginPlanRun(pid, h.plan); go("#/patient/warmup"); });
  root.querySelector("[data-message]")?.addEventListener("click", () => {
    if (h.pt?.id) go(`#/patient/messages?with=${encodeURIComponent(h.pt.id)}`);
    else go("#/patient/messages");
  });
}
