// Coach API (GenAI). Local uses http://127.0.0.1:8000 via coach.js default.
// ATP API (auth + Oracle sessions) defaults to http://127.0.0.1:3001 in auth.js.
if (!["127.0.0.1", "localhost"].includes(location.hostname)) {
  window.FORM_CHECK_API = "https://207-211-163-177.sslip.io";
  // Override in production when the ATP service is publicly reachable:
  // window.FORM_CHECK_ATP = "https://your-atp-api.example.com";
}

// Neural TTS proxy (voice-feedback/server). Local only unless you deploy a TTS endpoint.
if (["127.0.0.1", "localhost"].includes(location.hostname)) {
  window.FORM_CHECK_TTS = "http://127.0.0.1:3002";
}
