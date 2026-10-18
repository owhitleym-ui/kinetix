// API + TTS base URLs.
// Local: separate ports. Vercel: public OCI backend. Same-host OCI nginx: location.origin.
// ATP auth defaults to http://127.0.0.1:3001 in auth.js unless FORM_CHECK_ATP is set.

/** Public OCI backend (nginx → FastAPI + TTS). Must be HTTPS when the UI is on Vercel. */
const OCI_BACKEND = "https://207-211-163-177.sslip.io";

const isLocal = ["127.0.0.1", "localhost"].includes(location.hostname);
const isVercel =
  location.hostname.endsWith(".vercel.app") ||
  location.hostname === "vercel.app";

if (isLocal) {
  window.FORM_CHECK_API = "http://127.0.0.1:8000";
  window.FORM_CHECK_TTS = "http://127.0.0.1:3002";
} else if (isVercel) {
  window.FORM_CHECK_API = OCI_BACKEND;
  window.FORM_CHECK_TTS = OCI_BACKEND;
  // When ATP Node API is proxied on the same OCI host:
  // window.FORM_CHECK_ATP = OCI_BACKEND;
} else {
  // Served from the OCI VM itself (Option 1 nginx)
  window.FORM_CHECK_API = location.origin;
  window.FORM_CHECK_TTS = location.origin;
}
