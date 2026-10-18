// Shared UI pieces for the Kinetix views: logo, icons, rings, faces, greeting, modal focus handling, toasts.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const logo = (size = 36) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.65 9.9L14.35 9.9L21.03 10.06L15.8 14.24L17.58 20.69L12 17L6.42 20.69L8.2 14.24L2.97 10.06Z" fill="#4ca154" stroke="#4ca154" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="5.4" r="2.8" fill="#306339"/></svg>`;

const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
export const ICON = {
  gear: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" ${S} stroke-width="2.2"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" ${S} stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
  down: `<svg viewBox="0 0 24 24" ${S} stroke-width="2.2"><path d="M12 5v14M6 13l6 6 6-6"/></svg>`,
  back: `<svg viewBox="0 0 24 24" ${S} stroke-width="2.2"><path d="M15 6l-6 6 6 6"/></svg>`,
  chev: `<svg class="chev" viewBox="0 0 24 24" ${S} stroke-width="2.2"><path d="M9 6l6 6-6 6"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" ${S} stroke-width="3"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" ${S}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" ${S}><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`,
  info: `<svg viewBox="0 0 24 24" ${S} stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" ${S} stroke-width="2.2"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z"/></svg>`,
  search: `<svg viewBox="0 0 24 24" ${S}><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>`,
  person: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>`,
  clipboard: `<svg viewBox="0 0 24 24" ${S}><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v3h6V3M9 12h6M9 16h4"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  sunCloud: `<svg viewBox="0 0 24 24" ${S}><path d="M12 2v2M4.9 4.9l1.4 1.4M2 11h2M19.1 4.9l-1.4 1.4"/><path d="M8.2 11.5a4 4 0 0 1 7.6-1.7"/><path d="M8 20h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.5A3 3 0 0 0 8 20z"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" ${S}><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>`,
  focus: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="4.5" r="2"/><path d="M12 7v9M8 21l4-5 4 5M7 10h10"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4"/></svg>`,
};

/** Progress ring. value 0..1. */
export function ring({ size = 104, value = 0, color = "var(--primary)", track = "var(--track)", stroke = 10, label = "", sub = "", aria = "" } = {}) {
  const r = 50 - stroke / 2 - 1, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value));
  const role = aria ? `role="img" aria-label="${esc(aria)}"` : 'aria-hidden="true"';
  return `<div class="ring" style="width:${size}px;height:${size}px" ${role}><svg viewBox="0 0 100 100" width="${size}" height="${size}"><circle cx="50" cy="50" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>` +
    `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(c * v).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 50 50)"/></svg>` +
    (label || sub ? `<div class="ring-label">${label ? `<b>${label}</b>` : ""}${sub ? `<small>${sub}</small>` : ""}</div>` : "") + "</div>";
}

// Six-step pain faces (0, 2, 4, 6, 8, 10), green -> red.
export const PAIN_FACES = [
  { v: 0, word: "No pain", mouth: "M11 23 Q20 33 29 23", fill: "#bfeccc" },
  { v: 2, word: "Hurts a little", mouth: "M12 24 Q20 30 28 24", fill: "#d7f0b8" },
  { v: 4, word: "Hurts a bit more", mouth: "M13 26 Q20 28 27 26", fill: "#fbe8a6" },
  { v: 6, word: "Hurts even more", mouth: "M13 27 H27", fill: "#fdd2a8" },
  { v: 8, word: "Hurts a lot", mouth: "M13 29 Q20 24 27 29", fill: "#fbb9a4" },
  { v: 10, word: "Worst pain", mouth: "M12 30 Q20 22 28 30", fill: "#f59e9e" },
];
export const EFFORT_FACES = [
  { v: "too_easy", word: "Too easy", mouth: "M12 24 Q20 30 28 24", fill: "#cfe8fb" },
  { v: "just_right", word: "Just right", mouth: "M11 23 Q20 33 29 23", fill: "#bfeccc" },
  { v: "too_hard", word: "Too hard", mouth: "M12 29 Q16 26 20 29 Q24 32 28 29", fill: "#fdd2a8" },
];
export const face = ({ mouth, fill }, size = 40, ink = "#14201a") =>
  `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">${fill ? `<circle cx="20" cy="20" r="18" fill="${fill}"/>` : ""}<circle cx="14" cy="16" r="2.2" fill="${ink}"/><circle cx="26" cy="16" r="2.2" fill="${ink}"/><path d="${mouth}" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/></svg>`;

/** Greeting by local time: sun / sun-behind-cloud / moon. */
export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return { word: "Good morning", icon: ICON.sun, cls: "" };
  if (h < 18) return { word: "Good afternoon", icon: ICON.sunCloud, cls: "" };
  return { word: "Good evening", icon: ICON.moon, cls: "evening" };
}
export const longDate = (d = new Date()) => d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
export const shortDay = (d) => new Date(d).toLocaleDateString(undefined, { weekday: "short" });
export const niceDate = (d) => new Date(d).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
export function relDay(iso) {
  const d = new Date(iso), now = new Date();
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export const initials = (name = "") => name.replace(/^Dr\.?\s+/i, "").split(/[\s,]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// ---------- modal: focus trap + Esc ----------
let lastFocus = null;
export function openModal(el, { onClose } = {}) {
  lastFocus = document.activeElement;
  const focusables = () => [...el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((n) => !n.disabled && n.offsetParent !== null);
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose?.(); return; }
    if (e.key !== "Tab") return;
    const f = focusables(); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  el.addEventListener("keydown", onKey);
  requestAnimationFrame(() => (el.querySelector("[data-autofocus]") || focusables()[0])?.focus());
  return () => { el.removeEventListener("keydown", onKey); lastFocus?.focus?.({ preventScroll: true }); };
}

let toastTimer;
export function toast(msg, ms = 2800) {
  let t = document.getElementById("kToast");
  if (!t) { t = document.createElement("div"); t.id = "kToast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
export const comingSoon = (what = "This") => toast(`${what} is coming soon in the demo.`);
