import { z } from "zod";
import { Plan } from "./plan.js";
import { Snapshot, SnapshotElement } from "./snapshot.js";

/**
 * Every request that crosses a process boundary, defined ONCE.
 *
 * Before this existed each shape was written three times — as a positional argument
 * list in the runtime, as an object literal in the extension's client, and as a
 * `req.body as {...}` cast in the server — and they drifted every time one of them
 * changed. The subgoal ended up in the `nodeId` slot; `attachable` was never
 * forwarded, so resume upload could not happen through the extension at all; the
 * goal reached `compose` in one caller and not the other.
 *
 * Now the runtime's capability types, the server's parser and every client are
 * derived from these schemas. Changing a shape changes it everywhere, and a caller
 * that sends the wrong thing gets a 400 naming the field — not a model call made
 * with `undefined` in it.
 *
 * Deliberately absent: the goal and the user's standing instructions. Those belong
 * to the RUN, and whoever builds the capabilities for a run binds them once. A caller
 * that is never asked for the goal cannot forget to send it.
 */

/** What happened on a previous step, fed back so the model is not amnesiac. */
export const RecentAction = z.object({
  action: z.string().max(600),
  text: z.string().max(4000).nullable().optional(),
  /** false = the action ran and the page did not visibly change. */
  pageChanged: z.boolean().nullable().optional(),
});
export type RecentAction = z.infer<typeof RecentAction>;

export const DecideRequest = z.object({
  /** Which plan node this decision is for — the audit trail is keyed by it. */
  nodeId: z.string().min(1).max(200),
  subgoal: z.string().min(1).max(2000),
  success: z.string().max(2000),
  snapshot: Snapshot.extend({ elements: z.array(SnapshotElement).max(400) }),
  /** eid → live DOM node id. */
  nodes: z.record(z.string(), z.number()),
  recent: z.array(RecentAction).max(20),
  /** A file the user has offered; its presence is what makes ATTACH an option. */
  attachable: z.string().max(500).optional(),
});
export type DecideRequest = z.infer<typeof DecideRequest>;

export const TextRequest = z.object({
  subgoal: z.string().max(2000),
  field: z.object({
    label: z.string().max(500),
    role: z.string().max(60),
    value: z.string().max(4000).optional(),
  }),
  page: z.object({ title: z.string().max(500), text: z.string().max(8000) }),
  /** Facts the value may legitimately be drawn from. */
  profile: z.record(z.string(), z.string()).optional(),
});
export type TextRequest = z.infer<typeof TextRequest>;

export const ExtractRequest = z.object({
  intent: z.string().min(1).max(2000),
  schema: z.unknown(),
  pageText: z.string().max(60_000),
});
export type ExtractRequest = z.infer<typeof ExtractRequest>;

export const ComposeRequest = z.object({
  intent: z.string().min(1).max(2000),
  inputs: z.record(z.string(), z.unknown()),
});
export type ComposeRequest = z.infer<typeof ComposeRequest>;

export const MapFieldsRequest = z.object({
  page: z.object({ url: z.string(), title: z.string() }),
  fields: z.array(SnapshotElement).max(200),
  /** Everything that could go in a field, as key → description. */
  criteria: z.record(z.string(), z.string()),
});
export type MapFieldsRequest = z.infer<typeof MapFieldsRequest>;

// --- account and run lifecycle ---------------------------------------------

export const CreateRunRequest = z.object({
  goal: z.string().trim().min(1).max(4000),
  url: z.string().url().max(4000),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

/** How much authority the user's own words granted. See policy/constraints.ts. */
export const Autonomy = z.enum(["full", "confirm", "never"]);
export type AutonomyLevel = z.infer<typeof Autonomy>;

/** What a finished run ended as. Anything else is a client bug, not a status. */
export const RunOutcome = z.enum(["done", "blocked", "suspended", "budget", "aborted", "error"]);
export type RunOutcome = z.infer<typeof RunOutcome>;

export const FinishRunRequest = z.object({
  status: RunOutcome,
  steps: z.number().int().min(0).max(10_000).optional(),
  summary: z.string().max(8000).optional(),
});
export type FinishRunRequest = z.infer<typeof FinishRunRequest>;

/** Everything the runtime needs that the server knows better than the client. */
export const RunContext = z.object({
  runId: z.string(),
  plan: Plan,
  autonomy: Autonomy,
  /** Saved details overlaid with anything stated in the request itself. */
  profile: z.record(z.string(), z.string()),
  balance: z.number(),
});
export type RunContext = z.infer<typeof RunContext>;

export const PROFILE_VALUE_MAX = 2000;
export const INSTRUCTIONS_MAX = 4000;

/**
 * A partial update: only what is present changes. A client saving just the form
 * details must not silently wipe the standing instructions, and vice versa.
 */
export const ProfileUpdate = z
  .object({
    fields: z.record(z.string().max(60), z.string().max(PROFILE_VALUE_MAX)).optional(),
    instructions: z.string().max(INSTRUCTIONS_MAX).optional(),
  })
  .refine((u) => u.fields !== undefined || u.instructions !== undefined, "nothing to update");
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;
