// Patient (or PT) view of a published plan report — print / save as PDF again.
import { ICON, esc, toast } from "../ui.js";
import { getPlanReport } from "../data.js";
import { buildReportDocument, downloadReport, printReport } from "../report.js";
import { renderPage, stubPage } from "./chrome.js";
import { go } from "../router.js";

export function planReportRoute({ user, params }) {
  const report = getPlanReport(params.reportId);
  if (!report) {
    stubPage("This report is no longer available", {
      active: "messages",
      user,
      title: "Plan report",
    });
    return;
  }
  // Care-team only
  const ok = user.role === "pt"
    ? (!report.ptId || report.ptId === user.dataId)
    : report.patientId === user.dataId;
  if (!ok) {
    toast("You don’t have access to that report.");
    go(user.role === "pt" ? "#/provider/messages" : "#/patient/messages");
    return;
  }

  const back = user.role === "pt"
    ? `#/provider/messages?with=${encodeURIComponent(report.patientId)}`
    : `#/patient/messages?with=${encodeURIComponent(report.ptId || "")}`;

  const root = renderPage(`
    <div class="t2-head">
      <a class="back-pill" href="${back}" aria-label="Back to messages">${ICON.back}</a>
      <div style="flex:1 1 280px">
        <div class="lbl">Plan report</div>
        <h1 style="margin:2px 0 0;font-size:1.5rem;font-weight:700">${esc(report.patientName)}</h1>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button type="button" class="btn btn-secondary md" data-download>Download</button>
        <button type="button" class="btn btn-primary md" data-print>Print / Save as PDF</button>
      </div>
    </div>
    <div class="card bordered report-frame" data-frame></div>
  `, { active: "messages", user, title: "Plan report" });

  const frame = root.querySelector("[data-frame]");
  frame.innerHTML = buildReportDocument(report)
    .replace(/^[\s\S]*<body[^>]*>/i, "")
    .replace(/<\/body>[\s\S]*$/i, "");

  root.querySelector("[data-print]")?.addEventListener("click", () => {
    const r = printReport(report);
    if (!r.ok) toast("Allow pop-ups to print or save as PDF.");
  });
  root.querySelector("[data-download]")?.addEventListener("click", () => {
    downloadReport(report);
    toast("Report downloaded.");
  });
}
