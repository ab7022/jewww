import type { Executor, Guard } from "@jev-browser/executor";
import { decide } from "@jev-browser/policy";
import type { JevProvider } from "@jev-browser/jev";
import type { Action, Answer, Plan, RawSnapshot } from "@jev-browser/shared";
import { describe, expect, it } from "vitest";
import type { RunEvent } from "../src/events.js";
import { type Capabilities, runPlan } from "../src/run.js";
import { Scratchpad, scratchKey } from "../src/scratchpad.js";

describe("scratchpad", () => {
  it("treats 'x' and '$.x' as the same key", () => {
    expect(scratchKey("$.summary")).toBe("summary");
    expect(scratchKey("summary.field")).toBe("summary");
    const pad = new Scratchpad();
    pad.set("$.summary", "hello");
    expect(pad.get("summary")).toBe("hello");
    expect(pad.has("$.summary")).toBe(true);
  });

  it("resolves a nested path and returns undefined for a missing hop", () => {
    const pad = new Scratchpad({ profile: { email: "a@b.c" } });
    pad.set("job", { company: "Acme", url: "https://acme.test" });
    expect(pad.resolve("$.job.company")).toBe("Acme");
    expect(pad.resolve("$.profile.email")).toBe("a@b.c");
    expect(pad.resolve("$.job.missing.deep")).toBeUndefined();
    expect(pad.resolve("$.nothing")).toBeUndefined();
  });
});

// --- doubles ---------------------------------------------------------------

function snapshot(hash: string, name = "Go"): RawSnapshot {
  return {
    url: "https://x.test/p",
    title: "t",
    viewport: { w: 1280, h: 900, scrollY: 0, maxScrollY: 0 },
    elements: [
      { eid: "e1", node: 1, role: "button", name, fp: `button|${name}|0`, rect: { x: 0, y: 0, w: 10, h: 10 }, fillable: false },
      { eid: "e2", node: 2, role: "textbox", name: "Password", fp: "textbox|Password|0", rect: { x: 0, y: 20, w: 10, h: 10 }, fillable: true },
    ],
    text: "",
    contentHash: hash,
    totalCandidates: 2,
  };
}

function fakeExecutor(hashes: string[], name?: string): Executor & { acted: Action[] } {
  let i = 0;
  const acted: Action[] = [];
  return {
    acted,
    async snapshot() {
      return snapshot(hashes[Math.min(i++, hashes.length - 1)] ?? "h", name);
    },
    async pageText() {
      return "page body";
    },
    async guardFor(): Promise<Guard> {
      return { pageKey: "k", nodeGuard: "g" };
    },
    async act(action) {
      acted.push(action);
    },
    async settle() {},
    url() {
      return "https://x.test/p";
    },
    async close() {},
  };
}

/**
 * A well-formed distribution over EVERY offered option. validateChoice rejects
 * anything less, which is the point of it — so the double has to be honest too.
 */
function choice(picked: string, offered: string[]): Answer {
  const rest = offered.filter((o) => o !== picked);
  const share = rest.length ? 0.1 / rest.length : 0;
  const probabilities: Record<string, number> = { [picked]: rest.length ? 0.9 : 1 };
  for (const o of rest) probabilities[o] = share;
  return { type: "choice", choice: picked, probabilities, confidence: 0.95 };
}

/** Answers a scripted sequence of operations, one per call. */
function fakeJev(ops: string[], target = "e1"): JevProvider {
  let i = 0;
  return {
    name: "openrouter",
    // biome-ignore lint/suspicious/noExplicitAny: test double
    evaluate: (async (_state: unknown, questions: Record<string, { criteria?: Record<string, unknown> }>) => {
      const op = ops[Math.min(i++, ops.length - 1)] ?? "DONE";
      const optionsFor = (key: string) => Object.keys(questions[key]?.criteria ?? {});
      const answers: Record<string, Answer> = {
        operation: choice(op, optionsFor("operation")),
        risk: choice("none", optionsFor("risk")),
      };
      for (const key of Object.keys(questions)) {
        if (!key.endsWith("_target")) continue;
        const offered = optionsFor(key);
        answers[key] = choice(offered.includes(target) ? target : (offered[0] ?? target), offered);
      }
      return { answers, usage: { inputTokens: 1, outputTokens: 0 }, costUsd: 0.0001, model: "m", latencyMs: 1 };
    }) as any,
  };
}

const plan = (nodes: Plan["nodes"]): Plan => ({ goal: "g", sites: [], nodes });

/**
 * The loop takes its model calls as injected capabilities, so the CLI can wire them
 * to the model packages and the extension to the server. Tests wire `decide` to a
 * scripted JEV and everything else to a stub.
 */
function capabilities(jev: JevProvider, over: Partial<Capabilities> = {}): Capabilities {
  return {
    decide: (input) => decide(jev, input),
    text: async () => "typed text",
    extract: async () => [],
    compose: async () => "composed",
    ...over,
  };
}

async function run(
  p: Plan,
  jev: JevProvider,
  executor: Executor,
  extra: Partial<Parameters<typeof runPlan>[0]> = {},
  caps: Partial<Capabilities> = {},
) {
  const events: RunEvent[] = [];
  const result = await runPlan({
    capabilities: capabilities(jev, caps),
    executor,
    plan: p,
    emit: (e) => events.push(e),
    ...extra,
  });
  return { result, events };
}

