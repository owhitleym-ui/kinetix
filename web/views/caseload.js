// T1 · Provider caseload: who needs attention today, then every patient with a search pill.
import { ICON, comingSoon, esc, greeting, initials, relDay } from "../ui.js";
import { getCaseload, userRecord } from "../data.js";
import { renderPage } from "./chrome.js";

const DOT = { good: "var(--primary)", pain: "var(--alert)", missed: "#d99a1e", form: "var(--indigo)" };

export async function caseloadRoute({ user }) {
  const ptId = user.dataId;
  const { rows, attention } = await getCaseload(ptId);
  const g = greeting();
  const me = userRecord(ptId);
  const sorted = [...rows].sort((a, b) => (b.flags.length - a.flags.length) || a.user.name.localeCompare(b.user.name));
  const row = (r) => `<a class="pt-row" href="#/provider/patient/${encodeURIComponent(r.id)}" data-name="${esc(r.user.name.toLowerCase())} ${esc((r.profile?.program || "").toLowerCase())}">
      <span class="who"><span class="avatar sm">${esc(initials(r.user.name))}</span><span style="min-width:0"><b>${esc(r.user.name)}</b><small>${esc(r.profile?.program || "")} · week ${r.profile?.week ?? "–"}</small></span></span>
      <span style="color:#4a524d">${r.last ? relDay(r.last.startedAt) : "No sessions"}</span>
      <span class="status"><span class="dot" style="background:${DOT[r.status.kind]}"></span>${esc(r.status.text)}</span>
      <span>${r.draft ? '<span class="tag mint">Draft ready</span>' : '<span class="muted">—</span>'}</span>${ICON.chev}</a>`;

  const root = renderPage(`
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:16px">
      <div class="greet"><span class="sun-badge ${g.cls}">${g.icon}</span><div><h1>${g.word}, ${esc(me?.short || user.name)}</h1>
        <p>${attention.length ? `${attention.length} patient${attention.length === 1 ? " needs" : "s need"} you today.` : "Everyone is on track today."}</p></div></div>
      <button type="button" class="btn btn-primary" data-invite>Invite patient</button>
    </div>
    ${attention.length ? `<section class="stack" aria-labelledby="attnH"><h2 id="attnH" style="margin:0;font-size:1.125rem;font-weight:700">Needs your attention</h2>
      <div class="attn-grid">${attention.slice(0, 3).map((r) => {
        const f = r.flags[0];
        return `<article class="attn-card"><div class="who"><span class="avatar">${esc(initials(r.user.name))}</span><div style="min-width:0"><b>${esc(r.user.name)}</b><small>${esc(r.profile?.program || "")} · week ${r.profile?.week}</small></div></div>
          <div class="reason ${f.kind}"><b>${esc(f.reason)}</b><span>${esc(f.detail)}</span></div>
          <div class="attn-foot"><span>${r.draft ? "AI plan draft ready" : "No draft"}</span><a class="btn btn-dark sm" href="#/provider/patient/${encodeURIComponent(r.id)}" aria-label="Review ${esc(r.user.name)}">Review</a></div></article>`;
      }).join("")}</div></section>` : ""}
    <section class="card table-card" aria-labelledby="allH">
      <div class="table-head"><h2 id="allH">All patients</h2><span class="muted" style="font-size:.875rem">${rows.length} active</span>
        <label class="search-pill">${ICON.search}<input type="search" aria-label="Search patients" placeholder="Search patients" data-search></label></div>
      <div class="pt-table"><div class="pt-table-in" role="table" aria-label="All patients">
        <div class="pt-row head" role="row"><span>Patient</span><span>Last session</span><span>How it’s going</span><span>Plan</span><span></span></div>
        <div data-rows>${sorted.map(row).join("")}</div>
        <p class="muted" data-none hidden style="padding:14px 22px;margin:0">No patients match that search.</p>
      </div></div>
    </section>`, { active: "patients", user, title: "Patients" });
  root.querySelector("[data-invite]").onclick = () => comingSoon("Inviting patients");
  root.querySelector("[data-search]").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase(); let n = 0;
    root.querySelectorAll("[data-rows] .pt-row").forEach((a) => { const hit = !q || a.dataset.name.includes(q); a.hidden = !hit; n += hit; });
    root.querySelector("[data-none]").hidden = n > 0;
  });
}

/** "Plan drafts" nav: open the first draft waiting for review. */
export async function draftsRoute({ user }) {
  const { rows } = await getCaseload(user.dataId);
  const r = rows.find((x) => x.draft && x.flags.length) || rows.find((x) => x.draft);
  if (r) location.replace(`#/provider/plan/${encodeURIComponent(r.draft.id)}`);
  else { const { stubPage } = await import("./chrome.js"); stubPage("No plan drafts waiting", { active: "drafts", user }); }
}
