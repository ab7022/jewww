import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The goal and the user's standing instructions are bound ONCE, when capabilities are
 * built for a run — never passed per call.
 *
 * When they were per-call arguments, each new one was forwarded by some callers and
 * not others: compose got the goal and extract did not, in both the CLI and the
 * extension, and the model answered "I don't have enough information" because it had
 * not been told what the user wanted. These assert that every capability receives
 * both, whatever the caller sends.
 */

const seen: Record<string, Record<string, unknown>> = {};

vi.mock("@jev-browser/policy", () => ({
  decide: vi.fn(async (_jev: unknown, input: Record<string, unknown>) => {
    seen.decide = input;
    return { costUsd: 0.001, operation: "DONE", action: { kind: "done" } };
  }),
  fieldText: vi.fn(async (ctx: Record<string, unknown>) => {
    seen.text = ctx;
    return { text: "hello", costUsd: 0.002 };
  }),
  mapFields: vi.fn(async (_jev: unknown, input: Record<string, unknown>) => {
    seen.fields = input;
    return { mappings: [], costUsd: 0.003, latencyMs: 1 };
  }),
}));

vi.mock("@jev-browser/planner", () => ({
  extract: vi.fn(async (opts: Record<string, unknown>) => {
    seen.extract = opts;
    return { value: { a: 1 }, costUsd: 0.004 };
  }),
  compose: vi.fn(async (opts: Record<string, unknown>) => {
    seen.compose = opts;
    return { value: "drafted", costUsd: 0.005 };
  }),
}));

const { bindModels } = await import("../src/models.js");

const snapshot = {
  url: "https://x.test",
  title: "t",
  viewport: { w: 1, h: 1, scrollY: 0, maxScrollY: 0 },
  elements: [],
  text: "",
  contentHash: "h",
};

describe("capabilities bound to a run", () => {
  const costs: [string, number][] = [];
  const caps = bindModels({
    apiKey: "k",
    jev: {} as never,
    goal: "draft an email to abdul@dolze.ai saying hi",
    instructions: "  sign off as Abdul  ",
    onCost: (kind, usd) => {
      costs.push([kind, usd]);
    },
  });

  beforeEach(() => {
    for (const k of Object.keys(seen)) delete seen[k];
    costs.length = 0;
  });

  it("gives every capability the run's goal and instructions", async () => {
    await caps.decide({ nodeId: "n", subgoal: "s", success: "x", snapshot, nodes: {}, recent: [] });
    await caps.text({ subgoal: "s", field: { label: "To", role: "textbox" }, page: { title: "t", text: "" } });
    await caps.extract({ intent: "pull it", schema: {}, pageText: "body" });
    await caps.compose({ intent: "write the body from the user's goal", inputs: {} });

    for (const name of ["decide", "text", "extract", "compose"]) {
      expect(seen[name]?.goal, `${name} got the goal`).toBe("draft an email to abdul@dolze.ai saying hi");
      expect(seen[name]?.instructions, `${name} got the instructions`).toBe("sign off as Abdul");
    }
  });

  it("does not forward the wire-only nodeId into the policy", async () => {
    await caps.decide({ nodeId: "n1", subgoal: "s", success: "x", snapshot, nodes: {}, recent: [] });
    expect(seen.decide).not.toHaveProperty("nodeId");
  });

  it("reports the cost of every call, so metering cannot miss one", async () => {
    await caps.decide({ nodeId: "n", subgoal: "s", success: "x", snapshot, nodes: {}, recent: [] });
    await caps.text({ subgoal: "s", field: { label: "To", role: "textbox" }, page: { title: "t", text: "" } });
    await caps.mapFields({ page: { url: "u", title: "t" }, fields: [], criteria: {} });
    await caps.extract({ intent: "i", schema: {}, pageText: "" });
    await caps.compose({ intent: "i", inputs: {} });
    expect(costs).toEqual([
      ["decide", 0.001],
      ["text", 0.002],
      ["fields", 0.003],
      ["extract", 0.004],
      ["compose", 0.005],
    ]);
  });

  it("treats blank instructions as none", async () => {
    const bare = bindModels({ apiKey: "k", jev: {} as never, goal: "g", instructions: "   " });
    await bare.compose({ intent: "i", inputs: {} });
    expect(seen.compose?.instructions).toBeUndefined();
  });
});
