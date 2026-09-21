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

import { loopBox, loopPath } from "./ink.js";

type Kind = "move" | "click" | "type" | "point";

interface Overlay {
  host: HTMLElement;
  ink: SVGSVGElement;
  notes: HTMLElement;
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
.ink { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.ink path { fill: none; stroke: #ff8a00; stroke-linecap: round; stroke-linejoin: round; }
.ink .loop { stroke-width: 3.2; filter: drop-shadow(0 1px 0 rgb(255 255 255 / 70%)); }
.ink .arrow { stroke-width: 2.2; }
.ink .draw { stroke-dasharray: var(--len); stroke-dashoffset: var(--len);
  animation: draw var(--dur, 520ms) cubic-bezier(.55,.1,.3,1) var(--delay, 0ms) forwards; }
@keyframes draw { to { stroke-dashoffset: 0; } }
.note { position: absolute; left: 0; top: 0; display: flex; gap: 8px; align-items: flex-start;
  max-width: 240px; padding: 8px 12px 9px 8px; border-radius: 12px; background: rgb(28 28 30 / 94%);
  color: #fff; line-height: 1.32; letter-spacing: -0.005em; opacity: 0; transform-origin: 0 0;
  box-shadow: 0 10px 28px rgb(0 0 0 / 24%), inset 0 0 0 0.5px rgb(255 255 255 / 14%);
  animation: pop 260ms cubic-bezier(.2,.9,.3,1.25) var(--delay, 0ms) forwards; }
.note.off, .badge.off { visibility: hidden; }
@keyframes pop { from { opacity: 0; scale: .85; } to { opacity: 1; scale: 1; } }
.num, .badge { flex: none; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%;
  background: #ff8a00; color: #1c1c1e; font-weight: 750; font-size: 12px; }
.badge { position: absolute; left: 0; top: 0; box-shadow: 0 0 0 2px #fff, 0 3px 8px rgb(0 0 0 / 25%);
  opacity: 0; animation: pop 220ms ease var(--delay, 0ms) forwards; }
.esc { position: absolute; right: 16px; bottom: 16px; padding: 6px 11px; border-radius: 999px;
  background: rgb(28 28 30 / 88%); color: rgb(255 255 255 / 78%); font-size: 12px; opacity: 0;
  transition: opacity 200ms ease; }
.esc.on { opacity: 1; }
.esc b { color: #fff; font-weight: 650; }
@media (prefers-reduced-motion: reduce) {
  .ring.go, .highlight.on, .dot { animation: none; }
  .ink .draw { animation: none; stroke-dashoffset: 0; }
  .note, .badge { animation: none; opacity: 1; }
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
      <svg class="ink" xmlns="http://www.w3.org/2000/svg"></svg>
      <div class="notes"></div>
      <div class="esc">Jev's notes · <b>Esc</b> to clear</div>
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
    ink: root.querySelector(".ink") as SVGSVGElement,
    notes: q(".notes"),
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

// --- ink: drawing on the page ---------------------------------------------------

/**
 * Something to mark. `rect` is a function, not a value: the marks follow their
 * elements as the page scrolls and reflows, so the circle stays around the thing it
 * is about instead of floating where that thing used to be.
 */
export interface InkMark {
  rect: () => { x: number; y: number; width: number; height: number } | null;
  /** Number shown on the circle and its note; null for a bare circle (show mode). */
  n: number | null;
  note: string;
}

interface Placed {
  mark: InkMark;
  seed: number;
  loop: SVGPathElement;
  arrow: SVGPathElement | null;
  badge: HTMLElement | null;
  card: HTMLElement | null;
}

let inked: { placed: Placed[]; frame: number; detach: () => void } | null = null;

const overlaps = (a: DOMRectLike, b: DOMRectLike, pad = 6) =>
  a.x < b.x + b.width + pad && b.x < a.x + a.width + pad && a.y < b.y + b.height + pad && b.y < a.y + a.height + pad;

type DOMRectLike = { x: number; y: number; width: number; height: number };

const CONTROL = "a[href],button,input,select,textarea,[role=button],[role=link],[role=tab],[contenteditable=true]";

/**
 * How many distinct controls a note would sit on. A note covering the button next to
 * the one it explains hides the very thing the person may want instead. Sampled at a
 * grid of points: the overlay is `pointer-events: none`, so hit-testing sees the page.
 */
function controlsUnder(s: DOMRectLike): number {
  const hit = new Set<Element>();
  for (const fx of [0.08, 0.5, 0.92]) {
    for (const fy of [0.2, 0.8]) {
      const el = document.elementFromPoint(s.x + s.width * fx, s.y + s.height * fy)?.closest(CONTROL);
      if (el) hit.add(el);
    }
  }
  return hit.size;
}

function layout(): void {
  const o = overlay;
  if (!o || !inked) return;
  const vw = innerWidth;
  const vh = innerHeight;
  const cards: DOMRectLike[] = [];
  const rects = inked.placed.map((p) => p.mark.rect());
  for (const [i, p] of inked.placed.entries()) {
    const r = rects[i];
    const onScreen = r && r.width > 0 && r.y + r.height > 0 && r.y < vh && r.x + r.width > 0 && r.x < vw;
    p.loop.style.display = onScreen ? "" : "none";
    if (p.arrow) p.arrow.style.display = onScreen ? "" : "none";
    p.badge?.classList.toggle("off", !onScreen);
    p.card?.classList.toggle("off", !onScreen);
    if (!r || !onScreen) continue;

    p.loop.setAttribute("d", loopPath(r, p.seed));
    const box = loopBox(r);
    if (p.badge) {
      const a = -Math.PI * 0.75;
      p.badge.style.transform = `translate(${box.cx + Math.cos(a) * box.rx - 10}px, ${box.cy + Math.sin(a) * box.ry - 10}px)`;
    }
    if (!p.card || !p.arrow) continue;

    // Try beside, then below/above; take the first spot on screen that covers neither
    // another note nor another marked element.
    const w = p.card.offsetWidth || 200;
    const h = p.card.offsetHeight || 40;
    const gap = 34;
    const spots = [
      { x: box.cx + box.rx + gap, y: box.cy - h / 2 },
      { x: box.cx - box.rx - gap - w, y: box.cy - h / 2 },
      { x: box.cx - w / 2, y: box.cy + box.ry + gap },
      { x: box.cx - w / 2, y: box.cy - box.ry - gap - h },
      { x: box.cx + box.rx + gap * 0.6, y: box.cy + box.ry * 0.6 },
      { x: box.cx + box.rx * 0.2, y: box.cy + box.ry + gap },
      { x: box.cx - w - box.rx * 0.2, y: box.cy + box.ry + gap },
      { x: box.cx + box.rx * 0.2, y: box.cy - box.ry - gap - h },
    ].map((s) => ({ x: Math.min(Math.max(8, s.x), vw - w - 8), y: Math.min(Math.max(8, s.y), vh - h - 8), width: w, height: h }));
    const cost = (s: DOMRectLike) =>
      cards.filter((c) => overlaps(s, c)).length * 10 +
      rects.filter((q) => q && overlaps(s, q)).length * 3 +
      controlsUnder(s) * 2 +
      (overlaps(s, { x: box.cx - box.rx, y: box.cy - box.ry, width: box.rx * 2, height: box.ry * 2 }, 0) ? 5 : 0);
    const spot = spots.reduce((best, s) => (cost(s) < cost(best) ? s : best), spots[0] as DOMRectLike);
    cards.push(spot);
    p.card.style.transform = `translate(${spot.x}px, ${spot.y}px)`;

    // Arrow: from where the line between the two centres leaves the card, to the
    // loop's edge, bowed like a flick of the wrist.
    const ccx = spot.x + w / 2;
    const ccy = spot.y + h / 2;
    const dx = box.cx - ccx;
    const dy = box.cy - ccy;
    const k = Math.min(Math.abs(w / 2 / (dx || 1e-6)), Math.abs(h / 2 / (dy || 1e-6)));
    const from = { x: ccx + dx * k, y: ccy + dy * k };
    const ang = Math.atan2(from.y - box.cy, from.x - box.cx);
    const to = { x: box.cx + Math.cos(ang) * (box.rx + 5), y: box.cy + Math.sin(ang) * (box.ry + 5) };
    const mx = (from.x + to.x) / 2 - (to.y - from.y) * 0.22;
    const my = (from.y + to.y) / 2 + (to.x - from.x) * 0.22;
    const head = Math.atan2(to.y - my, to.x - mx);
    const hx = (d: number) => (to.x - Math.cos(head + d) * 11).toFixed(1);
    const hy = (d: number) => (to.y - Math.sin(head + d) * 11).toFixed(1);
    p.arrow.setAttribute(
      "d",
      `M${from.x.toFixed(1)},${from.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${to.x.toFixed(1)},${to.y.toFixed(1)} M${hx(0.45)},${hy(0.45)} L${to.x.toFixed(1)},${to.y.toFixed(1)} L${hx(-0.45)},${hy(-0.45)}`,
    );
  }
}

function svg(tag: string, cls: string): SVGPathElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag) as SVGPathElement;
  el.setAttribute("class", cls);
  return el;
}

/**
 * Draw marks on the page, replacing any already drawn. Each gets a hand-drawn loop,
 * and — when numbered — a badge on the loop and a note joined to it by an arrow,
 * drawn one after another in reading order so the eye is led through them.
 */
export function inkDraw(marks: InkMark[]): void {
  inkClear();
  if (!marks.length) return;
  const o = ensure();
  const quick = reducedMotion() || document.hidden;
  const placed: Placed[] = marks.map((mark, i) => {
    const delay = quick ? 0 : i * 520;
    const loop = svg("path", "loop draw");
    const arrow = mark.n !== null && mark.note ? svg("path", "arrow draw") : null;
    o.ink.append(loop);
    if (arrow) o.ink.append(arrow);
    let badge: HTMLElement | null = null;
    let card: HTMLElement | null = null;
    if (mark.n !== null) {
      badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = String(mark.n);
      badge.style.setProperty("--delay", `${delay + 380}ms`);
      o.notes.append(badge);
      if (mark.note) {
        card = document.createElement("div");
        card.className = "note";
        const num = document.createElement("span");
        num.className = "num";
        num.textContent = String(mark.n);
        const text = document.createElement("span");
        text.textContent = mark.note;
        card.append(num, text);
        card.style.setProperty("--delay", `${delay + 420}ms`);
        o.notes.append(card);
      }
    }
    return { mark, seed: (i + 1) * 7919 + mark.note.length, loop, arrow, badge, card };
  });

  let frame = 0;
  const relayout = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      layout();
    });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") inkClear();
  };
  addEventListener("scroll", relayout, { capture: true, passive: true });
  addEventListener("resize", relayout, { passive: true });
  addEventListener("keydown", onKey, { capture: true });
  inked = {
    placed,
    frame: 0,
    detach: () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", relayout, { capture: true });
      removeEventListener("resize", relayout);
      removeEventListener("keydown", onKey, { capture: true });
    },
  };

