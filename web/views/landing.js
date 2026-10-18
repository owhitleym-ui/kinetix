// Landing page (public) + the sign-in / create-account modal over the blurred landing.
import { ICON, comingSoon, esc, logo, openModal, ring, toast } from "../ui.js";
import { atpReachable, currentUser, homeFor, registerAtp, signInAtp, signInDemo } from "../account.js";
import { resetMode, users } from "../data.js";
import { go, onLeave, showScreen } from "../router.js";

const check = `<span class="ck">${ICON.check}</span>`;
const skeleton = `<svg viewBox="0 0 200 300" aria-hidden="true"><g stroke="#dfe7e2" stroke-width="3" stroke-linecap="round" fill="none"><circle cx="100" cy="40" r="18"/><path d="M100 58V160M70 80H130M100 160L80 240M100 160L120 240M70 80L50 140"/></g><g class="l-arm"><path d="M130 80L188 66" stroke="#4ade80" stroke-width="5" stroke-linecap="round"/><g fill="#4ade80"><circle cx="130" cy="80" r="5"/><circle cx="188" cy="66" r="5"/></g></g></svg>`;

const STEPS = [
  ["Your PT sets the plan", "Exercises, reps and form cues come from your physical therapist, not a generic app.", "var(--primary-soft)", "var(--primary-ink)"],
  ["Practise with live feedback", "Warm up, then your camera tracks each rep and tells you what to fix, out loud and on screen.", "var(--accent-soft)", "var(--accent-strong)"],
  ["Your plan adapts", "AI drafts changes from your sessions and check-ins. Your PT reviews and approves every one.", "var(--sun)", "var(--sun-ink)"],
];
const PATIENT_PTS = [
  ["A gentle warm-up first", "Five minutes, no camera, to get your body ready."],
  ["Cues you can see across the room", "Big rep counter and one clear thing to focus on."],
  ["Progress in plain language", "“9 in 10 reps looked good” instead of confusing numbers."],
  ["You choose what happens to your video", "Share clips with your PT, or keep it on your device."],
];
const PROVIDER_PTS = [
  ["Know who needs you first", "Pain, missed days and slipping form rise to the top."],
  ["Pain, form and adherence in one view", "Alongside health deficits and precautions from your visits."],
  ["AI-drafted plans you approve", "Every suggestion shows its evidence. Nothing changes without you."],
  ["Clips of the reps that matter", "When patients choose to share video."],
];
const PRIVACY = [
  ["Your video, your choice", "Record and share with your PT, or don’t save video at all. Change it any time."],
  ["Only your care team", "Your physical therapist sees your progress. No one else."],
  ["A human always decides", "AI suggestions never reach a patient until their PT approves them."],
];
const SAMPLE = [
  ["Sam R.", "Rotator cuff repair · week 3", "Pain went up", "alert"],
  ["Marcus C.", "Post-op knee · week 2", "Missed 4 days", "warn"],
  ["Elena T.", "Hip osteoarthritis · week 8", "Form slipping", "indigo"],
];
const checks = (list) => `<ul class="l-checks">${list.map(([t, d]) => `<li>${check}<span><b>${t}</b><br><span class="d">${d}</span></span></li>`).join("")}</ul>`;

