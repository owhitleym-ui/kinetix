// P3 · Recording choice: shown over the (blurred) live form check before the camera turns on.
// Only the choice is stored. Video frames never leave the device either way.
import { ICON, esc, openModal } from "../ui.js";

export const VIDEO_OPTIONS = (ptName) => [
  ["share", `Record and share with ${ptName}`, "Your PT can watch short clips of your reps to check your form before your next visit. Only your care team can see them."],
  ["local", "Don’t save video", "You still get live feedback. Video stays on this device and is never stored."],
];

export function openRecordChoice({ ptName = "your PT", choice = "share", onCamera, onNotNow }) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.style.background = "rgba(28,28,26,.3)";
  wrap.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="recTitle">
    <div style="display:flex;align-items:center;gap:14px">
      <span style="width:52px;height:52px;border-radius:16px;background:var(--primary-soft);color:var(--primary-ink);display:grid;place-items:center;flex:none"><span style="width:26px;height:26px;display:block">${ICON.camera}</span></span>
      <div><h2 id="recTitle" style="font-size:1.5rem">Before your camera turns on</h2><p class="muted" style="margin:2px 0 0">Choose what happens to your video today.</p></div>
    </div>
    <div role="radiogroup" aria-label="Video choice" style="display:flex;flex-direction:column;gap:12px">
      ${VIDEO_OPTIONS(esc(ptName)).map(([v, t, d]) => `<button type="button" class="radio-card" role="radio" aria-checked="${v === choice}" data-v="${v}"><span class="radio-dot"></span><span><b>${t}</b><span class="desc">${d}</span></span></button>`).join("")}
    </div>
    <p style="margin:0;font-size:.875rem;line-height:1.45;color:#4a524d">Either way, your rep counts, form scores and check-ins are shared with ${esc(ptName)}.</p>
    <div class="note mint" style="color:#244232">${ICON.shield}<span><b>Your video never leaves this device.</b>
      <button type="button" class="link-btn" style="min-height:0" data-details aria-expanded="false">Privacy details</button>
      <span data-more hidden><br>Pose tracking runs in your browser. Kinetix only sends your rep results (counts, form checks, cues) and check-ins to your care team. Never camera frames.</span></span></div>
    <label class="check-row"><input type="checkbox" data-remember> Remember my choice (change any time in Settings)</label>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button type="button" class="btn btn-primary md" style="flex:1 1 200px" data-camera>Turn on camera</button>
      <button type="button" class="btn btn-secondary md" data-notnow>Not now</button>
    </div></div>`;
  document.body.appendChild(wrap);
  const dlg = wrap.firstElementChild;
  let pick = choice;
  wrap.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => {
    pick = b.dataset.v;
    wrap.querySelectorAll("[data-v]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  }));
  wrap.querySelector("[data-details]").onclick = (e) => {
    const more = wrap.querySelector("[data-more]"); more.hidden = !more.hidden; e.currentTarget.setAttribute("aria-expanded", String(!more.hidden));
  };
  const done = () => { release(); wrap.remove(); };
  const release = openModal(dlg, { onClose: () => { done(); onNotNow?.(); } });
  wrap.querySelector("[data-camera]").onclick = () => { done(); onCamera?.(pick, wrap.querySelector("[data-remember]").checked); };
  wrap.querySelector("[data-notnow]").onclick = () => { done(); onNotNow?.(); };
  dlg.querySelector("[data-camera]").setAttribute("data-autofocus", "");
  return done;
}
