/**
 * The geometry of Jev's ink: a loop drawn around a box the way a hand draws one.
 * Pure — no DOM — so the on-page overlay and the website draw the very same stroke.
 */

/** Deterministic noise per mark, so re-laying out on scroll does not re-scribble it. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Catmull-Rom through the points, as cubic Béziers: a pen stroke, not a polygon. */
export function smooth(points: { x: number; y: number }[]): string {
  const p = points;
  if (p.length < 2) return "";
  let d = `M${p[0]?.x.toFixed(1)},${p[0]?.y.toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[Math.max(0, i - 1)] as { x: number; y: number };
    const b = p[i] as { x: number; y: number };
    const c = p[i + 1] as { x: number; y: number };
    const e = p[Math.min(p.length - 1, i + 2)] as { x: number; y: number };
    d += ` C${(b.x + (c.x - a.x) / 6).toFixed(1)},${(b.y + (c.y - a.y) / 6).toFixed(1)} ${(c.x - (e.x - b.x) / 6).toFixed(1)},${(c.y - (e.y - b.y) / 6).toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)}`;
  }
  return d;
}

/**
 * A loop drawn around a rect the way a hand draws one: slightly more than one turn,
 * the end overshooting the start, the radius wandering a little.
 */
export function loopPath(r: { x: number; y: number; width: number; height: number }, seed: number): string {
  const rand = rng(seed);
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  // An ellipse through the rect's corners would need rx = w/√2; a little less plus a
  // margin keeps wide buttons from getting a circle the size of the page.
  const rx = Math.max(22, r.width * 0.62 + 8);
  const ry = Math.max(16, r.height * 0.66 + 8);
  const start = -Math.PI * (0.7 + rand() * 0.2);
  const turn = Math.PI * 2 * (1.08 + rand() * 0.06);
  const steps = 28;
  const pts = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const a = start + turn * t;
    const wobble = 1 + (rand() - 0.5) * 0.05 + t * 0.07;
    return { x: cx + Math.cos(a) * rx * wobble, y: cy + Math.sin(a) * ry * wobble };
  });
  return smooth(pts);
}

/** Where the loop around `r` sits, as an ellipse — to aim arrows at its edge. */
export function loopBox(r: { x: number; y: number; width: number; height: number }) {
  return {
    cx: r.x + r.width / 2,
    cy: r.y + r.height / 2,
    rx: Math.max(22, r.width * 0.62 + 8),
    ry: Math.max(16, r.height * 0.66 + 8),
  };
}
