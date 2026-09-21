/**
 * The agent's cursor: a second pointer, drawn over the page, that moves to whatever the
 * agent is about to touch and says what it is doing.
 *
 * It is the trust surface. People forgive an agent that is slow in front of them; they
 * do not forgive one that clicks things they did not see. So every click and every
 * keystroke is preceded by the cursor gliding to the target with a plain-language label
 * — and in "show me" mode the cursor IS the answer: it points, and the person clicks.
 *
 * Lives in `sense`, the browser-side code both executors share, so the CLI's CDP driver
 * and the extension draw the same cursor through the same code.
 *
 * Invariants, each load-bearing:
 * - `pointer-events: none` everywhere: the overlay can never intercept a real click.
 * - a CLOSED shadow root: page CSS cannot restyle it, page scripts cannot reach into
 *   it, and our own collector (which walks only open roots) never offers it as a target.
 * - every wait has a timer fallback: requestAnimationFrame stops in a background tab,
 *   and a cursor animation must never be what hangs a run.
 * - `prefers-reduced-motion` jumps instead of gliding.
 */

type Kind = "move" | "click" | "type" | "point";

interface Overlay {
  host: HTMLElement;
  cursor: HTMLElement;
  label: HTMLElement;
  ring: HTMLElement;
  highlight: HTMLElement;
  listening: HTMLElement;
  x: number;
  y: number;
}

const HOST = "jev-agent-overlay";
let overlay: Overlay | null = null;

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font: 500 13px/1.25 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif; }
.cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px; will-change: transform;
  filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / 35%)) drop-shadow(0 4px 10px rgb(0 0 0 / 18%));
  transition: opacity 180ms ease; }
.cursor svg { display: block; }
.label { position: absolute; left: 0; top: 0; max-width: 280px; padding: 6px 11px 6px 9px;
  border-radius: 999px; background: rgb(28 28 30 / 92%); color: #fff; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.01em; will-change: transform;
  box-shadow: 0 6px 20px rgb(0 0 0 / 22%), inset 0 0 0 0.5px rgb(255 255 255 / 14%);
  -webkit-backdrop-filter: saturate(160%) blur(12px); backdrop-filter: saturate(160%) blur(12px);
  transition: opacity 180ms ease; }
.label b { font-weight: 650; margin-right: 6px; color: rgb(255 255 255 / 62%); }
.ring { position: absolute; left: 0; top: 0; width: 34px; height: 34px; margin: -17px 0 0 -17px;
  border-radius: 50%; border: 2px solid rgb(28 28 30 / 55%); opacity: 0; }
