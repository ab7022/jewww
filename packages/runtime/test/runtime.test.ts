import type { Executor, Guard } from "@jev-browser/shared";
import { decide } from "@jev-browser/policy";
import { UnreachableTarget } from "@jev-browser/shared";
import type { JevProvider } from "@jev-browser/jev";
import type { Action, Answer, DecideRequest, Plan, RawSnapshot } from "@jev-browser/shared";
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
      { eid: "e1", node: 1, role: name === "Resume" ? "fileinput" : "button", name, fp: `x|${name}|0`, rect: { x: 0, y: 0, w: 10, h: 10 }, fillable: name === "Resume" },
      { eid: "e2", node: 2, role: "textbox", name: "Password", fp: "textbox|Password|0", rect: { x: 0, y: 20, w: 10, h: 10 }, fillable: true },
    ],
    text: "",
    contentHash: hash,
    totalCandidates: 2,
  };
}

/** A page holding two empty, fillable fields. */
function fakeFillExecutor(): Executor & { acted: Action[]; typed: string[] } {
  const ex = fakeExecutor(["h1", "h2", "h3"]);
  const base = ex.snapshot.bind(ex);
  ex.snapshot = async () => {
    const s = await base();
    return {
      ...s,
      elements: [
        { eid: "e1", node: 1, role: "textbox", name: "First Name", fp: "textbox|First Name|0", rect: { x: 0, y: 0, w: 10, h: 10 }, fillable: true },
        { eid: "e2", node: 2, role: "textbox", name: "Why do you want this job?", fp: "textbox|Why|0", rect: { x: 0, y: 20, w: 10, h: 10 }, fillable: true },
      ],
    };
  };
  return ex;
}