function landingHTML() {
  return `<div class="landing">
  <header class="landing-header">
    <a class="brand" href="#/">${logo(52)}Kinetix</a>
    <nav aria-label="Main"><a href="#how" data-anchor>How it works</a><a href="#patients" data-anchor>For patients</a><a href="#providers" data-anchor>For providers</a><a href="#privacy" data-anchor>Privacy</a></nav>
    <div style="display:flex;gap:8px"><a class="btn btn-secondary" href="#/signin">Sign in</a><a class="btn btn-primary" href="#/signin?mode=register">Get started</a></div>
  </header>
  <main>
  <section class="l-section l-hero">
    <div class="l-hero-copy" data-reveal="left">
      <span class="l-pill">Physical therapy, between visits</span>
      <h1>Your PT’s plan, coached at home.</h1>
      <p class="l-lede">Kinetix watches your form through your camera, gives you live cues on every rep, and shares your progress with your physical therapist, so your plan keeps up with you.</p>
      <div class="l-cta"><a class="btn btn-primary lg" href="#/signin?role=patient">I’m a patient</a><a class="btn btn-secondary lg" href="#/signin?role=provider">I’m a provider</a></div>
      <p class="muted" style="margin:0;font-size:.875rem">Patients join with the invite code from their physical therapist.</p>
    </div>
    <div class="l-mock" aria-hidden="true" data-reveal="right" style="--d:.15s">
      <div class="l-cam">${skeleton}<div class="l-cue"><span class="dot" style="width:12px;height:12px;background:var(--primary)"></span>Good height — lower slowly</div></div>
      <div class="l-rep">${ring({ size: 110, value: 0.6, stroke: 12, label: '<span style="font-size:2.25rem">6</span>', sub: "of 10" })}<span>Reps this set</span></div>
      <div class="l-note"><span class="avatar sm blue">ML</span><div><b>From your PT</b><br>“Nice steady squats — I’ve added 2 reps.”</div></div>
    </div>
  </section>
  <section id="how" class="l-band-white"><div class="l-section">
    <div class="l-center" data-reveal><span class="l-kicker">How it works</span><h2 class="l-h2">One plan that learns from every session</h2></div>
    <div class="l-steps">${STEPS.map(([t, d, bg, fg], i) => `<div class="l-step-wrap" data-reveal style="--d:${0.12 * (i + 1)}s"><div class="l-step"><span class="num-badge" style="background:${bg};color:${fg}">${i + 1}</span><h3>${t}</h3><p>${d}</p></div>${i < 2 ? `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#a3ada7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>` : ""}</div>`).join("")}</div>
  </div></section>
  <section id="patients" class="l-section l-split">
    <div class="stack" style="gap:20px" data-reveal="left"><span class="eyebrow" style="color:var(--primary)">For patients</span><h2 class="l-h2">Practise with confidence, not guesswork</h2>${checks(PATIENT_PTS)}</div>
    <div class="card" aria-hidden="true" data-reveal="right" style="--d:.15s;border-radius:32px;padding:28px;display:flex;flex-direction:column;gap:18px">
      <div class="greet"><span class="sun-badge" style="width:50px;height:50px">${ICON.sun}</span><b style="font-size:1.5rem;letter-spacing:-.02em">Good morning, Sam</b></div>
      <div class="warm-block"><span><b style="display:inline;font-size:1rem">Warm-up</b> · 9 gentle moves · 5 min</span></div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;text-align:center">
        ${[[0.98, "84", "Reps done", "var(--primary)"], [0.9, "9/10", "Good form", "var(--accent)"], [0.6, "3/5", "This week", "var(--warn)"]].map(([v, l, t, c]) =>
          `<div style="display:flex;flex-direction:column;align-items:center;gap:6px">${ring({ size: 96, value: v, color: c, label: l })}<span class="lbl">${t}</span></div>`).join("")}
      </div>
    </div>
  </section>
  <section id="providers" class="l-band-mint"><div class="l-section l-split" style="flex-wrap:wrap-reverse">
    <div class="stack l-samples" aria-hidden="true" style="gap:12px" data-reveal="left">
      ${SAMPLE.map(([n, p, r, c]) => `<div class="card sm" style="display:flex;align-items:center;gap:14px;padding:16px 18px"><span class="avatar">${n.split(" ").map((w) => w[0]).join("")}</span><div style="flex:1;min-width:0"><b>${n}</b><div class="muted" style="font-size:.875rem">${p}</div></div><span class="tag ${c}">${r}</span></div>`).join("")}
      <div class="card sm" style="display:flex;align-items:center;gap:12px;padding:16px 18px"><span style="color:var(--primary-strong);width:22px;height:22px">${ICON.sparkle}</span><span style="flex:1"><b>AI plan draft ready</b> · Shoulder extension 3 × 10 → 2 × 8, slow</span><span class="btn btn-primary sm">Review</span></div>
    </div>
    <div class="stack" style="gap:20px;--d:.15s" data-reveal="right"><span class="eyebrow">For providers</span><h2 class="l-h2">See what happens between visits</h2>${checks(PROVIDER_PTS)}</div>
  </div></section>
  <section id="privacy" class="l-section stack" style="gap:32px">
    <div data-reveal style="display:flex;flex-wrap:wrap;align-items:center;gap:20px"><span class="sun-badge" style="width:64px;height:64px;background:var(--accent-soft);color:var(--accent-strong)">${ICON.shield}</span>
      <div style="flex:1 1 400px"><h2 class="l-h2" style="font-size:clamp(1.75rem,3.2vw,2.375rem)">Private by design</h2><p class="muted" style="margin:6px 0 0;font-size:1.0625rem">Pose tracking runs right in your browser. Your camera video never leaves your device.</p></div></div>
    <div class="l-privacy-cards">${PRIVACY.map(([t, d], i) => `<div class="card" data-reveal style="--d:${0.12 * (i + 1)}s"><h3>${t}</h3><p>${d}</p></div>`).join("")}</div>
  </section>
  <section class="l-section" style="padding-top:0">
    <div class="l-cta-band" data-reveal><div style="flex:1 1 420px"><h2>Ready for practice that keeps up with you?</h2><p>Ask your physical therapist for an invite code, or bring Kinetix to your clinic.</p></div>
      <div style="display:flex;flex-wrap:wrap;gap:10px"><a class="btn btn-white md" href="#/signin?role=patient">I have an invite code</a><a class="btn btn-outline-white md" href="#/signin?role=provider">For clinics</a></div></div>
  </section>
  </main>
  <footer class="l-footer"><div class="l-footer-in"><span class="brand" style="font-size:.9375rem">${logo(30)}Kinetix</span>
    <nav aria-label="Footer"><a href="#privacy" data-anchor>Privacy</a><a href="#" data-soon="Terms">Terms</a><a href="#" data-soon="Contact">Contact</a></nav></div></footer>
</div>`;
}

