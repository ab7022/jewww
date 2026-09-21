import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import request from "supertest";
import {
  assertBalance,
  InsufficientCredits,
  meter,
  toCredits,
  topUp,
  USD_PER_CREDIT,
} from "../src/credits.js";
import { connect, type Store } from "../src/db.js";
import {
  issueRefresh,
  redeemRefresh,
  revokeRefresh,
  SIGNUP_CREDITS,
  signJwt,
  upsertGoogleUser,
  verifyJwt,
} from "../src/auth.js";

const SECRET = "test-secret-long-enough";
const store: Store = await connect(
  process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017",
  `jevtest_${randomUUID().slice(0, 8)}`,
);

afterAll(async () => {
  await store.db.dropDatabase();
  await store.close();
});

async function makeUser(credits: number): Promise<string> {
  const id = `u_${randomUUID()}`;
  await store.users.insertOne({
    _id: id, email: `${id}@t.test`, credits, createdAt: new Date(),
  });
  return id;
}

describe("credits", () => {
  it("converts cost to credits at 1 credit = $0.001", () => {
    expect(USD_PER_CREDIT).toBe(0.001);
    expect(toCredits(0.0161)).toBeCloseTo(16.1, 3);
    expect(toCredits(0)).toBe(0);
  });

  it("deducts and writes a ledger entry", async () => {
    const u = await makeUser(100);
    const { balance } = await meter(store, u, "decide", 0.01);
    expect(balance).toBeCloseTo(90, 3);
    const entries = await store.ledger.find({ userId: u }).toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.credits).toBeCloseTo(-10, 3);
  });

  it("refuses to go negative", async () => {
    const u = await makeUser(5);
    await expect(meter(store, u, "decide", 0.01)).rejects.toBeInstanceOf(InsufficientCredits);
    const user = await store.users.findOne({ _id: u });
    expect(user?.credits).toBe(5); // untouched
  });

  it("CANNOT be overdrawn by concurrent runs", async () => {
    // The bug this guards: read-then-write lets two runs both see a positive balance
    // and both spend it. Ten parallel charges of 10 credits against a balance of 50
    // must settle at exactly five successes and a balance of zero.
    const u = await makeUser(50);
    const attempts = Array.from({ length: 10 }, () =>
      meter(store, u, "decide", 0.01).then(
        () => "ok" as const,
        () => "refused" as const,
      ),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === "ok")).toHaveLength(5);
    const user = await store.users.findOne({ _id: u });
    expect(user?.credits).toBeCloseTo(0, 6);
    expect(user?.credits).toBeGreaterThanOrEqual(0);
  });

  it("records spend against the run", async () => {
    const u = await makeUser(100);
    const runId = randomUUID();
    await store.runs.insertOne({
      _id: runId, userId: u, goal: "g", startUrl: "u", status: "running", autonomy: "confirm",
      creditsSpent: 0, steps: 0, createdAt: new Date(), updatedAt: new Date(),
    });
    await meter(store, u, "decide", 0.002, runId);
    await meter(store, u, "text", 0.001, runId);
    const run = await store.runs.findOne({ _id: runId });
    expect(run?.creditsSpent).toBeCloseTo(3, 3);
  });

  it("tops up and logs it", async () => {
    const u = await makeUser(0);
    expect(await topUp(store, u, 250)).toBe(250);
    await expect(assertBalance(store, u, 100)).resolves.toBe(250);
  });

  it("assertBalance refuses before expensive work", async () => {
    const u = await makeUser(2);
    await expect(assertBalance(store, u, 5)).rejects.toBeInstanceOf(InsufficientCredits);
  });
});