.ring.go { animation: ripple 460ms cubic-bezier(.2,.7,.3,1) forwards; }
@keyframes ripple { from { transform: scale(.35); opacity: .7 } to { transform: scale(1.7); opacity: 0 } }
.highlight { position: absolute; border-radius: 10px; opacity: 0;
  box-shadow: 0 0 0 2.5px #ff9f0a, 0 0 0 7px rgb(255 159 10 / 22%); transition: opacity 200ms ease; }
.highlight.on { opacity: 1; animation: breathe 1.6s ease-in-out infinite; }
@keyframes breathe { 50% { box-shadow: 0 0 0 2.5px #ff9f0a, 0 0 0 12px rgb(255 159 10 / 10%); } }
.listening { position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 9px; padding: 9px 16px 9px 12px; border-radius: 999px;
  background: rgb(28 28 30 / 92%); color: #fff; opacity: 0; transition: opacity 180ms ease;
  box-shadow: 0 8px 28px rgb(0 0 0 / 25%); }
.listening.on { opacity: 1; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #ff453a; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .35; transform: scale(.8) } }
.hidden { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .ring.go, .highlight.on, .dot { animation: none; }
}
`;

// A pointer that is recognisably not the user's own: dark, with a white edge and a
// small spark at the heel so it reads as "the agent" at a glance.
const ARROW = `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
  <path d="M4 2.5 L4 21 L9.2 16.4 L12.6 23.6 L15.9 22.1 L12.6 15 L19.6 15 Z"
    fill="#1c1c1e" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>
  <circle cx="20.5" cy="5.5" r="2.6" fill="#ff9f0a" stroke="#fff" stroke-width="1.2"/>
</svg>`;

function ensure(): Overlay {
  if (overlay?.host.isConnected) return overlay;
  document.querySelectorAll(HOST).forEach((n) => n.remove());
  const host = document.createElement(HOST);
  // A zero-size host that nothing can make hittable: `!important` beats any page rule
  // like `* { pointer-events: auto }`.
  for (const [k, v] of Object.entries({
    position: "fixed",
    left: "0",
    top: "0",
    width: "0",
    height: "0",
    "pointer-events": "none",
    "z-index": "2147483647",
  })) {
    host.style.setProperty(k, v, "important");
  }
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>${STYLE}</style>
    <div class="layer">
      <div class="highlight"></div>
      <div class="ring"></div>
      <div class="cursor hidden">${ARROW}</div>
      <div class="label hidden"></div>
      <div class="listening"><span class="dot"></span><span>Listening…</span></div>
    </div>`;
  document.documentElement.append(host);
  const q = (s: string) => root.querySelector(s) as HTMLElement;
  // Enter from the bottom-right, where a person's eye does not expect a pointer to be.
  overlay = {
    host,
    cursor: q(".cursor"),
    label: q(".label"),
    ring: q(".ring"),
    highlight: q(".highlight"),
    listening: q(".listening"),
    x: innerWidth - 60,
    y: innerHeight - 60,
  };
  place(overlay, overlay.x, overlay.y);
  return overlay;
}

function place(o: Overlay, x: number, y: number): void {
  o.x = x;
  o.y = y;
  // The arrow's tip is at (4, 2.5) in its own box; put the tip exactly on the point.
  o.cursor.style.transform = `translate(${x - 4}px, ${y - 2.5}px)`;
  // The label sits below-right, flipped when that would leave the viewport.
  const w = o.label.offsetWidth || 160;
  const lx = x + 18 + w > innerWidth - 8 ? x - w - 12 : x + 18;
  const ly = y + 22 + 34 > innerHeight - 8 ? y - 40 : y + 22;
  o.label.style.transform = `translate(${Math.max(8, lx)}px, ${Math.max(8, ly)}px)`;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Glide to a top-viewport point, saying what is about to happen. Resolves on arrival. */
export function cursorTo(x: number, y: number, label: string, kind: Kind = "move"): Promise<void> {
  const o = ensure();
  o.cursor.classList.remove("hidden");
  o.label.classList.remove("hidden");
  o.label.innerHTML = "";
  const who = document.createElement("b");
  who.textContent = "Jev";
  o.label.append(who, document.createTextNode(label));
  if (kind !== "point") o.highlight.classList.remove("on");

  const fromX = o.x;
  const fromY = o.y;
  const distance = Math.hypot(x - fromX, y - fromY);
  if (reducedMotion() || distance < 2 || document.hidden) {
    place(o, x, y);
    return Promise.resolve();
  }
  const duration = Math.min(520, Math.max(200, 180 + distance * 0.35));
  return new Promise((resolve) => {
    const start = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      place(o, x, y);
      resolve();
    };
    const frame = (now: number) => {
      if (done) return;
      const t = Math.min(1, (now - start) / duration);
      const e = easeOut(t);
      place(o, fromX + (x - fromX) * e, fromY + (y - fromY) * e);
      if (t < 1) requestAnimationFrame(frame);
      else finish();
    };
    requestAnimationFrame(frame);
    // rAF does not run in a background tab; the cursor must never hang a run.
    setTimeout(finish, duration + 120);
  });
}

/** A click ripple at the cursor tip. */
export function cursorClick(): void {
  const o = ensure();
  o.ring.style.left = `${o.x}px`;
  o.ring.style.top = `${o.y}px`;
  o.ring.classList.remove("go");
  void o.ring.offsetWidth; // restart the animation
  o.ring.classList.add("go");
}

/** Outline an element's rect (top-viewport coordinates) — "this one". */
export function cursorHighlight(rect: { x: number; y: number; width: number; height: number } | null): void {
  const o = ensure();
  if (!rect) {
    o.highlight.classList.remove("on");
    return;
  }
  const pad = 4;
  Object.assign(o.highlight.style, {
    left: `${rect.x - pad}px`,
    top: `${rect.y - pad}px`,
    width: `${rect.width + pad * 2}px`,
    height: `${rect.height + pad * 2}px`,
  });
  o.highlight.classList.add("on");
}

/** The "Listening…" pill, for voice input started from the panel. */
export function cursorListening(on: boolean, text = "Listening…"): void {
  const o = ensure();
  const span = o.listening.querySelector("span:last-child");
  if (span) span.textContent = text;
  o.listening.classList.toggle("on", on);
}

/** Put the cursor away — the run is over. */
export function cursorHide(): void {
  if (!overlay?.host.isConnected) return;
  overlay.cursor.classList.add("hidden");
  overlay.label.classList.add("hidden");
  overlay.highlight.classList.remove("on");
  overlay.listening.classList.remove("on");
}