let revealer = null;
/** Fade + slide each [data-reveal] block in the first time it scrolls into view (CSS: .reveal-on). */
function revealOnScroll(page) {
  revealer?.disconnect();
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  page.classList.add("reveal-on");
  revealer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); revealer.unobserve(e.target); }
  }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
  page.querySelectorAll("[data-reveal]").forEach((el) => revealer.observe(el));
}

let landingShown = false;
function showLanding() {
  showScreen("app");
  const root = document.getElementById("appRoot");
  if (!landingShown || !root.querySelector(".landing")) {
    root.innerHTML = landingHTML();
    root.querySelectorAll("[data-anchor]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault(); document.getElementById(a.getAttribute("href").slice(1))?.scrollIntoView({ behavior: "smooth" });
    }));
    root.querySelectorAll("[data-soon]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); comingSoon(a.dataset.soon); }));
    revealOnScroll(root.querySelector(".landing"));
    landingShown = true;
  }
  document.title = "Kinetix · Physical therapy, between visits";
  return root;
}

export function landingRoute() {
  landingShown = false;
  showLanding(); window.scrollTo(0, 0);
}

// ---------- sign in ----------
const roleCard = (role, on) => `<button type="button" class="role-card" role="radio" aria-checked="${on}" data-role="${role}">
  ${role === "patient" ? ICON.person : ICON.clipboard}<b>${role === "patient" ? "Patient" : "Provider"}</b><span>${role === "patient" ? "Practise my plan" : "Physical therapist"}</span></button>`;

