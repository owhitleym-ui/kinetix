// Where the coach API lives. Local dev (127.0.0.1 / localhost) keeps coach.js's default of
// http://127.0.0.1:8000; everywhere else (the Vercel site) uses the OCI backend.
if (!["127.0.0.1", "localhost"].includes(location.hostname)) {
  window.FORM_CHECK_API = "https://207-211-163-177.sslip.io";
}

// Neural TTS proxy (voice-feedback/server). Local only unless you deploy a TTS endpoint.
if (["127.0.0.1", "localhost"].includes(location.hostname)) {
  window.FORM_CHECK_TTS = "http://127.0.0.1:3002";
}
