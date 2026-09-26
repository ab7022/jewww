import { describe, expect, it } from "vitest";
import { ApiClient, ApiError } from "../src/index.js";

const tokens = { get: async () => ({ access: "a", refresh: "r" }), set: async () => {} };
const me = { id: "u", email: "e", credits: 1, approxTasks: 0 };

function client(replies: (() => Response | Promise<Response>)[]) {
  let calls = 0;
  const fetchImpl = (async () => {
    const next = replies[Math.min(calls++, replies.length - 1)];
    return next ? next() : Response.json({});
  }) as typeof fetch;
  return { api: new ApiClient("https://jev.test", tokens, fetchImpl), calls: () => calls };
}
const drop = () => {
  throw new TypeError("Failed to fetch");
};

describe("a request that does not get through", () => {
  it("is sent again, and the run carries on", async () => {
    const { api, calls } = client([drop, drop, () => Response.json(me)]);
    expect(await api.call("me")).toEqual(me);
    expect(calls()).toBe(3);
  });

  it("a gateway's timeout page is retried; the server's own error is not", async () => {
    const gw = client([() => new Response("<html>504</html>", { status: 504 }), () => Response.json(me)]);
    expect(await gw.api.call("me")).toEqual(me);
    const own = client([() => Response.json({ error: "upstream_unavailable", message: "try again" }, { status: 504 })]);
    await expect(own.api.call("me")).rejects.toMatchObject({ status: 504, code: "upstream_unavailable" });
    expect(own.calls()).toBe(1);
  });

  it("gives up with a plain reason, not 'Failed to fetch'", async () => {
    const { api, calls } = client([drop]);
    const err = await api.call("me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toMatch(/Couldn't reach Jev \(jev\.test\)/);
    expect(calls()).toBe(5);
  }, 20_000);

  it("never sends a checkout twice", async () => {
    const { api, calls } = client([drop, () => Response.json({ orderId: "o", url: "u" })]);
    await expect(api.call("checkout", { packId: "pro" })).rejects.toBeInstanceOf(ApiError);
    expect(calls()).toBe(1);
  });
});
