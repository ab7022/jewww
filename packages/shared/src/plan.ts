import { z } from "zod";
import { RISK } from "./action.js";

/**
 * A plan is a small PROGRAM, not a to-do list. The LLM compiles a goal into these
 * nodes once; JEV then executes every decision inside them.
 *
 * Five node kinds is the whole language. Everything the product must do — apply to
 * ten jobs, summarise reviews and draft a message, compare prices across sites —
 * has to compile into exactly these.
 */

const Base = {
  id: z.string(),
  intent: z.string(),
};

/** JEV drives a step loop until `success` holds. The only node that touches a page. */
export const ActNode = z.object({
  ...Base,
  kind: z.literal("act"),
  site: z.string().optional(),
  success: z.string(),
  /**
   * Every string the agent will ever TYPE must be materialised here, because JEV
   * generates no tokens. A value may be a literal or a `$.scratchpadKey` reference
   * to something an earlier `read`/`compose` produced.
   */
  slots: z.record(z.string(), z.string()).optional(),
});

/**
 * Fill a whole form in one shot.
 *
 * Distinct from `act` because the economics are completely different: a 26-field
 * application form is ONE batched call that maps every field to a profile key at
 * once (~200ms, ~$0.0004), versus 26 separate decide-and-type rounds. It is the
 * single highest-leverage primitive for form-heavy work, which job applications are.
 */
export const FillNode = z.object({
  ...Base,
  kind: z.literal("fill"),
  site: z.string().optional(),
  success: z.string(),
  /** Scratchpad keys holding values for fields the profile does not cover. */
  extras: z.record(z.string(), z.string()).optional(),
});

/** Page -> structured data. An LLM extraction, written to the scratchpad. */
export const ReadNode = z.object({
  ...Base,
  kind: z.literal("read"),
  site: z.string().optional(),
  /** Shape to extract, as a loose JSON sketch. */
  schema: z.unknown(),
  into: z.string(),
});

/** Data -> text or data. Never touches a page. Where prose gets written. */
export const ComposeNode = z.object({
  ...Base,
  kind: z.literal("compose"),
  from: z.array(z.string()),
  into: z.string(),
});

/** Human gate. Mandatory before anything irreversible. */
export const ConfirmNode = z.object({
  ...Base,
  kind: z.literal("confirm"),
  preview: z.string(),
  mode: z.enum(["single", "batch"]).default("single"),
  risk: z.enum(Object.keys(RISK) as [keyof typeof RISK, ...(keyof typeof RISK)[]]).optional(),
});

export type Node =
  | z.infer<typeof ActNode>
  | z.infer<typeof FillNode>
  | z.infer<typeof ReadNode>
  | z.infer<typeof ComposeNode>
  | z.infer<typeof ConfirmNode>
  | ForeachNode;

/** Iteration. The generic answer to "do this for 10 of them". */
export interface ForeachNode {
  id: string;
  kind: "foreach";
  intent: string;
  /** Scratchpad key holding the collection. */
  over: string;
  as: string;
  /** Keep going until this many succeed, not merely this many attempts. */
  // `| undefined` spelled out because exactOptionalPropertyTypes is on and zod
  // infers optionals as `T | undefined`.
  min?: number | undefined;
  max?: number | undefined;
  /** Field on each item that must be unique across iterations. */
  distinctBy?: string | undefined;
  do: Node[];
}

export const ForeachNode: z.ZodType<ForeachNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: z.literal("foreach"),
    intent: z.string(),
    over: z.string(),
    as: z.string(),
    min: z.number().optional(),
    max: z.number().optional(),
    distinctBy: z.string().optional(),
    do: z.array(Node),
  }),
);

export const Node: z.ZodType<Node> = z.lazy(() =>
  z
    .discriminatedUnion("kind", [ActNode, FillNode, ReadNode, ComposeNode, ConfirmNode])
    .or(ForeachNode),
) as z.ZodType<Node>;

export const Plan = z.object({
  goal: z.string(),
  /** Origins the run is expected to touch, for up-front permission prompts. */
  sites: z.array(z.string()).default([]),
  nodes: z.array(Node).min(1),
});
export type Plan = z.infer<typeof Plan>;

/** Depth-first walk, including nodes nested inside foreach bodies. */
export function walk(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.kind === "foreach") out.push(...walk(n.do));
  }
  return out;
}

/** A slot value that points at the scratchpad rather than carrying a literal. */
export const SCRATCH_REF = /^\$\.[A-Za-z_][\w.]*$/;
