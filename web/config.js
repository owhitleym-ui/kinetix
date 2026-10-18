// API + TTS base URLs.
// Local: separate ports. On OCI (Option 1 nginx): same origin.
// ATP auth API defaults to http://127.0.0.1:3001 in auth.js unless FORM_CHECK_ATP is set.

const isLocal = ["127.0.0.1", "localhost"].includes(location.hostname);

if (isLocal) {
  window.FORM_CHECK_API = "http://127.0.0.1:8000";
  window.FORM_CHECK_TTS = "http://127.0.0.1:3002";
} else {
  // Production on OCI VM — nginx serves web/ and proxies /coach, /sessions, /health, /tts
  window.FORM_CHECK_API = location.origin;
  window.FORM_CHECK_TTS = location.origin;
  // If ATP API is exposed on the same host later:
  // window.FORM_CHECK_ATP = location.origin;
}
