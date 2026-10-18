// Messages · patient and PT share one inbox + thread UI (demo store).
import { ICON, esc, greeting, initials, relDay, toast } from "../ui.js";
import {
  canMessage, markThreadRead, messagesBetween, sendMessage, threadPair, threadsFor, userRecord,
} from "../data.js";
import { renderPage } from "./chrome.js";
import { go } from "../router.js";

function preview(text, n = 72) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function msgTime(iso) {
  const d = new Date(iso);
  const day = relDay(iso);
  const t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return day === "Today" ? t : `${day} · ${t}`;
}

function inboxHref(user, counterpartId) {
  const base = user.role === "pt" ? "#/provider/messages" : "#/patient/messages";
  return `${base}?with=${encodeURIComponent(counterpartId)}`;
}

function inboxBase(user) {
  return user.role === "pt" ? "#/provider/messages" : "#/patient/messages";
}

function renderInbox(user) {
  const threads = threadsFor(user.dataId);
  const unreadTotal = threads.reduce((n, t) => n + t.unread, 0);
  const g = greeting();
  const emptyHint = user.role === "pt"
    ? "When a patient messages you, it shows up here."
    : "Message your physical therapist when you have a question.";
  const subtitle = threads.length
    ? (user.role === "pt"
      ? (unreadTotal ? `${unreadTotal} unread · ${threads.length} patients` : `${threads.length} patients on your care team`)
      : "Chat with your care team.")
    : emptyHint;
  const countLabel = user.role === "pt"
    ? `${threads.length} patient${threads.length === 1 ? "" : "s"}`
    : `${threads.length} conversation${threads.length === 1 ? "" : "s"}`;

  const row = (t) => {
    const name = t.counterpart?.short || t.counterpart?.name || "Unknown";
    const whoSub = preview(t.last?.text || (user.role === "pt" ? "No messages yet" : "Say hello to your PT"), 48);
    const search = `${(t.counterpart?.name || "").toLowerCase()} ${(t.last?.text || "").toLowerCase()}`;
    return `<a class="pt-row msg-row" href="${inboxHref(user, t.counterpartId)}" data-name="${esc(search)}">
      <span class="who"><span class="avatar sm ${user.role === "patient" ? "blue" : ""}">${esc(initials(t.counterpart?.name))}</span>
        <span style="min-width:0"><b>${esc(name)}</b><small>${esc(whoSub)}</small></span></span>
      <span class="msg-preview muted">${esc(preview(t.last?.text || "", 90) || "No messages yet")}</span>
      <span style="color:#4a524d">${t.last ? relDay(t.last.at) : "—"}</span>
      <span class="msg-unread">${t.unread ? `<span class="unread-pill" aria-label="${t.unread} unread">${t.unread}</span>` : '<span class="muted">—</span>'}</span>
      ${ICON.chev}</a>`;
  };

  const root = renderPage(`
    <div class="greet"><span class="sun-badge ${g.cls}">${g.icon}</span><div><h1>Messages</h1>
      <p>${esc(subtitle)}</p></div></div>
    <section class="card table-card" aria-labelledby="msgH">
      <div class="table-head"><h2 id="msgH">${user.role === "pt" ? "Conversations" : "Your care team"}</h2>
        <span class="muted" style="font-size:.875rem">${esc(countLabel)}</span>
        <label class="search-pill">${ICON.search}<input type="search" aria-label="Search messages" placeholder="Search" data-search></label></div>
      <div class="pt-table"><div class="pt-table-in msg-table-in" role="table" aria-label="Conversations">
        <div class="pt-row msg-row head" role="row"><span>Name</span><span>Preview</span><span>When</span><span>Unread</span><span></span></div>
        <div data-rows>${threads.length ? threads.map(row).join("") : `<p class="muted" style="padding:22px;margin:0">${esc(emptyHint)}</p>`}</div>
        <p class="muted" data-none hidden style="padding:14px 22px;margin:0">No conversations match that search.</p>
      </div></div>
    </section>`, { active: "messages", user, title: "Messages" });

  root.querySelector("[data-search]")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    let n = 0;
    root.querySelectorAll("[data-rows] .msg-row").forEach((a) => {
      const hit = !q || (a.dataset.name || "").includes(q);
      a.hidden = !hit;
      n += hit ? 1 : 0;
    });
    const none = root.querySelector("[data-none]");
    if (none) none.hidden = n > 0 || !threads.length;
  });
}

function renderThread(user, counterpartId) {
  const pair = threadPair(user.dataId, counterpartId);
  if (!pair) {
    toast("You can only message your care team.");
    go(inboxBase(user));
    return;
  }
  markThreadRead(user.dataId, pair.patientId, pair.ptId);
  const other = userRecord(counterpartId);
  const name = other?.short || other?.name || "Conversation";
  const sub = user.role === "pt"
    ? (other?.email || "Patient")
    : (other?.clinic || "Your physical therapist");

  const paint = () => {
    const msgs = messagesBetween(pair.patientId, pair.ptId);
    const root = renderPage(`
      <div class="t2-head">
        <a class="back-pill" href="${inboxBase(user)}" aria-label="Back to messages">${ICON.back}</a>
        <span class="avatar lg ${user.role === "patient" ? "blue" : ""}">${esc(initials(other?.name))}</span>
        <div style="flex:1 1 240px"><h1>${esc(name)}</h1><div class="sub">${esc(sub)}</div></div>
      </div>
      <section class="card msg-thread-card" aria-label="Conversation with ${esc(name)}">
        <div class="msg-thread" data-thread>
          ${msgs.length
            ? msgs.map((m) => {
              const mine = m.from === user.dataId;
              const reportHref = m.kind === "plan_report" && m.reportId
                ? (user.role === "pt"
                  ? `#/provider/report/${encodeURIComponent(m.reportId)}`
                  : `#/patient/report/${encodeURIComponent(m.reportId)}`)
                : null;
              return `<div class="msg-bubble ${mine ? "me" : "them"}${reportHref ? " has-report" : ""}">
                <p>${esc(m.text)}</p>
                ${reportHref ? `<a class="btn ${mine ? "btn-secondary" : "btn-primary"} sm msg-report-cta" href="${reportHref}">Access your report</a>` : ""}
                <time class="msg-meta" datetime="${esc(m.at)}">${esc(msgTime(m.at))}</time>
              </div>`;
            }).join("")
            : `<p class="muted msg-empty">No messages yet. Say hello below.</p>`}
        </div>
        <form class="msg-compose" data-compose>
          <label class="field" style="flex:1;min-width:0"><span class="sr-only">Message</span>
            <textarea name="text" rows="2" placeholder="Write a message…" required maxlength="2000"></textarea></label>
          <button type="submit" class="btn btn-primary">Send</button>
        </form>
      </section>`, { active: "messages", user, title: name });

    const threadEl = root.querySelector("[data-thread]");
    if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;

    root.querySelector("[data-compose]")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const ta = e.currentTarget.querySelector("textarea");
      const text = ta?.value || "";
      const sent = sendMessage({ from: user.dataId, patientId: pair.patientId, ptId: pair.ptId, text });
      if (!sent) { toast("Couldn’t send that message."); return; }
      paint();
    });
  };
  paint();
}

export function messagesRoute({ user, query }) {
  const withId = (query.with || "").trim();
  if (withId && canMessage(user.dataId, withId)) {
    renderThread(user, withId);
    return;
  }
  if (withId) {
    toast("You can only message your care team.");
    go(inboxBase(user));
    return;
  }
  renderInbox(user);
}
