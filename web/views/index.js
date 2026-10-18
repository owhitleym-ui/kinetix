// Registers every routed (non-camera) view. The warm-up, recording choice, live session and library routes are
// registered by app.js, which owns the camera engine.
import { route, showScreen } from "../router.js";
import { getSettings } from "../data.js";
import { landingRoute, signinRoute } from "./landing.js";
import { patientHomeRoute } from "./patientHome.js";
import { summaryRoute } from "./summary.js";
import { applyTextSize, patientSettingsRoute } from "./patientSettings.js";
import { caseloadRoute, draftsRoute } from "./caseload.js";
import { patientDetailRoute } from "./patientDetail.js";
import { aiPlanRoute } from "./aiPlan.js";
import { providerSettingsRoute } from "./providerSettings.js";
import { progressRoute } from "./progress.js";
import { messagesRoute } from "./messages.js";
import { planReportRoute } from "./planReport.js";

/** Patients get their own text size everywhere; everyone else sees the default. */
export function applyUserPrefs(user) {
  applyTextSize(user?.role === "patient" ? getSettings(user.dataId).textSize : 0);
}
const page = (fn) => (ctx) => { showScreen("app"); applyUserPrefs(ctx.user); return fn(ctx); };

route("/", page(landingRoute));
route("/signin", page(signinRoute));
route("/patient", page(patientHomeRoute), { role: "patient" });
route("/patient/progress", page(progressRoute), { role: "patient" });
route("/patient/messages", page(messagesRoute), { role: "patient" });
route("/patient/report/:reportId", page(planReportRoute), { role: "patient" });
route("/patient/summary", page(summaryRoute), { role: "patient" });
route("/patient/settings", page(patientSettingsRoute), { role: "patient" });
route("/provider", page(caseloadRoute), { role: "pt" });
route("/provider/drafts", page(draftsRoute), { role: "pt" });
route("/provider/messages", page(messagesRoute), { role: "pt" });
route("/provider/report/:reportId", page(planReportRoute), { role: "pt" });
route("/provider/patient/:id", page(patientDetailRoute), { role: "pt" });
route("/provider/plan/:draftId", page(aiPlanRoute), { role: "pt" });
route("/provider/settings", page(providerSettingsRoute), { role: "pt" });