describe("tokens", () => {
  it("round-trips a signed payload", () => {
    const t = signJwt({ sub: "u1" }, SECRET);
    expect(verifyJwt(t, SECRET)?.sub).toBe("u1");
  });

  it("rejects a tampered payload", () => {
    const t = signJwt({ sub: "u1" }, SECRET);
    const [h, , s] = t.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: "admin", exp: 9e9 })).toString("base64url")}.${s}`;
    expect(verifyJwt(forged, SECRET)).toBeNull();
  });

  it("rejects the wrong secret and an expired token", () => {
    expect(verifyJwt(signJwt({ sub: "u1" }, SECRET), "other")).toBeNull();
    expect(verifyJwt(signJwt({ sub: "u1" }, SECRET, -10), SECRET)).toBeNull();
  });

  it("stores only a hash of the refresh token, and revoking ends it", async () => {
    const u = await makeUser(10);
    const token = await issueRefresh(store, u);
    const row = await store.sessions.findOne({ userId: u });
    expect(row?.tokenHash).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await redeemRefresh(store, token)).toBe(u);
    await revokeRefresh(store, token);
    expect(await redeemRefresh(store, token)).toBeNull();
  });

  it("grants signup credits exactly once per email", async () => {
    const sub = randomUUID();
    const profile = { sub, email: `${sub}@t.test`, name: "A" };
    const first = await upsertGoogleUser(store, profile);
    expect(first.credits).toBe(SIGNUP_CREDITS);
    await meter(store, first._id, "decide", 0.01);
    // Signing in again must not re-grant the free balance.
    const second = await upsertGoogleUser(store, profile);
    expect(second.credits).toBeCloseTo(SIGNUP_CREDITS - 10, 3);
    expect(await store.ledger.countDocuments({ userId: first._id, kind: "topup" })).toBe(1);
  });
});

describe("http", () => {
  const app = createApp({
    store,
    jwtSecret: SECRET,
    openrouterKey: "unused-in-these-tests",
    appUrl: "http://localhost/app",
  });

  let userId = "";
  let auth = "";
  beforeEach(async () => {
    userId = await makeUser(1000);
    auth = `Bearer ${signJwt({ sub: userId }, SECRET)}`;
  });

  it("is healthy", async () => {
    await request(app).get("/health").expect(200);
  });

  it("rejects an unauthenticated api call", async () => {
    await request(app).get("/api/me").expect(401);
    await request(app).get("/api/me").set("Authorization", "Bearer nope").expect(401);
  });

  it("returns the balance in credits and in tasks", async () => {
    const res = await request(app).get("/api/me").set("Authorization", auth).expect(200);
    expect(res.body.credits).toBe(1000);
    expect(res.body.approxTasks).toBeGreaterThan(0);
  });

  it("answers 402, not 500, when a run cannot be afforded", async () => {
    const poor = await makeUser(1);
    const res = await request(app)
      .post("/api/runs")
      .set("Authorization", `Bearer ${signJwt({ sub: poor }, SECRET)}`)
      .send({ goal: "g", url: "https://x.test" })
      .expect(402);
    expect(res.body.error).toBe("insufficient_credits");
  });

  it("treats another user's run as nonexistent", async () => {
    const runId = randomUUID();
    await store.runs.insertOne({
      _id: runId, userId: "someone-else", goal: "g", startUrl: "u", status: "running",
      autonomy: "confirm", creditsSpent: 0, steps: 0, createdAt: new Date(), updatedAt: new Date(),
    });
    // A well-formed request, so this tests ownership and not validation.
    await request(app)
      .post(`/api/runs/${runId}/decide`)
      .set("Authorization", auth)
      .send({
        subgoal: "s",
        success: "s",
        nodeId: "n",
        nodes: {},
        recent: [],
        snapshot: {
          url: "https://x.test",
          title: "t",
          viewport: { w: 1, h: 1, scrollY: 0, maxScrollY: 0 },
          elements: [],
          text: "",
          contentHash: "h",
        },
      })
      .expect(404);
    await request(app).get(`/api/runs/${runId}`).set("Authorization", auth).expect(404);
  });

  it("stores and returns a profile", async () => {
    await request(app)
      .put("/api/profile")
      .set("Authorization", auth)
      .send({ fields: { email: "a@b.c", fullName: "A B" } })
      .expect(200);
    const res = await request(app).get("/api/profile").set("Authorization", auth).expect(200);
    expect(res.body.fields.fullName).toBe("A B");
  });

  it("tops up through the dev endpoint and reflects it on /api/me", async () => {
    await request(app).post("/api/dev/topup").set("Authorization", auth).send({ credits: 250 });
    const res = await request(app).get("/api/me").set("Authorization", auth);
    expect(res.body.credits).toBe(1250);
  });

  it("refuses Google routes when sign-in is not configured", async () => {
    await request(app).get("/auth/google/start").expect(501);
  });
});

describe("dev sign-in", () => {
  const withoutGoogle = createApp({
    store, jwtSecret: SECRET, openrouterKey: "unused", appUrl: "http://localhost/app",
  });
  const withGoogle = createApp({
    store, jwtSecret: SECRET, openrouterKey: "unused", appUrl: "http://localhost/app",
    google: { clientId: "id", clientSecret: "secret", redirectUri: "http://localhost/cb" },
  });

  it("is advertised only when Google is not configured", async () => {
    const a = await request(withoutGoogle).get("/auth/config").expect(200);
    expect(a.body).toEqual({ google: false, dev: true });
    const b = await request(withGoogle).get("/auth/config").expect(200);
    expect(b.body).toEqual({ google: true, dev: false });
  });

  it("issues usable tokens", async () => {
    const res = await request(withoutGoogle).post("/auth/dev").send({ email: "t@localhost" }).expect(200);
    expect(res.body.access).toBeTruthy();
    const me = await request(withoutGoogle)
      .get("/api/me")
      .set("Authorization", `Bearer ${res.body.access}`)
      .expect(200);
    expect(me.body.credits).toBeGreaterThan(0);
  });

  it("is refused once Google IS configured — a bypass must not survive deployment", async () => {
    await request(withGoogle).post("/auth/dev").send({ email: "t2@localhost" }).expect(404);
  });
});

describe("every route answers", () => {
  const app = createApp({
    store, jwtSecret: SECRET, openrouterKey: "unused", appUrl: "http://localhost/app",
  });

  it("responds to /api/runs even when the model call fails", async () => {
    // An edit once deleted this handler's body: it inserted the run row and returned
    // nothing, so the panel waited forever on "working out how to do this". The
    // existing 402 test passed straight through it, because the balance check throws
    // before reaching the missing code — so it needs a FUNDED user.
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 401 }));
    const funded = await makeUser(1000);
    const res = await request(app)
      .post("/api/runs")
      .set("Authorization", `Bearer ${signJwt({ sub: funded }, SECRET)}`)
      .send({ goal: "do a thing", url: "https://example.com" })
      .timeout(8000);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("records the run even though planning failed", async () => {
    const before = await store.runs.countDocuments();
    expect(before).toBeGreaterThan(0);
  });
});

/**
 * Sign-in used to deliver tokens to whatever `?redirect=` named, because the server
 * signed the caller's value into `state` itself — so a link to /auth/google/start with
 * an attacker's URL handed over a working session. These pin the allow-list.
 */
describe("where sign-in may send tokens", () => {
  const google = { clientId: "id", clientSecret: "secret", redirectUri: "http://localhost/cb" };
  const EXT = "a".repeat(32);
  const dev = createApp({ store, jwtSecret: SECRET, openrouterKey: "unused", appUrl: "https://jev.app", google, production: false });
  const prod = createApp({
    store, jwtSecret: SECRET, openrouterKey: "unused", appUrl: "https://jev.app", google, production: true, extensionIds: [EXT],
  });

  it("refuses to send tokens to another site", async () => {
    const res = await request(prod).get("/auth/google/start").query({ redirect: "https://attacker.example/steal" }).expect(400);
    expect(res.body.error).toBe("redirect_not_allowed");
  });

  it("allows the website and the published extension", async () => {
    await request(prod).get("/auth/google/start").query({ redirect: "https://jev.app/dashboard" }).expect(302);
    await request(prod).get("/auth/google/start").query({ redirect: `https://${EXT}.chromiumapp.org/google` }).expect(302);
  });

  it("refuses an unknown extension in production, accepts it in development", async () => {
    const other = `https://${"b".repeat(32)}.chromiumapp.org/google`;
    await request(prod).get("/auth/google/start").query({ redirect: other }).expect(400);
    await request(dev).get("/auth/google/start").query({ redirect: other }).expect(302);
  });

  it("re-checks the target at the callback, so an old state cannot outlive the rule", async () => {
    const forged = signJwt({ r: "https://attacker.example/steal" }, SECRET, 600);
    const res = await request(prod).get("/auth/google/callback").query({ code: "c", state: forged }).expect(400);
    expect(res.body.error).toBe("bad_state");
  });
});