export function signinRoute({ query }) {
  const root = showLanding();
  root.querySelector(".landing")?.setAttribute("aria-hidden", "true");
  let role = query.role === "provider" || query.role === "pt" ? "pt" : "patient";
  let mode = query.mode === "register" ? "register" : "signin";
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  root.appendChild(wrap);
  const close = () => go("#/");
  let downOnBackdrop = false;   // close only on a full click on the backdrop (not a drag that ends there)
  wrap.addEventListener("mousedown", (e) => { downOnBackdrop = e.target === wrap; });
  wrap.addEventListener("click", (e) => { if (downOnBackdrop && e.target === wrap) close(); });
  document.body.style.overflow = "hidden";

  function render() {
    const reg = mode === "register";
    wrap.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="signinTitle" novalidate>
      <button type="button" class="modal-close" aria-label="Close" data-close>${ICON.close}</button>
      <div><h2 id="signinTitle">${reg ? "Create your account" : "Welcome back"}</h2><p class="muted" style="margin:4px 0 0">How do you use Kinetix?</p></div>
      <div class="role-cards" role="radiogroup" aria-label="Account type">${roleCard("patient", role === "patient")}${roleCard("pt", role === "pt")}</div>
      ${reg ? `<label class="field">Your name<input name="name" autocomplete="name" required placeholder="First and last name"></label>` : ""}
      <label class="field">Email<input type="email" name="email" autocomplete="username" required placeholder="you@example.com"></label>
      <label class="field">Password<input type="password" name="password" autocomplete="${reg ? "new-password" : "current-password"}" required minlength="${reg ? 8 : 1}" placeholder="••••••••"></label>
      ${role === "patient"
        ? `<label class="field">Invite code from your PT <span class="hint">First time only</span><input name="invite" placeholder="e.g. 4F7-K2Q" autocomplete="off"></label>`
        : `<label class="field">Clinic<input name="clinic" placeholder="Clinic name" autocomplete="organization"></label>`}
      <p class="form-error" data-error hidden></p>
      <button type="submit" class="btn btn-primary md block" data-submit>${reg ? "Create account" : "Sign in"}</button>
      <button type="button" class="btn btn-secondary block" data-demo>Continue with demo ${role === "pt" ? "provider" : "patient"} account</button>
      <div class="row-between" style="font-size:.875rem;font-weight:700">
        ${reg ? '<button type="button" class="link-btn" data-mode="signin">I already have an account</button>' : '<button type="button" class="link-btn" data-forgot>Forgot password?</button><button type="button" class="link-btn" data-mode="register">Create account</button>'}
      </div>
      <div class="note blue">${ICON.lock}<span>Your camera video stays on your device. Only rep results are shared with your care team.</span></div>
    </form>`;
    const form = wrap.querySelector("form");
    form.querySelectorAll("[data-role]").forEach((b) => b.addEventListener("click", () => { role = b.dataset.role; keep(); }));
    form.querySelector("[data-close]").onclick = close;
    form.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; keep(); }));
    form.querySelector("[data-forgot]")?.addEventListener("click", () => comingSoon("Password reset"));
    form.querySelector("[data-demo]").onclick = () => finish(signInDemo(role, users()), { demo: true });
    form.addEventListener("submit", submit);
    release?.(); release = openModal(form, { onClose: close });
  }
  function keep() {   // re-render but keep typed values
    const vals = Object.fromEntries(new FormData(wrap.querySelector("form")));
    render();
    for (const [k, v] of Object.entries(vals)) { const el = wrap.querySelector(`[name="${k}"]`); if (el) el.value = v; }
  }
  let release = null;
  const err = (msg, warn = false) => { const e = wrap.querySelector("[data-error]"); e.textContent = msg; e.hidden = !msg; e.className = warn ? "form-warn" : "form-error"; };

  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget, fd = new FormData(form);
    const email = String(fd.get("email") || "").trim(), password = String(fd.get("password") || "");
    if (!email || !password || (mode === "register" && !String(fd.get("name") || "").trim())) { err("Please fill in every field."); return; }
    const btn = form.querySelector("[data-submit]"); btn.disabled = true; err("");
    try {
      if (!(await atpReachable())) {
        if (mode === "register") { err("Creating an account needs the Kinetix account service, which isn’t running here. Use the demo account instead."); btn.disabled = false; return; }
        toast("Account service is offline — signed in to the demo account.");
        finish(signInDemo(role, users()), { demo: true });
        return;
      }
      const user = mode === "register"
        ? await registerAtp({ email, password, displayName: String(fd.get("name")).trim(), role: role === "pt" ? "pt" : "patient" })
        : await signInAtp(email, password);
      if (user.role !== role) toast(`This is a ${user.role === "pt" ? "provider" : "patient"} account — opening the ${user.role === "pt" ? "provider" : "patient"} view.`, 4000);
      finish(user);
    } catch (ex) {
      err(ex.message || "Sign in failed"); btn.disabled = false;
    }
  }
  function finish(user) {
    resetMode();
    const next = query.next && ((user.role === "pt") === query.next.startsWith("#/provider")) ? query.next : homeFor(user);
    go(next);
  }

  const already = currentUser();
  render();
  if (already && !query.next) err(`You’re signed in as ${already.name}. Sign in again to switch accounts.`, true);
  onLeave(() => { release?.(); wrap.remove(); document.body.style.overflow = ""; root.querySelector(".landing")?.removeAttribute("aria-hidden"); });
}
