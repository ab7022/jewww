import { confidenceOf } from "@jev-browser/shared";
import { describe, expect, it, vi } from "vitest";
import { openrouter } from "../src/openrouter.js";
import { JevError, postWithRetry } from "../src/types.js";

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

describe("openrouter adapter", () => {
  it("normalizes noul to boolean/probability", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        model: "typesafe/jev-1.13-20260917",
        answers: { refund: { type: "noul", noul: 0.98 } },
        usage: { input_tokens: 275, output_tokens: 20, cost: 0.00003 },
      }),
    );
    const p = openrouter({ apiKey: "k" });
    const r = await p.evaluate("state", {
      refund: { type: "boolean", instructions: "?" },
    });
    expect(r.answers.refund).toEqual({ type: "boolean", probability: 0.98 });
    expect(r.costUsd).toBe(0.00003);
    expect(r.model).toBe("typesafe/jev-1.13-20260917");
  });

  it("sends boolean on the wire as noul", async () => {
    const f = mockFetch({ model: "m", answers: {}, usage: {} });
    vi.stubGlobal("fetch", f);
    await openrouter({ apiKey: "k" }).evaluate("s", {
      q: { type: "boolean", instructions: "?" },
    });
    const body = JSON.parse((f.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.questions.q.type).toBe("noul");
    expect(body.model).toBe("jev-1.13");
  });

  it("passes choice and score through untranslated", async () => {
    const f = mockFetch({ model: "m", answers: {}, usage: {} });
    vi.stubGlobal("fetch", f);
    await openrouter({ apiKey: "k" }).evaluate("s", {
      a: { type: "choice", instructions: "?", criteria: { x: "x" } },
      b: { type: "score", instructions: "?", criteria: ["lo", "hi"] },
    });
    const body = JSON.parse((f.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.questions.a.type).toBe("choice");
    expect(body.questions.b.type).toBe("score");
  });

  it("survives a choice answer with no probability distribution", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        model: "m",
        answers: { target: { type: "choice", choice: "e3" } },
        usage: { input_tokens: 1, output_tokens: 0, cost: 0 },
      }),
    );
    const r = await openrouter({ apiKey: "k" }).evaluate("s", {
      target: { type: "choice", instructions: "?", criteria: { e3: "a" } },
    });
    expect(r.answers.target.choice).toBe("e3");
    // Undefined, not 0 — 0 would silently force an escalation on every step.
    expect(confidenceOf(r.answers.target)).toBeUndefined();
  });
});

describe("postWithRetry", () => {
  it("does not retry 4xx", async () => {
    const f = vi.fn(async () => new Response("bad", { status: 401 }));
    vi.stubGlobal("fetch", f);
    await expect(postWithRetry("https://x", {}, 100)).rejects.toBeInstanceOf(JevError);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx once", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("err", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const r = await postWithRetry("https://x", {}, 100);
    expect(r.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
