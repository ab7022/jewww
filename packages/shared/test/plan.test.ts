import { describe, expect, it } from "vitest";
import { Node, Plan, walk } from "../src/plan.js";

/**
 * Every node kind must round-trip through the schema.
 *
 * This exists because `fill` was added to the type union and the docs but not to the
 * runtime `discriminatedUnion`, so every plan containing one was rejected at parse
 * time with an error pointing at `foreach` — the fallback branch. Nothing else caught
 * it: the types were right, the prompt was right, and it only failed against a live
 * model.
 */
const SAMPLES: Record<string, unknown> = {
  act: { kind: "act", id: "a", intent: "i", success: "visible" },
  fill: { kind: "fill", id: "f", intent: "i", success: "visible" },
  read: { kind: "read", id: "r", intent: "i", schema: {}, into: "x" },
  compose: { kind: "compose", id: "c", intent: "i", from: ["x"], into: "y" },
  confirm: { kind: "confirm", id: "k", intent: "i", preview: "p", mode: "single" },
  foreach: { kind: "foreach", id: "e", intent: "i", over: "$.x", as: "y", do: [] },
};

describe("plan schema", () => {
  for (const [kind, sample] of Object.entries(SAMPLES)) {
    it(`accepts a ${kind} node`, () => {
      expect(Node.safeParse(sample).success).toBe(true);
    });
  }

  it("accepts a plan containing every kind at once", () => {
    const parsed = Plan.safeParse({ goal: "g", sites: [], nodes: Object.values(SAMPLES) });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown kind rather than silently coercing it", () => {
    expect(Node.safeParse({ kind: "teleport", id: "t", intent: "i" }).success).toBe(false);
  });

  it("walks into foreach bodies", () => {
    const nodes = Node.parse({
      kind: "foreach", id: "e", intent: "i", over: "$.x", as: "y",
      do: [SAMPLES.fill, SAMPLES.act],
    });
    expect(walk([nodes]).map((n) => n.kind)).toEqual(["foreach", "fill", "act"]);
  });
});
