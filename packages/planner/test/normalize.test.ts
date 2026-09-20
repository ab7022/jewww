import type { JevProvider } from "@jev-browser/jev";
import { type Answer, Plan } from "@jev-browser/shared";
import { describe, expect, it } from "vitest";
import { coerceNodes, normalizePlan } from "../src/normalize.js";

const plan = (nodes: Plan["nodes"]): Plan => ({ goal: "g", sites: [], nodes });
const act = (id: string, intent: string, extra: Record<string, unknown> = {}) =>
  ({ kind: "act" as const, id, intent, success: "visible", ...extra });

/** Answers every question with `pick`, over a well-formed distribution. */
function fakeJev(pick: Record<string, [string, number]>): JevProvider {
  return {
    name: "openrouter",
    // biome-ignore lint/suspicious/noExplicitAny: test double
    evaluate: (async (_s: unknown, questions: Record<string, { criteria: Record<string, string> }>) => {
      const answers: Record<string, Answer> = {};
      for (const [id, q] of Object.entries(questions)) {
        const [choice, p] = pick[id] ?? ["act", 0.9];
        const others = Object.keys(q.criteria).filter((k) => k !== choice);
        const probabilities: Record<string, number> = { [choice]: p };
        for (const o of others) probabilities[o] = (1 - p) / others.length;
        answers[id] = { type: "choice", choice, probabilities, confidence: p };
      }
      return { answers, usage: { inputTokens: 1, outputTokens: 0 }, costUsd: 0.0002, model: "m", latencyMs: 1 };
    }) as any,
  };
}

describe("normalizePlan", () => {
  it("rewrites an act node the model says is a form fill", async () => {
    const { plan: out, changes } = await normalizePlan(
      fakeJev({ a: ["fill", 0.95] }),
      plan([act("a", "Fill all mappable fields in the application form")]),
    );
    expect(out.nodes[0]?.kind).toBe("fill");
    expect(changes[0]?.confidence).toBeCloseTo(0.95, 2);
  });

  it("leaves a node the model says is an ordinary interaction", async () => {
    const { plan: out, changes } = await normalizePlan(
      fakeJev({ a: ["act", 0.9] }),
      plan([act("a", "Click the submit button")]),
    );
    expect(out.nodes[0]?.kind).toBe("act");
    expect(changes).toHaveLength(0);
  });

  it("does not rewrite on a low-confidence answer", async () => {
    const { plan: out } = await normalizePlan(
      fakeJev({ a: ["fill", 0.45] }),
      plan([act("a", "Maybe fill something")]),
    );
    expect(out.nodes[0]?.kind).toBe("act");
  });

  it("leaves a slotted act node alone — it types one specific value", async () => {
    const { plan: out } = await normalizePlan(
      fakeJev({ a: ["fill", 0.99] }),
      plan([act("a", "Fill the message field", { slots: { message: "$.summary" } })]),
    );
    expect(out.nodes[0]?.kind).toBe("act");
  });

  it("reaches inside a foreach body", async () => {
    const { plan: out } = await normalizePlan(
      fakeJev({ inner: ["fill", 0.97] }),
      plan([
        {
          kind: "foreach", id: "f", intent: "each job", over: "$.jobs", as: "job",
          do: [act("inner", "Complete the application form")],
        },
      ]),
    );
    const loop = out.nodes[0];
    expect(loop?.kind === "foreach" && loop.do[0]?.kind).toBe("fill");
  });

  it("is a no-op when there is nothing to classify", async () => {
    const empty = plan([{ kind: "read", id: "r", intent: "i", schema: {}, into: "x" }]);
    const { changes, costUsd } = await normalizePlan(fakeJev({}), empty);
    expect(changes).toHaveLength(0);
    expect(costUsd).toBe(0);
  });
});

describe("coerceNodes", () => {
  const raw = (nodes: unknown[]) => ({ goal: "g", sites: [], nodes });

  it("turns an invented node kind into an act node", async () => {
    // A long plan reliably contains one of these, and rejecting the whole plan over
    // it loses twenty good nodes.
    const fixed = coerceNodes(raw([{ kind: "navigate", id: "n", intent: "Open the page" }])) as {
      nodes: { kind: string; success: string }[];
    };
    expect(fixed.nodes[0]?.kind).toBe("act");
    expect(fixed.nodes[0]?.success).toContain("Open the page");
    expect(Plan.safeParse(fixed).success).toBe(true);
  });

  it("keeps a supplied success criterion", () => {
    const fixed = coerceNodes(
      raw([{ kind: "verify", id: "v", intent: "check it", success: "the badge is visible" }]),
    ) as { nodes: { success: string }[] };
    expect(fixed.nodes[0]?.success).toBe("the badge is visible");
  });

  it("drops a node that says nothing at all", () => {
    const fixed = coerceNodes(raw([{ kind: "???" }, { kind: "act", id: "a", intent: "i", success: "s" }])) as {
      nodes: unknown[];
    };
    expect(fixed.nodes).toHaveLength(1);
  });

  it("reaches inside a foreach body", () => {
    const fixed = coerceNodes(
      raw([
        { kind: "foreach", id: "f", intent: "i", over: "$.x", as: "y",
          do: [{ kind: "upload", id: "u", intent: "attach the file" }] },
      ]),
    ) as { nodes: { do: { kind: string }[] }[] };
    expect(fixed.nodes[0]?.do[0]?.kind).toBe("act");
  });

  it("leaves a valid plan untouched", () => {
    const good = raw([{ kind: "act", id: "a", intent: "i", success: "s" }]);
    expect(coerceNodes(good)).toEqual(good);
  });
});

describe("locating steps on a site", () => {
  const withSites = (nodes: Plan["nodes"]): Plan => ({
    goal: "g", sites: ["https://in.bookmyshow.com"], nodes,
  });

  it("marks a step with the site the model says it happens on", async () => {
    // The planner lists sites on the plan but rarely on the node, and nothing else
    // can supply it — there is no navigate operation for the model to choose.
    const { plan: out } = await normalizePlan(
      fakeJev({ a: ["act", 0.9], site_a: ["https://in.bookmyshow.com", 0.95] }),
      withSites([act("a", "Navigate to BookMyShow")]),
    );
    expect(out.nodes[0]?.kind === "act" && out.nodes[0].site).toBe("https://in.bookmyshow.com");
  });

  it("leaves a step alone when it belongs on the current page", async () => {
    const { plan: out } = await normalizePlan(
      fakeJev({ a: ["act", 0.9], site_a: ["__current", 0.95] }),
      withSites([act("a", "Click the search button")]),
    );
    expect(out.nodes[0]?.kind === "act" && out.nodes[0].site).toBeUndefined();
  });

  it("does not overwrite a site the planner already set", async () => {
    const { plan: out } = await normalizePlan(
      fakeJev({ a: ["act", 0.9], site_a: ["https://in.bookmyshow.com", 0.99] }),
      withSites([act("a", "do it", { site: "https://example.com" })]),
    );
    expect(out.nodes[0]?.kind === "act" && out.nodes[0].site).toBe("https://example.com");
  });
});
