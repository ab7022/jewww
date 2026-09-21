import type { JevProvider } from "@jev-browser/jev";
import type { Answer, SnapshotElement, Snapshot } from "@jev-browser/shared";
import { validateChoice } from "@jev-browser/shared";
import { describe, expect, it } from "vitest";
import { buildActionSpace } from "../src/action-space.js";
import { buildQuestions, decide, shouldEscalate } from "../src/decide.js";

const els: SnapshotElement[] = [
  { eid: "e1", role: "button", name: "Search" },
  { eid: "e2", role: "textbox", name: "Search query" },
  { eid: "e3", role: "link", name: "Submit application" },
  // A field that must never be typed into, whatever any model says about it.
  { eid: "e4", role: "textbox", name: "Password" },
];
const nodes = { e1: 11, e2: 22, e3: 33, e4: 44 };
const space = buildActionSpace(els, nodes, { canScrollDown: true, canScrollUp: false });

const snapshot: Snapshot = {
  url: "https://x.test",
  title: "t",
  viewport: { w: 1, h: 1, scrollY: 0, maxScrollY: 9 },
  elements: els,
  text: "",
  contentHash: "h",
};
const input = { goal: "g", subgoal: "s", success: "visible", snapshot, nodes, recent: [] };

function fakeJev(answers: Record<string, Answer>): JevProvider {
  return {
    name: "openrouter",
    // biome-ignore lint/suspicious/noExplicitAny: test double
    evaluate: (async () => ({ answers, usage: { inputTokens: 1, outputTokens: 0 }, costUsd: 0, model: "m", latencyMs: 1 })) as any,
  };
}
const choice = (c: string, probs: Record<string, number>, confidence = 0.9): Answer => ({
  type: "choice", choice: c, probabilities: probs, confidence,
});

const NO_BLOCKER = choice("none", {
  none: 1, captcha: 0, account_required: 0, login_required: 0,
  credentials: 0, paywall: 0, unsupported: 0,
});

