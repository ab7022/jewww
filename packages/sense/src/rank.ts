import type { RawElement, RawSnapshot, Snapshot, SnapshotElement } from "@jev-browser/shared";

/**
 * Ranking is a PURE function of (raw snapshot, intent) and runs in Node, not the
 * browser. That separation is what lets the benchmark measure recall at several caps
 * against saved fixtures — and it means a ranking failure is diagnosable as ours,
 * distinct from a wrong answer by the model.
 *
 * JEV caps `choice` at 255 options and the context at 32k, so something has to give.
 * The question this scoring answers is only ever "could the target plausibly be it?",
 * never "which one is it" — that is the model's job.
 */

export const WEIGHTS = {
  /** Controls you can act on beat things you merely read. */
  role: {
    searchbox: 3.0,
    textbox: 2.6,
    combobox: 2.5,
    button: 2.4,
    fileinput: 2.2,
    checkbox: 1.9,
    radio: 1.9,
    datepicker: 1.9,
    spinbutton: 1.8,
    link: 1.5,
    disclosure: 1.4,
    tab: 1.4,
    menuitem: 1.3,
    option: 1.2,
    heading: 0.5,
    password: 0.2,
  } as Record<string, number>,
  roleDefault: 1.0,
  /** Word shared with the intent — the strongest single signal. */
  intentWord: 2.2,
  intentCtxWord: 0.8,
  /** Visible right now, without scrolling. */
  inViewport: 1.6,
  /** Falls off with distance above or below the fold. */
  proximityMax: 1.2,
  disabled: -1.5,
  required: 0.4,
} as const;

const STOP = new Set([
  "the","a","an","to","of","in","on","for","and","or","with","from","into","at","by",
  "this","that","it","is","are","be","click","open","find","go","page","then","your","my",
  // Control-type words describe the role, which is already scored separately. Leaving
  // them in only creates spurious name matches.
  "button","link","field","box","input","menu","tab","icon",
]);

export function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length > 2 && !STOP.has(w)) out.add(w);
  }
  return out;
}

function overlap(words: Set<string>, text: string): number {
  if (!words.size || !text) return 0;
  let n = 0;
  for (const w of tokenize(text)) if (words.has(w)) n++;
  return n;
}

export function scoreElement(el: RawElement, intentWords: Set<string>, vh: number): number {
  let s = WEIGHTS.role[el.role] ?? WEIGHTS.roleDefault;

  s += WEIGHTS.intentWord * overlap(intentWords, el.name);
  if (el.ctx) s += WEIGHTS.intentCtxWord * overlap(intentWords, el.ctx);

  const mid = el.rect.y + el.rect.h / 2;
  if (mid >= 0 && mid <= vh) {
    s += WEIGHTS.inViewport;
  } else {
    const dist = mid < 0 ? -mid : mid - vh;
    s += WEIGHTS.proximityMax * Math.exp(-dist / (vh * 1.5));
  }

  if (el.st?.includes("disabled")) s += WEIGHTS.disabled;
  if (el.st?.includes("required")) s += WEIGHTS.required;

  return s;
}

/** Every element, best first. Stable: ties keep document order. */
export function rankElements(raw: RawSnapshot, intent: string): RawElement[] {
  const words = tokenize(intent);
  const vh = raw.viewport.h || 800;
  return raw.elements
    .map((el, i) => ({ el, i, s: scoreElement(el, words, vh) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.el);
}

export function toSnapshotElement(el: RawElement): SnapshotElement {
  const { eid, role, name, value, ctx, st } = el;
  return {
    eid,
    role,
    name,
    ...(value !== undefined ? { value } : {}),
    ...(ctx !== undefined ? { ctx } : {}),
    ...(st !== undefined ? { st } : {}),
  };
}

export const DEFAULT_CAP = 120;

/**
 * What actually goes to JEV: ranked, capped, geometry stripped — then RESTORED TO
 * DOCUMENT ORDER.
 *
 * Ranking decides *which* elements survive the cap. It must not decide how they are
 * presented, because positional intents ("open the first job posting", "the top
 * result") are extremely common and the only way the model can answer them is if the
 * list it sees runs in the order the page does. Emitting rank order instead makes
 * "first" unanswerable — the model would be reading our scoring, not the page.
 */
export function rankedSnapshot(raw: RawSnapshot, intent: string, cap = DEFAULT_CAP): Snapshot {
  const keep = new Set(rankElements(raw, intent).slice(0, cap).map((e) => e.eid));
  return {
    url: raw.url,
    title: raw.title,
    viewport: raw.viewport,
    elements: raw.elements.filter((e) => keep.has(e.eid)).map(toSnapshotElement),
    text: raw.text,
    contentHash: raw.contentHash,
  };
}

/** Where the target landed in the ranking, or -1. Used by the recall benchmark. */
export function rankOf(raw: RawSnapshot, intent: string, eid: string): number {
  return rankElements(raw, intent).findIndex((e) => e.eid === eid);
}