// --- behaviour -------------------------------------------------------------

describe("act node", () => {
  it("stops after three identical page hashes instead of looping forever", async () => {
    const ex = fakeExecutor(["same"]);
    const { result } = await run(plan([{ kind: "act", id: "a", intent: "i", success: "s" }]), fakeJev(["CLICK"]), ex);
    expect(result.status).toBe("blocked");
    expect(ex.acted.length).toBeLessThan(5);
  });

  it("completes when the model reports DONE", async () => {
    const { result } = await run(plan([{ kind: "act", id: "a", intent: "i", success: "s" }]), fakeJev(["DONE"]), fakeExecutor(["h1"]));
    expect(result.status).toBe("done");
  });
});

describe("the interlock", () => {
  it("suspends rather than typing into a credential field", async () => {
    const jev = fakeJev(["TYPE_TEXT"], "e2"); // e2 is named "Password"
    const { result, events } = await run(
      plan([{ kind: "act", id: "a", intent: "i", success: "s" }]),
      jev,
      fakeExecutor(["h1", "h2", "h3"]),
      { approve: async () => true }, // even with blanket approval
    );
    expect(result.status).toBe("suspended");
    expect(events.some((e) => e.type === "suspend" && e.reason === "handoff")).toBe(true);
  });

  it("requires confirmation for an irreversible label even when risk says none", async () => {
    const { result, events } = await run(
      plan([{ kind: "act", id: "a", intent: "i", success: "s" }]),
      fakeJev(["CLICK"]),
      fakeExecutor(["h1", "h2"], "Submit application"),
    );
    expect(result.status).toBe("suspended");
    expect(events.some((e) => e.type === "suspend" && e.reason === "confirm")).toBe(true);
  });

  it("proceeds past an irreversible label once approved", async () => {
    const ex = fakeExecutor(["h1", "h2", "h3"], "Submit application");
    const { result } = await run(
      plan([{ kind: "act", id: "a", intent: "i", success: "s" }]),
      fakeJev(["CLICK", "DONE"]),
      ex,
      { approve: async () => true },
    );
    expect(result.status).toBe("done");
    expect(ex.acted[0]).toEqual({ kind: "click", eid: "e1" });
  });
});

describe("confirm node", () => {
  it("suspends when there is no approver at all", async () => {
    const { result } = await run(
      plan([{ kind: "confirm", id: "c", intent: "i", preview: "send it", mode: "single" }]),
      fakeJev(["DONE"]),
      fakeExecutor(["h1"]),
    );
    expect(result.status).toBe("suspended");
  });

  it("resolves a $.ref preview from the scratchpad", async () => {
    const { events } = await run(
      plan([
        { kind: "compose", id: "m", intent: "i", from: [], into: "$.summary" },
        { kind: "confirm", id: "c", intent: "i", preview: "$.summary", mode: "single" },
      ]),
      fakeJev(["DONE"]),
      fakeExecutor(["h1"]),
      {},
      { compose: async () => "the composed message" },
    );
    const suspend = events.find((e) => e.type === "suspend");
    expect(suspend && "preview" in suspend && suspend.preview).toBe("the composed message");
  });
});

describe("foreach", () => {
  const body = plan([
    {
      kind: "read", id: "r", intent: "i", schema: {}, into: "items",
    },
    {
      kind: "foreach", id: "f", intent: "i", over: "$.items", as: "item", min: 2,
      do: [{ kind: "act", id: "a", intent: "i", success: "s" }],
    },
  ]);

  it("counts SUCCESSES, not attempts, against min", async () => {
    // Every iteration blocks, so zero succeed and min:2 must fail.
    const { result } = await run(body, fakeJev(["CLICK"]), fakeExecutor(["same"]), {}, {
      extract: async () => [{ id: 1 }, { id: 2 }, { id: 3 }],
    });
    expect(result.status).toBe("blocked");
  });

  it("succeeds once min iterations complete", async () => {
    const { result } = await run(body, fakeJev(["DONE"]), fakeExecutor(["h1"]), {}, {
      extract: async () => [{ id: 1 }, { id: 2 }],
    });
    expect(result.status).toBe("done");
  });

  it("skips duplicates under distinctBy", async () => {
    const seen: unknown[] = [];
    const p = plan([
      { kind: "read", id: "r", intent: "i", schema: {}, into: "items" },
      {
        kind: "foreach", id: "f", intent: "i", over: "$.items", as: "item",
        distinctBy: "company", min: 2,
        do: [{ kind: "compose", id: "c", intent: "i", from: ["$.item"], into: "out" }],
      },
    ]);
    const { result } = await run(p, fakeJev(["DONE"]), fakeExecutor(["h1"]), {}, {
      extract: async () => [{ company: "A" }, { company: "A" }, { company: "B" }],
      compose: async (_i, inputs) => {
        seen.push(inputs);
        return "x";
      },
    });
    expect(result.status).toBe("done");
    expect(seen).toHaveLength(2); // A and B, the duplicate A skipped
  });

  it("blocks when the collection is missing rather than silently succeeding", async () => {
    const { result } = await run(
      plan([{ kind: "foreach", id: "f", intent: "i", over: "$.nope", as: "x", do: [] }]),
      fakeJev(["DONE"]),
      fakeExecutor(["h1"]),
    );
    expect(result.status).toBe("blocked");
  });
});