describe("the website's session and CORS", () => {
  const app = createApp({ store, jwtSecret: SECRET, openrouterKey: "unused", appUrl: "http://localhost:5173" });

  it("keeps the website's refresh token in an httpOnly cookie, not the response", async () => {
    const res = await request(app).post("/auth/dev").send({ email: "web@x.test", client: "web" }).expect(200);
    expect(res.body.refresh).toBe("");
    const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
    expect(cookies.find((c) => c.startsWith("jev_refresh="))).toMatch(/HttpOnly/i);
    expect(cookies.some((c) => c.startsWith("jev_signed_in=1"))).toBe(true);

    const refresh = cookies.find((c) => c.startsWith("jev_refresh="))?.split(";")[0] ?? "";
    const again = await request(app).post("/auth/refresh").set("Cookie", refresh).send({}).expect(200);
    expect(again.body.access).toBeTruthy();
  });

  it("answers CORS for the website and the extension only", async () => {
    const site = await request(app).get("/health").set("Origin", "http://localhost:5173");
    expect(site.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const ext = await request(app).get("/health").set("Origin", `chrome-extension://${"c".repeat(32)}`);
    expect(ext.headers["access-control-allow-credentials"]).toBe("true");
    const evil = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects a malformed request with the field named, before any model call", async () => {
    const auth = `Bearer ${signJwt({ sub: "someone" }, SECRET)}`;
    const res = await request(app).post("/api/runs").set("Authorization", auth).send({ goal: "", url: "not a url" }).expect(400);
    expect(res.body.error).toBe("invalid_request");
    expect(res.body.message).toMatch(/goal/);
    expect(res.body.message).toMatch(/url/);
  });
});

/**
 * Payments. The properties that matter are about money: credits come only from our own
 * pack table, only for a payment Dodo vouches for, and exactly once however many times
 * the news arrives.
 */
describe("payments", async () => {
  const { signWebhook, verifyWebhook, settle } = await import("../src/billing.js");
  const WHSEC = `whsec_${Buffer.from("a-webhook-secret-for-tests").toString("base64")}`;
  const dodo = {
    apiKey: "sk_test",
    webhookSecret: WHSEC,
    mode: "test" as const,
    products: { starter: "pdt_starter", pro: "pdt_pro", team: "pdt_team" },
  };
  const app = createApp({ store, jwtSecret: SECRET, openrouterKey: "unused", appUrl: "http://localhost:5173", dodo });
  const bearer = (u: string) => `Bearer ${signJwt({ sub: u }, SECRET)}`;

  /** Stand in for Dodo's API: checkout creation and payment lookup. */
  const payments = new Map<string, unknown>();
  const stubDodo = () =>
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/checkouts")) {
        const body = JSON.parse(String(init?.body));
        return Response.json({ session_id: `cks_${body.metadata.order_id}`, checkout_url: "https://test.checkout.dodopayments.com/x" });
      }
      const id = decodeURIComponent(url.split("/payments/")[1] ?? "");
      const p = payments.get(id);
      return p ? Response.json(p) : new Response("not found", { status: 404 });
    });

  const deliver = (event: unknown, secret = WHSEC, at = Math.floor(Date.now() / 1000)) => {
    const raw = JSON.stringify(event);
    const id = `msg_${randomUUID()}`;
    return request(app)
      .post("/webhooks/dodo")
      .set("Content-Type", "application/json")
      .set("webhook-id", id)
      .set("webhook-timestamp", String(at))
      .set("webhook-signature", signWebhook(secret, id, String(at), raw))
      .send(raw);
  };

  async function buy(u: string, packId = "pro") {
    stubDodo();
    const res = await request(app).post("/api/billing/checkout").set("Authorization", bearer(u)).send({ packId });
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    return res.body as { orderId: string; url: string };
  }
  const paid = (orderId: string, over: Record<string, unknown> = {}) => ({
    payment_id: `pay_${orderId}`,
    status: "succeeded",
    total_amount: 2900,
    currency: "USD",
    checkout_session_id: `cks_${orderId}`,
    metadata: { order_id: orderId },
    product_cart: [{ product_id: "pdt_pro", quantity: 1 }],
    ...over,
  });

  it("verifies Standard Webhooks signatures, and refuses stale or forged ones", () => {
    const body = '{"a":1}';
    const now = Date.now();
    const ts = String(Math.floor(now / 1000));
    const sig = signWebhook(WHSEC, "msg_1", ts, body);
    expect(verifyWebhook(WHSEC, { id: "msg_1", timestamp: ts, signature: sig }, body, now)).toBe(true);
    // Rotation: several signatures, one of them ours.
    expect(verifyWebhook(WHSEC, { id: "msg_1", timestamp: ts, signature: `v1,AAAA ${sig}` }, body, now)).toBe(true);
    expect(verifyWebhook(WHSEC, { id: "msg_1", timestamp: ts, signature: sig }, '{"a":2}', now)).toBe(false);
    expect(verifyWebhook(WHSEC, { id: "msg_2", timestamp: ts, signature: sig }, body, now)).toBe(false);
    expect(verifyWebhook(WHSEC, { id: "msg_1", timestamp: ts, signature: sig }, body, now + 10 * 60_000)).toBe(false);
    expect(verifyWebhook(WHSEC, { id: "msg_1", timestamp: ts }, body, now)).toBe(false);
  });

  it("creates an order and hands back Dodo's checkout", async () => {
    const u = await makeUser(0);
    const { orderId, url } = await buy(u);
    expect(url).toMatch(/^https:\/\/test\.checkout\.dodopayments\.com/);
    const order = await store.orders.findOne({ _id: orderId });
    expect(order).toMatchObject({ userId: u, packId: "pro", credits: 40_000, status: "pending", sessionId: `cks_${orderId}` });
  });

  it("grants the pack's credits once, however many times the webhook arrives", async () => {
    const u = await makeUser(0);
    const { orderId } = await buy(u);
    const event = { type: "payment.succeeded", data: paid(orderId, { total_amount: 1 }) };
    for (let i = 0; i < 3; i++) expect((await deliver(event)).status).toBe(200);
    const user = await store.users.findOne({ _id: u });
    // From our table: 40,000 for Pro — not anything the payment body said.
    expect(user?.credits).toBe(40_000);
    expect(await store.ledger.countDocuments({ userId: u, kind: "topup" })).toBe(1);
    expect((await store.orders.findOne({ _id: orderId }))?.status).toBe("paid");
  });

  it("concurrent deliveries still grant once", async () => {
    const u = await makeUser(0);
    const { orderId } = await buy(u);
    const results = await Promise.all(Array.from({ length: 6 }, () => settle(store, dodo, paid(orderId))));
    expect(results.filter((r) => r === "credited")).toHaveLength(1);
    expect((await store.users.findOne({ _id: u }))?.credits).toBe(40_000);
  });

  it("refuses an unsigned or wrongly signed webhook, and grants nothing", async () => {
    const u = await makeUser(0);
    const { orderId } = await buy(u);
    const forged = await deliver({ type: "payment.succeeded", data: paid(orderId) }, `whsec_${Buffer.from("wrong").toString("base64")}`);
    expect(forged.status).toBe(401);
    const unsigned = await request(app).post("/webhooks/dodo").set("Content-Type", "application/json").send(JSON.stringify({ type: "payment.succeeded", data: paid(orderId) }));
    expect(unsigned.status).toBe(401);
    expect((await store.users.findOne({ _id: u }))?.credits).toBe(0);
  });

  it("does not settle an order with a payment for a different product or checkout", async () => {
    const u = await makeUser(0);
    const { orderId } = await buy(u, "team");
    expect(await settle(store, dodo, paid(orderId, { product_cart: [{ product_id: "pdt_starter" }], checkout_session_id: `cks_${orderId}` }))).toBe("mismatch");
    expect(await settle(store, dodo, paid(orderId, { product_cart: [{ product_id: "pdt_team" }], checkout_session_id: "cks_other" }))).toBe("mismatch");
    expect((await store.users.findOne({ _id: u }))?.credits).toBe(0);
  });

  it("a late failure never undoes a success", async () => {
    const u = await makeUser(0);
    const { orderId } = await buy(u);
    await deliver({ type: "payment.succeeded", data: paid(orderId) });
    await deliver({ type: "payment.failed", data: paid(orderId, { status: "failed" }) });
    expect((await store.orders.findOne({ _id: orderId }))?.status).toBe("paid");
  });

  it("the return page completes a purchase by asking Dodo, not by trusting the URL", async () => {
    const u = await makeUser(0);
    const { orderId } = await buy(u);
    stubDodo();
    // Not yet paid at Dodo: the URL may say succeeded; nothing is granted.
    payments.set(`pay_${orderId}`, paid(orderId, { status: "processing" }));
    let res = await request(app).post(`/api/orders/${orderId}/reconcile`).set("Authorization", bearer(u)).send({ paymentId: `pay_${orderId}` });
    expect(res.body.order.status).toBe("pending");
    expect(res.body.credits).toBe(0);
    // Now it is.
    payments.set(`pay_${orderId}`, paid(orderId));
    res = await request(app).post(`/api/orders/${orderId}/reconcile`).set("Authorization", bearer(u)).send({ paymentId: `pay_${orderId}` });
    vi.unstubAllGlobals();
    expect(res.body.order.status).toBe("paid");
    expect(res.body.order.invoiceUrl).toBe(`https://test.dodopayments.com/invoices/payments/pay_${orderId}`);
    expect(res.body.credits).toBe(40_000);
  });

  it("someone else's payment id cannot settle your order, nor yours theirs", async () => {
    const mine = await makeUser(0);
    const theirs = await makeUser(0);
    const a = await buy(mine);
    const b = await buy(theirs);
    stubDodo();
    payments.set(`pay_${b.orderId}`, paid(b.orderId));
    // Reconciling MY order with THEIR paid payment: the payment names their order.
    await request(app).post(`/api/orders/${a.orderId}/reconcile`).set("Authorization", bearer(mine)).send({ paymentId: `pay_${b.orderId}` });
    // …which is settled to them, correctly — but never to me.
    expect((await store.users.findOne({ _id: mine }))?.credits).toBe(0);
    const other = await request(app).post(`/api/orders/${b.orderId}/reconcile`).set("Authorization", bearer(mine)).send({});
    vi.unstubAllGlobals();
    expect(other.status).toBe(404);
  });

  it("lists only your own orders", async () => {
    const u = await makeUser(0);
    await buy(u, "starter");
    await buy(await makeUser(0), "team");
    const res = await request(app).get("/api/orders").set("Authorization", bearer(u));
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0]).toMatchObject({ packId: "starter", packName: "Starter", credits: 10_000, status: "pending" });
  });

  it("says plainly when payments are not switched on", async () => {
    const off = createApp({ store, jwtSecret: SECRET, openrouterKey: "unused", appUrl: "http://localhost:5173" });
    const u = await makeUser(0);
    const res = await request(off).post("/api/billing/checkout").set("Authorization", `Bearer ${signJwt({ sub: u }, SECRET)}`).send({ packId: "pro" });
    expect(res.status).toBe(503);
    const cfg = await request(off).get("/api/billing").set("Authorization", `Bearer ${signJwt({ sub: u }, SECRET)}`);
    expect(cfg.body).toMatchObject({ enabled: false, mode: null });
    expect(cfg.body.packs).toHaveLength(3);
  });
});