describe("action space", () => {
  it("gives each operation its own target set", () => {
    expect(Object.keys(space.targets.TYPE_TEXT ?? {}).sort()).toEqual(["e2", "e4"]);
    expect(Object.keys(space.targets.CLICK ?? {}).sort()).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("a button is never offered as a typing target", () => {
    expect(space.targets.TYPE_TEXT?.e1).toBeUndefined();
    expect(space.targets.TYPE_TEXT?.e3).toBeUndefined();
  });

  it("offers an editable field as CLICK too, so it can be opened rather than typed", () => {
    expect(space.targets.CLICK?.e2?.label).toBe("Open Search query");
  });

  it("only offers scroll directions that are actually available", () => {
    expect(space.operations.SCROLL_DOWN).toBeDefined();
    expect(space.operations.SCROLL_UP).toBeUndefined();
  });
});

describe("fan-out", () => {
  it("asks operation, risk and every target head in ONE request", () => {
    expect(Object.keys(buildQuestions({ ...input, space })).sort()).toEqual([
      "blocker", "click_target", "operation", "risk", "type_text_target",
    ]);
  });

  it("consumes only the head matching the chosen operation", async () => {
    const d = await decide(
      fakeJev({
        operation: choice("CLICK", { CLICK: 0.9, TYPE_TEXT: 0.04, SCROLL_DOWN: 0.02, WAIT: 0.02, DONE: 0.01, BLOCKED: 0.01 }),
        click_target: choice("e1", { e1: 0.94, e2: 0.02, e3: 0.02, e4: 0.02 }),
        // A wrong value in an unused head must not reach the action.
        type_text_target: choice("e2", { e2: 0.97, e4: 0.03 }),
        risk: choice("none", { none: 1, money: 0, message: 0, destroy: 0, settings: 0, auth: 0 }),
        blocker: NO_BLOCKER,
      }),
      input,
    );
    expect(d.action).toEqual({ kind: "click", eid: "e1" });
  });

  it("a malformed unused head does not fail the step", async () => {
    const d = await decide(
      fakeJev({
        operation: choice("CLICK", { CLICK: 0.9, TYPE_TEXT: 0.04, SCROLL_DOWN: 0.02, WAIT: 0.02, DONE: 0.01, BLOCKED: 0.01 }),
        click_target: choice("e1", { e1: 0.94, e2: 0.02, e3: 0.02, e4: 0.02 }),
        type_text_target: choice("nonsense", { nope: 5 }),
        risk: choice("none", { none: 1, money: 0, message: 0, destroy: 0, settings: 0, auth: 0 }),
        blocker: NO_BLOCKER,
      }),
      input,
    );
    expect(d.action.kind).toBe("click");
  });

  it("asks again when an answer is unreadable, and pays for every attempt", async () => {
    const good = {
      operation: choice("CLICK", { CLICK: 0.9, TYPE_TEXT: 0.04, SCROLL_DOWN: 0.02, WAIT: 0.02, DONE: 0.01, BLOCKED: 0.01 }),
      click_target: choice("e1", { e1: 0.94, e2: 0.02, e3: 0.02, e4: 0.02 }),
      risk: choice("none", { none: 1, money: 0, message: 0, destroy: 0, settings: 0, auth: 0 }),
      blocker: NO_BLOCKER,
    };
    // The chosen option is not the argmax: refused, not coerced — then asked again.
    const bad = { ...good, click_target: choice("e2", { e1: 0.94, e2: 0.02, e3: 0.02, e4: 0.02 }) };
    const replies = [bad, good];
    let calls = 0;
    const jev = {
      name: "openrouter",
      evaluate: (async () => ({ answers: replies[calls++], usage: { inputTokens: 1, outputTokens: 0 }, costUsd: 0.001, model: "m", latencyMs: 1 })) as any,
    } as JevProvider;
    const d = await decide(jev, input);
    expect(calls).toBe(2);
    expect(d.action).toEqual({ kind: "click", eid: "e1" });
    expect(d.costUsd).toBeCloseTo(0.002);
  });

  it("gives up after three unreadable answers", async () => {
    let calls = 0;
    const jev = {
      name: "openrouter",
      evaluate: (async () => {
        calls++;
        return { answers: { operation: choice("CLICK", { CLICK: 0.1, WAIT: 0.9 }) }, usage: { inputTokens: 1, outputTokens: 0 }, costUsd: 0, model: "m", latencyMs: 1 };
      }) as any,
    } as JevProvider;
    await expect(decide(jev, input)).rejects.toThrow();
    expect(calls).toBe(3);
  });

  it("never emits typed text itself — the inline helper supplies it", async () => {
    const d = await decide(
      fakeJev({
        operation: choice("TYPE_TEXT", { TYPE_TEXT: 0.9, CLICK: 0.04, SCROLL_DOWN: 0.02, WAIT: 0.02, DONE: 0.01, BLOCKED: 0.01 }),
        type_text_target: choice("e2", { e2: 0.97, e4: 0.03 }),
        click_target: choice("e1", { e1: 0.4, e2: 0.2, e3: 0.2, e4: 0.2 }),
        risk: choice("none", { none: 1, money: 0, message: 0, destroy: 0, settings: 0, auth: 0 }),
        blocker: NO_BLOCKER,
      }),
      input,
    );
    expect(d.action).toEqual({ kind: "type", eid: "e2", text: "" });
  });
});

describe("safety", () => {
  const clickE3 = {
    operation: choice("CLICK", { CLICK: 0.9, TYPE_TEXT: 0.04, SCROLL_DOWN: 0.02, WAIT: 0.02, DONE: 0.01, BLOCKED: 0.01 }),
    click_target: choice("e3", { e1: 0.02, e2: 0.02, e3: 0.94, e4: 0.02 }),
  };

  it("requires confirmation whenever the model reports a risk", async () => {
    const d = await decide(
      fakeJev({
        ...clickE3,
        risk: choice("message", { none: 0.05, money: 0, message: 0.95, destroy: 0, settings: 0, auth: 0 }),
        blocker: NO_BLOCKER,
      }),
      input,
    );
    expect(d.requiresConfirmation).toBe(true);
  });

  it("does not gate an ordinary click just because the label reads dramatic", async () => {
    // e3 is "Submit application". The old word list stopped runs here before they had
    // done anything; risk is the model's judgement now.
    const d = await decide(
      fakeJev({
        ...clickE3,
        risk: choice("none", { none: 1, money: 0, message: 0, destroy: 0, settings: 0, auth: 0 }),
        blocker: NO_BLOCKER,
      }),
      input,
    );
    expect(d.requiresConfirmation).toBe(false);
  });

  it("hands off when the page needs a human", async () => {
    const d = await decide(
      fakeJev({
        ...clickE3,
        risk: choice("none", { none: 1, money: 0, message: 0, destroy: 0, settings: 0, auth: 0 }),
        blocker: choice("captcha", {
          none: 0.02, captcha: 0.98, account_required: 0, login_required: 0,
          credentials: 0, paywall: 0, unsupported: 0,
        }),
      }),
      input,
    );
    expect(d.blocker).toBe("captcha");
    expect(d.mustHandOff).toBe(true);
  });

  it("never types a secret, whatever the model says", async () => {
    // Target e4 ("Password") while risk and blocker both report everything is fine.
    const d = await decide(
      fakeJev({
        operation: choice("TYPE_TEXT", { TYPE_TEXT: 0.9, CLICK: 0.04, SCROLL_DOWN: 0.02, WAIT: 0.02, DONE: 0.01, BLOCKED: 0.01 }),
        type_text_target: choice("e4", { e2: 0.02, e4: 0.98 }),
        click_target: choice("e1", { e1: 0.4, e2: 0.2, e3: 0.2, e4: 0.2 }),
        risk: choice("none", { none: 1, money: 0, message: 0, destroy: 0, settings: 0, auth: 0 }),
        blocker: NO_BLOCKER,
      }),
      input,
    );
    expect(d.mustHandOff).toBe(true);
    expect(d.requiresConfirmation).toBe(true);
  });
});

describe("validateChoice", () => {
  const ids = ["a", "b"];
  it("rejects an option that was never offered", () => {
    expect(() => validateChoice(choice("z", { a: 0.5, b: 0.5 }), ids)).toThrow(/not offered/);
  });
  it("rejects a distribution that does not sum to 1", () => {
    expect(() => validateChoice(choice("a", { a: 0.2, b: 0.2 }), ids)).toThrow(/sum to/);
  });
  it("rejects a choice that is not the argmax", () => {
    expect(() => validateChoice(choice("a", { a: 0.3, b: 0.7 }), ids)).toThrow(/most probable/);
  });
  it("rejects keys that do not match the offered set", () => {
    expect(() => validateChoice(choice("a", { a: 1 }), ids)).toThrow(/do not match/);
  });
  it("accepts a choice with no distribution at all", () => {
    expect(() => validateChoice({ type: "choice", choice: "a" }, ids)).not.toThrow();
  });
});

describe("escalation", () => {
  const base = { operationConfidence: 0.95, targetConfidence: 0.95 } as Parameters<typeof shouldEscalate>[0];
  it("escalates when either head is uncertain", () => {
    expect(shouldEscalate({ ...base, targetConfidence: 0.4 })).toBe(true);
    expect(shouldEscalate({ ...base, operationConfidence: 0.4 })).toBe(true);
    expect(shouldEscalate(base)).toBe(false);
  });
  it("does not escalate merely because a distribution was absent", () => {
    expect(shouldEscalate({ ...base, targetConfidence: undefined })).toBe(false);
  });
});
