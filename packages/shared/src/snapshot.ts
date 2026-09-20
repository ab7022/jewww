import { z } from "zod";

/**
 * Geometry and identity carried by every element the collector finds.
 *
 * `rect` and `docHeight` are kept on the RAW element (not the ranked one) so that
 * ranking can run offline in Node against a saved fixture. That is what lets the
 * benchmark measure recall at several caps without re-capturing pages.
 */
export const RawElement = z.object({
  eid: z.string(),
  /** Code-owned identity of the live DOM node, for re-resolution before input. */
  node: z.number(),
  role: z.string(),
  name: z.string(),
  value: z.string().optional(),
  /** Nearest landmark or heading, e.g. "nav" or "Billing details". */
  ctx: z.string().optional(),
  /** disabled | checked | expanded | focused, space separated. */
  st: z.string().optional(),
  /** `role|name|nth` — used to re-find an element after a re-render. */
  fp: z.string(),
  /** Viewport-relative rect at capture time. */
  rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  /** True when the element is a form control we could fill. */
  fillable: z.boolean(),
});
export type RawElement = z.infer<typeof RawElement>;

export const Viewport = z.object({
  w: z.number(),
  h: z.number(),
  scrollY: z.number(),
  maxScrollY: z.number(),
});
export type Viewport = z.infer<typeof Viewport>;

/** Everything the collector found, before ranking. Fixtures store this. */
export const RawSnapshot = z.object({
  url: z.string(),
  title: z.string(),
  viewport: Viewport,
  elements: z.array(RawElement),
  text: z.string(),
  contentHash: z.string(),
  /** Count before any dropping, for diagnostics. */
  totalCandidates: z.number(),
});
export type RawSnapshot = z.infer<typeof RawSnapshot>;

/** What actually reaches JEV: ranked, capped, and stripped of geometry. */
export const SnapshotElement = RawElement.pick({
  eid: true,
  role: true,
  name: true,
  value: true,
  ctx: true,
  st: true,
});
export type SnapshotElement = z.infer<typeof SnapshotElement>;

export const Snapshot = z.object({
  url: z.string(),
  title: z.string(),
  viewport: Viewport,
  elements: z.array(SnapshotElement),
  text: z.string(),
  contentHash: z.string(),
});
export type Snapshot = z.infer<typeof Snapshot>;

/** One line per element, the form JEV sees as a choice option. */
export function describeElement(e: SnapshotElement): string {
  const parts = [`${e.role}: ${e.name}`];
  if (e.value) parts.push(`= ${e.value}`);
  if (e.ctx) parts.push(`(${e.ctx})`);
  if (e.st) parts.push(`[${e.st}]`);
  return parts.join(" ");
}