  // Observable from outside the closed root — by tests, and by either world of an
  // extension — without exposing the root itself.
  o.host.setAttribute("data-ink", String(placed.length));
  layout();
  // Lengths are known only once paths exist; the draw-on animation needs them.
  for (const [i, p] of placed.entries()) {
    const delay = quick ? 0 : i * 520;
    for (const [path, d, dur] of [
      [p.loop, delay, 560],
      [p.arrow, delay + 420, 320],
    ] as const) {
      if (!path) continue;
      const len = Math.ceil(path.getTotalLength?.() || 800) + 2;
      path.style.setProperty("--len", String(len));
      path.style.setProperty("--delay", `${d}ms`);
      path.style.setProperty("--dur", `${dur}ms`);
    }
  }
  const esc = o.notes.parentElement?.querySelector(".esc");
  if (esc && marks.some((m) => m.n !== null)) esc.classList.add("on");
}

/** Wipe the ink. The page is exactly as it was. */
export function inkClear(): void {
  if (!inked) return;
  inked.detach();
  for (const p of inked.placed) {
    p.loop.remove();
    p.arrow?.remove();
    p.badge?.remove();
    p.card?.remove();
  }
  inked = null;
  overlay?.host.setAttribute("data-ink", "0");
  overlay?.notes.parentElement?.querySelector(".esc")?.classList.remove("on");
}

/** How many marks are on the page now — for tests and the conformance gauntlet. */
export function inkCount(): number {
  return inked?.placed.length ?? 0;
}