function fakeExecutor(hashes: string[], name?: string): Executor & { acted: Action[]; typed: string[] } {
  let i = 0;
  const acted: Action[] = [];
  // The text for a `type` arrives as a separate argument, not on the action.
  const typed: string[] = [];
  return {
    acted,
    typed,
    async snapshot() {
      return snapshot(hashes[Math.min(i++, hashes.length - 1)] ?? "h", name);
    },
    async pageText() {
      return "page body";
    },
    async guardFor(): Promise<Guard> {
      return { pageKey: "k", nodeGuard: "g" };
    },
    async act(action, _node, _guard, text) {
      acted.push(action);
      if (typeof text === "string") typed.push(text);
    },
    async preflight() {
      return null;
    },
    async settle() {},
    async url() {
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
        blocker: choice("none", optionsFor("blocker")),
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

/** Like fakeJev, but every decision comes back carrying a real risk. */
function fakeJevRisky(ops: string[], target = "e1"): JevProvider {
  const base = fakeJev(ops, target);
  return {
    name: "openrouter",
    // biome-ignore lint/suspicious/noExplicitAny: test double
    evaluate: (async (state: unknown, questions: Record<string, { criteria?: Record<string, unknown> }>) => {
      const r = await (base.evaluate as any)(state, questions);
      const offered = Object.keys(questions.risk?.criteria ?? {});
      const probabilities: Record<string, number> = { message: 0.9 };
      for (const o of offered.filter((k) => k !== "message")) probabilities[o] = 0.1 / (offered.length - 1);
      r.answers.risk = { type: "choice", choice: "message", probabilities, confidence: 0.9 };
      return r;
    }) as any,
  };
}

/**
 * The loop takes its model calls as injected capabilities, so the CLI can wire them
 * to the model packages and the extension to the server. Tests wire `decide` to a
 * scripted JEV and everything else to a stub.
 */
/**
 * `decide` bound to a run, as `bindModels` binds it in production: the request never
 * carries the goal, the binding supplies it.
 */
const decideWith = (jev: JevProvider) => (request: DecideRequest) => {
  const { nodeId: _nodeId, ...rest } = request;
  return decide(jev, { ...rest, goal: "g" });
};

function capabilities(jev: JevProvider, over: Partial<Capabilities> = {}): Capabilities {
  return {
    decide: (input) => decideWith(jev)(input),
    text: async () => "typed text",
    extract: async () => [],
    compose: async () => "composed",
    mapFields: async () => ({ mappings: [], costUsd: 0 }),
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

  it("executes an ordinary click without interrupting the user", async () => {
    const ex = fakeExecutor(["h1", "h2", "h3"], "Submit application");
    const { result } = await run(
      plan([{ kind: "act", id: "a", intent: "i", success: "s" }]),
      fakeJev(["CLICK", "DONE"]),
      ex,
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
      compose: async ({ inputs }) => {
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

describe("collection coercion", () => {
  const body = (over: string) =>
    plan([
      { kind: "read", id: "r", intent: "i", schema: {}, into: "result" },
      {
        kind: "foreach", id: "f", intent: "i", over, as: "item", min: 2,
        do: [{ kind: "compose", id: "c", intent: "i", from: ["$.item"], into: "out" }],
      },
    ]);

  it("accepts a bare array", async () => {
    const { result } = await run(body("$.result"), fakeJev(["DONE"]), fakeExecutor(["h1"]), {}, {
      extract: async () => [{ id: 1 }, { id: 2 }],
    });
    expect(result.status).toBe("done");
  });

  it("unwraps the {items: [...]} shape a read node usually returns", async () => {
    // An extraction asked for a list comes back wrapped as often as not, and the
    // plan then points `over` at the container. Refusing that reported an empty
    // collection while the collection sat in the scratchpad.
    const { result } = await run(body("$.result"), fakeJev(["DONE"]), fakeExecutor(["h1"]), {}, {
      extract: async () => ({ jobs: [{ id: 1 }, { id: 2 }] }),
    });
    expect(result.status).toBe("done");
  });

  it("refuses to guess when an object holds several arrays", async () => {
    const { result } = await run(body("$.result"), fakeJev(["DONE"]), fakeExecutor(["h1"]), {}, {
      extract: async () => ({ jobs: [{ id: 1 }], other: [{ id: 2 }] }),
    });
    expect(result.status).toBe("blocked");
  });
});

describe("batch approvals", () => {
  const loop = plan([
    { kind: "read", id: "r", intent: "i", schema: {}, into: "items" },
    {
      kind: "foreach", id: "f", intent: "i", over: "$.items", as: "item", min: 3,
      do: [{ kind: "act", id: "a", intent: "i", success: "s" }],
    },
  ]);

  it("queues gated steps and keeps going instead of abandoning the batch", async () => {
    // Every iteration hits a gate. Without batching the first one suspends the run
    // and the other items are never attempted.
    const jev = fakeJevRisky(["CLICK"]);
    const { result, events } = await run(loop, jev, fakeExecutor(["h1", "h2", "h3"]), {
      batchApprovals: true,
    }, { extract: async () => [{ company: "A" }, { company: "B" }, { company: "C" }] });

    expect(result.status).toBe("done");
    expect(result.pending).toHaveLength(3);
    expect(result.pending.map((p) => (p.item as { company: string }).company)).toEqual(["A", "B", "C"]);
    expect(events.filter((e) => e.type === "queued")).toHaveLength(3);
  });

  it("executes nothing that was queued", async () => {
    const ex = fakeExecutor(["h1", "h2"]);
    await run(loop, fakeJevRisky(["CLICK"]), ex, { batchApprovals: true }, {
      extract: async () => [{ company: "A" }],
    });
    expect(ex.acted).toHaveLength(0);
  });

  it("without batching, the first gate suspends the whole run", async () => {
    const { result } = await run(loop, fakeJevRisky(["CLICK"]), fakeExecutor(["h1", "h2"]), {}, {
      extract: async () => [{ company: "A" }, { company: "B" }],
    });
    expect(result.status).toBe("suspended");
    expect(result.pending).toHaveLength(0);
  });
});

describe("authority from the user's goal", () => {
  const one = plan([{ kind: "act", id: "a", intent: "i", success: "s" }]);

  it("does not interrupt when the user asked for a task, not a review", async () => {
    const ex = fakeExecutor(["h1", "h2", "h3"]);
    const { result, events } = await run(one, fakeJevRisky(["CLICK", "DONE"]), ex, {
      autonomy: "full",
    });
    expect(result.status).toBe("done");
    expect(ex.acted[0]).toEqual({ kind: "click", eid: "e1" });
    expect(events.some((e) => e.type === "suspend")).toBe(false);
  });

  it("asks when the user asked to be asked", async () => {
    const { result } = await run(one, fakeJevRisky(["CLICK"]), fakeExecutor(["h1", "h2"]), {
      autonomy: "confirm",
    });
    expect(result.status).toBe("suspended");
  });

  it("refuses to finalise when the user said not to, even with blanket approval", async () => {
    // --auto-approve must not override an instruction the user actually gave.
    const ex = fakeExecutor(["h1", "h2"]);
    const { result } = await run(one, fakeJevRisky(["CLICK"]), ex, {
      autonomy: "never",
      approve: async () => true,
    });
    expect(ex.acted).toHaveLength(0);
    expect(result.pending).toHaveLength(1);
  });
});

describe("asking for what it does not know", () => {
  const form = plan([{ kind: "fill", id: "f", intent: "fill the form", success: "filled" }]);
  const profile = { firstName: "Test" };

  /** Maps e1 to firstName and e2 to a question nothing can answer. */
  const caps = (over: Partial<Capabilities> = {}): Partial<Capabilities> => ({
    mapFields: async (input) => ({
      mappings: [
        { eid: "e1", label: "First Name", key: "firstName", confidence: 1, skipped: false },
        { eid: "e2", label: "Why do you want this job?", key: "__none", confidence: 1, skipped: true },
      ].filter((m) => input.fields.some((f) => f.eid === m.eid)),
      costUsd: 0,
    }),
    ...over,
  });

  it("asks only about what it cannot answer", async () => {
    let asked: string[] = [];
    const { result } = await run(
      form, fakeJev(["DONE"]), fakeFillExecutor(), { profile, ask: async (m) => {
        asked = m.map((x) => x.label);
        return {};
      } },
      caps(),
    );
    expect(asked).toEqual(["Why do you want this job?"]);
    expect(result.status).toBe("done");
  });

  it("fills a field from the answer the user just gave", async () => {
    const ex = fakeFillExecutor();
    await run(form, fakeJev(["DONE"]), ex, {
      profile,
      ask: async (m) => Object.fromEntries(m.map((x) => [x.key, "because it is interesting"])),
    }, caps());
    const typed = ex.acted.filter((a) => a.kind === "type").map((a) => (a as { text: string }).text);
    expect(typed).toContain("because it is interesting");
  });

  it("remembers the answer so a later form is filled without asking again", async () => {
    // The point of the whole feature: answer once, then nine applications fill
    // themselves.
    const twice = plan([
      { kind: "fill", id: "f1", intent: "fill", success: "filled" },
      { kind: "fill", id: "f2", intent: "fill", success: "filled" },
    ]);
    let timesAsked = 0;
    const { result } = await run(twice, fakeJev(["DONE"]), fakeFillExecutor(), {
      profile,
      ask: async (m) => {
        timesAsked += 1;
        return Object.fromEntries(m.map((x) => [x.key, "an answer"]));
      },
    }, caps());
    expect(result.status).toBe("done");
    expect(timesAsked).toBe(1);
  });

  it("leaves the field blank when there is nobody to ask", async () => {
    const ex = fakeFillExecutor();
    await run(form, fakeJev(["DONE"]), ex, { profile }, caps());
    expect(ex.acted.filter((a) => a.kind === "type")).toHaveLength(1); // firstName only
  });
});

describe("attach", () => {
  it("is terminal — the driver's success is not re-litigated by the model", async () => {
    // setInputFiles either works or throws, so asking the model to confirm it from
    // the page is strictly worse than trusting the executor.
    const ex = fakeExecutor(["h1", "h2", "h3"], "Resume");
    const jev = fakeJev(["ATTACH", "CLICK", "CLICK"], "e1");
    const { result } = await run(
      plan([{ kind: "act", id: "a", intent: "attach the resume", success: "attached" }]),
      jev, ex, { profile: { resumeFile: "/tmp/cv.pdf" } },
    );
    expect(result.status).toBe("done");
    expect(ex.acted).toHaveLength(1);
    expect(ex.acted[0]?.kind).toBe("attach");
  });
});

describe("reaching another site", () => {
  it("navigates to a node's site before acting there", async () => {
    // There is no NAVIGATE operation for the model to choose, so without this a goal
    // like "open BookMyShow and search" is unreachable from any other page.
    const ex = fakeExecutor(["h1", "h2"]);
    await run(
      plan([{ kind: "act", id: "a", intent: "search there", success: "s", site: "in.bookmyshow.com" }]),
      fakeJev(["DONE"]), ex,
    );
    expect(ex.acted[0]).toEqual({ kind: "navigate", url: "https://in.bookmyshow.com/" });
  });

  it("does not navigate when already on that site", async () => {
    const ex = fakeExecutor(["h1", "h2"]);
    ex.url = async () => "https://x.test/page";
    await run(
      plan([{ kind: "act", id: "a", intent: "do a thing", success: "s", site: "https://x.test" }]),
      fakeJev(["DONE"]), ex,
    );
    expect(ex.acted.filter((a) => a.kind === "navigate")).toHaveLength(0);
  });

  it("prefers an explicit url slot over the site", async () => {
    const ex = fakeExecutor(["h1", "h2"]);
    await run(
      plan([{
        kind: "act", id: "a", intent: "open it", success: "s",
        site: "example.com", slots: { url: "https://example.com/deep/link" },
      }]),
      fakeJev(["DONE"]), ex,
    );
    expect(ex.acted[0]).toEqual({ kind: "navigate", url: "https://example.com/deep/link" });
  });
});

describe("feedback into the next decision", () => {
  it("tells the model what failed and why", async () => {
    // Previously `recent` was always empty, so a refused click looked exactly like
    // one never attempted and the model picked the same covered target forever.
    const seen: { action: string }[][] = [];
    const ex = fakeExecutor(["h1", "h2", "h3"]);
    ex.act = async () => {
      throw new UnreachableTarget("covered by div#modal");
    };
    await run(plan([{ kind: "act", id: "a", intent: "i", success: "s" }]), fakeJev(["CLICK"]), ex, {}, {
      decide: async (input) => {
        seen.push(input.recent as { action: string }[]);
        return decideWith(fakeJev(["CLICK"]))(input);
      },
    });
    const later = seen.find((r) => r.length > 0);
    expect(later?.[0]?.action).toContain("FAILED");
    expect(later?.[0]?.action).toContain("covered by div#modal");
  });

  it("records whether the page actually changed", async () => {
    const seen: { pageChanged?: boolean | null }[][] = [];
    await run(plan([{ kind: "act", id: "a", intent: "i", success: "s" }]), fakeJev(["CLICK"]),
      fakeExecutor(["same"]), {}, {
        decide: async (input) => {
          seen.push(input.recent as { pageChanged?: boolean | null }[]);
          return decideWith(fakeJev(["CLICK"]))(input);
        },
      });
    const withHistory = seen.find((r) => r.length > 0);
    expect(withHistory?.[0]?.pageChanged).toBe(false);
  });
});

describe("not navigating away from where you already are", () => {
  it("stays put when the current page is already on that site", async () => {
    // The tab executor reported "" for its URL, so this check always failed and a
    // step marked site:google.com navigated away from google.com/travel/flights.
    const ex = fakeExecutor(["h1", "h2"]);
    ex.url = async () => "https://www.google.com/travel/flights";
    await run(
      plan([{ kind: "act", id: "a", intent: "search flights", success: "s", site: "https://www.google.com" }]),
      fakeJev(["DONE"]), ex,
    );
    expect(ex.acted.filter((a) => a.kind === "navigate")).toHaveLength(0);
  });

  it("does not report the step finished just for navigating", async () => {
    const ex = fakeExecutor(["h1", "h2"]);
    ex.url = async () => "https://elsewhere.test";
    const { events } = await run(
      plan([{ kind: "act", id: "a", intent: "go there", success: "s", site: "https://in.bookmyshow.com" }]),
      fakeJev(["DONE"]), ex,
    );
    const firstDone = events.findIndex((e) => e.type === "node:done");
    const navigated = events.findIndex(
      (e) => e.type === "step" && e.action.kind === "navigate",
    );
    expect(navigated).toBeGreaterThanOrEqual(0);
    expect(firstDone).toBeGreaterThan(navigated);
  });
});

describe("when the text model declines", () => {
  const typing = plan([{ kind: "act", id: "a", intent: "fill the box", success: "s" }]);

  it("asks instead of ending the run", async () => {
    // Returning null is the INSTRUCTED behaviour — inventing someone's phone number
    // is worse than leaving it blank. Treating it as fatal ended whole runs.
    let asked = 0;
    // fakeFillExecutor's e1 is an ordinary textbox; e2 in the other fixture is named
    // "Password", which the credential block correctly refuses.
    const ex = fakeFillExecutor();
    const { result } = await run(typing, fakeJev(["TYPE_TEXT", "DONE"], "e1"), ex, {
      ask: async (missing) => {
        asked += 1;
        return Object.fromEntries(missing.map((m) => [m.key, "typed by hand"]));
      },
    }, { text: async () => null });

    expect(asked).toBe(1);
    expect(result.status).toBe("done");
    expect(ex.typed).toContain("typed by hand");
  });

  it("carries on with the field blank when there is nobody to ask", async () => {
    const { result } = await run(typing, fakeJev(["TYPE_TEXT", "DONE"], "e1"),
      fakeFillExecutor(), {}, { text: async () => null });
    expect(result.status).toBe("done");
  });
});

describe("an unexpected failure", () => {
  it("ends the step, not the run", async () => {
    const ex = fakeExecutor(["h1", "h2"]);
    ex.snapshot = async () => {
      throw new Error("something nobody anticipated");
    };
    const { result, events } = await run(
      plan([
        { kind: "act", id: "a", intent: "the bad one", success: "s" },
        { kind: "compose", id: "c", intent: "still fine", from: [], into: "out" },
      ]),
      fakeJev(["DONE"]), ex,
    );
    // The run reports the failure rather than throwing it at the caller.
    expect(events.some((e) => e.type === "warn" && e.message.includes("nobody anticipated"))).toBe(true);
    expect(result.status).toBe("blocked");
  });
});

describe("asking for approval", () => {
  it("announces the question BEFORE waiting on the answer", async () => {
    // The gate awaited an answer to a question the interface had never been told
    // about, so nothing was ever shown and the run hung — a safety mechanism
    // silently turning into a deadlock.
    const order: string[] = [];
    await run(
      plan([{ kind: "confirm", id: "c", intent: "ok?", preview: "send it", mode: "single", risk: "message" }]),
      fakeJev(["DONE"]),
      fakeExecutor(["h1"]),
      {
        approve: async () => {
          order.push("waited");
          return true;
        },
      },
    );
    expect(order).toEqual(["waited"]);
  });

  it("emits an approval event carrying what it wants to do", async () => {
    const { events } = await run(
      plan([{ kind: "confirm", id: "c", intent: "ok?", preview: "send it", mode: "single", risk: "message" }]),
      fakeJev(["DONE"]), fakeExecutor(["h1"]), { approve: async () => true },
    );
    const ask = events.find((e) => e.type === "approval");
    expect(ask).toMatchObject({ nodeId: "c", preview: "send it", risk: "message" });
    // And it comes before the node finishes.
    expect(events.indexOf(ask!)).toBeLessThan(
      events.findIndex((e) => e.type === "node:done" && e.id === "c"),
    );
  });

  it("asks before an irreversible step inside an act node", async () => {
    const { events } = await run(
      plan([{ kind: "act", id: "a", intent: "i", success: "s" }]),
      fakeJevRisky(["CLICK"]), fakeExecutor(["h1", "h2"]), { approve: async () => false },
    );
    expect(events.some((e) => e.type === "approval")).toBe(true);
  });
});

/**
 * Telling the model a click was blocked was not enough on its own. The AWS console
 * has two "AWS Amplify" links, one buried under the open services menu, and it kept
 * choosing the buried one — reasonably, since it is still the best-named match. A
 * covered element is not a judgement call: the hit test already proved it cannot be
 * clicked, so it is taken out of the choices until the page moves.
 */
describe("a covered target is withdrawn from the choices", () => {
  it("stops offering an element whose click was refused as covered", async () => {
    const ex = fakeExecutor(["same", "same", "same", "same"]);
    ex.act = async () => {
      throw new UnreachableTarget('covered by dialog “Services”');
    };

    const offered: string[][] = [];
    await run(
      plan([{ kind: "act", id: "a", intent: "open amplify", success: "amplify is open" }]),
      fakeJev(["CLICK"]),
      ex,
      {},
      {
        decide: async (input) => {
          offered.push(input.snapshot.elements.map((e) => e.name));
          return decideWith(fakeJev(["CLICK"]))(input);
        },
      },
    );

    expect(offered.length).toBeGreaterThan(1);
    expect(offered[0]).toContain("Go");
    // Every later decision is made without the element that proved unclickable.
    for (const round of offered.slice(1)) expect(round).not.toContain("Go");
  });

  it("offers it again once the page has moved", async () => {
    const ex = fakeExecutor(["h1", "h2", "h3"]);
    let attempt = 0;
    ex.act = async () => {
      // Covered the first time only; the page then changes underneath.
      if (attempt++ === 0) throw new UnreachableTarget("covered by div");
    };

    const offered: string[][] = [];
    await run(
      plan([{ kind: "act", id: "a", intent: "open amplify", success: "amplify is open" }]),
      fakeJev(["CLICK", "CLICK", "DONE"]),
      ex,
      {},
      {
        decide: async (input) => {
          offered.push(input.snapshot.elements.map((e) => e.name));
          return decideWith(fakeJev(["CLICK"]))(input);
        },
      },
    );

    expect(offered[1]).toContain("Go");
  });
});
