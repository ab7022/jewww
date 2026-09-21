import { z } from "zod";

/**
 * The panel's persisted state, as a schema with a version.
 *
 * chrome.storage survives extension updates. Renaming one field (`log` → `steps`)
 * once produced a blank side panel on every existing install: the old shape came
 * back, `state.steps.map` threw, and React rendered nothing. Guarding each read by
 * hand fixed that field and nothing else.
 *
 * Now every read goes through `parseState`. Anything that does not match is repaired
 * field by field — a bad field falls back to its default, the rest is kept — so a
 * future shape change degrades to "that field is reset", never to a blank panel.
 */
export const STATE_VERSION = 3;

export const StepStatus = z.enum(["pending", "running", "done", "failed", "waiting"]);
export type StepStatus = z.infer<typeof StepStatus>;

export const ActionLine = z.object({
  /** Plain language: "Clicked Apply", not `CLICK "Apply" p=0.93`. */
  text: z.string(),
  /** Technical detail, shown only when someone asks for it. */
  detail: z.string().optional(),
  kind: z.enum(["act", "type", "navigate", "note", "problem"]),
});
export type ActionLine = z.infer<typeof ActionLine>;

export const Risk = z.enum(["none", "money", "message", "destroy", "settings", "auth"]);

export const TimelineStep = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.string(),
  status: StepStatus,
  actions: z.array(ActionLine),
  /** Runtime timestamps (epoch ms), never the time a storage write happened to run. */
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  /** "Item 3" — set while a loop is running this step. */
  iteration: z.string().optional(),
  /** Shown on a step that is waiting for the person. */
  prompt: z
    .object({ preview: z.string(), risk: Risk, reason: z.enum(["confirm", "handoff"]) })
    .optional(),
});
export type TimelineStep = z.infer<typeof TimelineStep>;

export const HistoryEntry = z.object({
  id: z.string(),
  goal: z.string(),
  status: z.string(),
  steps: z.number(),
  credits: z.number(),
  seconds: z.number(),
  at: z.number(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

/** A field a form asked for that the agent could not answer. */
export const Question = z.object({
  key: z.string(),
  label: z.string(),
  role: z.string(),
  required: z.boolean(),
});
export type Question = z.infer<typeof Question>;

export const RunPhase = z.enum(["planning", "running", "done", "blocked", "suspended", "budget", "aborted", "error"]);

export const PanelState = z.object({
  version: z.literal(STATE_VERSION),
  signedIn: z.boolean(),
  /** Which sign-in the server offers. */
  auth: z.object({ google: z.boolean(), dev: z.boolean() }).optional(),
  email: z.string().optional(),
  credits: z.number().optional(),
  running: z.boolean(),
  goal: z.string().optional(),
  /** The plan as a timeline — what the panel actually renders. */
  steps: z.array(TimelineStep),
  status: RunPhase.optional(),
  /** What the run produced, shown when it finishes. */
  result: z.string().optional(),
  error: z.string().optional(),
  /** Totals for the run, shown once it ends. */
  summary: z.object({ steps: z.number(), credits: z.number(), seconds: z.number() }).optional(),
  /** Irreversible steps queued for review. */
  queued: z.array(z.object({ preview: z.string(), risk: z.string() })).optional(),
  /** Questions a form asked that only the person can answer. */
  questions: z.array(Question).optional(),
  /** Finished runs, newest first. */
  history: z.array(HistoryEntry),
});
export type PanelState = z.infer<typeof PanelState>;

export const EMPTY_STATE: PanelState = {
  version: STATE_VERSION,
  signedIn: false,
  running: false,
  steps: [],
  history: [],
};

/**
 * Read whatever storage returned, from any build, into a valid state.
 *
 * Field by field rather than all-or-nothing: an unparseable history must not also
 * throw away the sign-in, and an old shape of one step must not drop the others.
 */
export function parseState(raw: unknown): PanelState {
  const whole = PanelState.safeParse(raw);
  if (whole.success) return whole.data;

  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...EMPTY_STATE };
  const shape = PanelState.shape;
  for (const key of Object.keys(shape) as Extract<keyof typeof shape, string>[]) {
    if (key === "version" || !(key in input)) continue;
    const value = input[key];
    if (key === "steps" || key === "history") {
      // Keep every element that still parses; drop only the ones that do not.
      const item = key === "steps" ? TimelineStep : HistoryEntry;
      out[key] = Array.isArray(value) ? value.flatMap((v) => {
        const r = item.safeParse(v);
        return r.success ? [r.data] : [];
      }) : [];
      continue;
    }
    const r = shape[key].safeParse(value);
    if (r.success) out[key] = r.data;
  }
  return PanelState.parse(out);
}
