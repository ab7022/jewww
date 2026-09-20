import { randomUUID } from "node:crypto";
import { fromEnv } from "@jev-browser/jev";
import { compose, extract, extractDetails, makePlan } from "@jev-browser/planner";
import { isTransient, JevError } from "@jev-browser/jev";
import { decide, fieldText, mapFields } from "@jev-browser/policy";
import type { Snapshot } from "@jev-browser/shared";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import {
  exchangeGoogleCode,
  type GoogleConfig,
  googleAuthUrl,
  issueRefresh,
  redeemRefresh,
  revokeRefresh,
  signJwt,
  upsertGoogleUser,
  verifyJwt,
} from "./auth.js";
import { assertBalance, InsufficientCredits, meter, topUp } from "./credits.js";
import type { Store } from "./db.js";

export interface AppConfig {
  store: Store;
  jwtSecret: string;
  /** Model keys live here and ONLY here — never in a client. */
  openrouterKey: string;
  google?: GoogleConfig;
  /** Where the browser lands after a successful sign-in. */
  appUrl: string;
}

/** `userId` is set by requireAuth and is present on every /api handler. */
interface Authed extends Request {
  userId?: string;
}

export function createApp(cfg: AppConfig): Express {
  const app = express();
  const { store } = cfg;

  // Built lazily so the app is constructible without a live model key — otherwise
  // every test of auth and billing would need one.
  let provider: ReturnType<typeof fromEnv> | undefined;
  const jev = () => (provider ??= fromEnv("openrouter"));

  app.use(express.json({ limit: "4mb" }));
  app.use((req, res, next) => {
    res.set("Access-Control-Allow-Origin", req.get("origin") ?? "*");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // --- auth ---------------------------------------------------------------

  /** Whether real sign-in is available, so a client can offer the right button. */
  app.get("/auth/config", (_req, res) => {
    res.json({ google: Boolean(cfg.google), dev: allowDevAuth() });
  });

  /**
   * Development sign-in. Creates a local account and issues the same tokens Google
   * sign-in would, so the extension can be exercised before OAuth credentials exist.
   *
   * Refuses in production and whenever Google IS configured — a bypass that survives
   * into a deployment is a bypass someone will find.
   */
  app.post("/auth/dev", async (req, res) => {
    if (!allowDevAuth()) return res.status(404).json({ error: "not_found" });
    const email = String(req.body?.email ?? "dev@localhost");
    const user = await upsertGoogleUser(store, { sub: `dev_${email}`, email, name: "Dev User" });
    res.json({
      access: signJwt({ sub: user._id }, cfg.jwtSecret),
      refresh: await issueRefresh(store, user._id),
      credits: user.credits,
    });
  });

  app.get("/auth/google/start", (req, res) => {
    if (!cfg.google) return res.status(501).json({ error: "google_not_configured" });
    // `state` carries the caller's return target and is signed, so another site
    // cannot initiate a sign-in that lands somewhere of its choosing.
    const state = signJwt({ r: String(req.query.redirect ?? cfg.appUrl) }, cfg.jwtSecret, 600);
    res.redirect(googleAuthUrl(cfg.google, state));
  });

  app.get("/auth/google/callback", async (req, res) => {
    if (!cfg.google) return res.status(501).json({ error: "google_not_configured" });
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    if (!code || !state) return res.status(400).json({ error: "missing_code_or_state" });

    const claims = verifyJwt(state, cfg.jwtSecret);
    if (!claims) return res.status(400).json({ error: "bad_state" });

    const profile = await exchangeGoogleCode(cfg.google, code);
    const user = await upsertGoogleUser(store, profile);
    const refresh = await issueRefresh(store, user._id);
    const access = signJwt({ sub: user._id }, cfg.jwtSecret);

    // Tokens go in the fragment, which browsers never send to a server and which
    // stays out of access logs and Referer headers.
    const target = new URL(String(claims.r ?? cfg.appUrl));
    target.hash = new URLSearchParams({ access, refresh }).toString();
    res.redirect(target.toString());
  });

  app.post("/auth/refresh", async (req, res) => {
    const refresh = String(req.body?.refresh ?? "");
    if (!refresh) return res.status(400).json({ error: "missing_refresh" });
    const userId = await redeemRefresh(store, refresh);
    if (!userId) return res.status(401).json({ error: "invalid_refresh" });
    res.json({ access: signJwt({ sub: userId }, cfg.jwtSecret) });
  });

  app.post("/auth/logout", async (req, res) => {
    const refresh = String(req.body?.refresh ?? "");
    if (refresh) await revokeRefresh(store, refresh);
    res.json({ ok: true });
  });

  // --- everything below needs a user --------------------------------------

  function allowDevAuth(): boolean {
    return process.env.NODE_ENV !== "production" && !cfg.google;
  }

  const requireAuth = (req: Authed, res: Response, next: NextFunction) => {
    const header = req.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const claims = token ? verifyJwt(token, cfg.jwtSecret) : null;
    if (!claims?.sub) return res.status(401).json({ error: "unauthorized" });
    req.userId = String(claims.sub);
    next();
  };
  app.use("/api", requireAuth);

  const uid = (req: Authed): string => req.userId as string;

  app.get("/api/me", async (req: Authed, res) => {
    const user = await store.users.findOne({ _id: uid(req) });
    if (!user) return res.status(401).json({ error: "unauthorized" });
    res.json({
      id: user._id,
      email: user.email,
      name: user.name,
      credits: user.credits,
      // The balance in the unit a user cares about. 15 credits is the measured cost
      // of a ~20-step task.
      approxTasks: Math.floor(user.credits / 15),
    });
  });

  app.get("/api/me/ledger", async (req: Authed, res) => {
    const entries = await store.ledger
      .find({ userId: uid(req) })
      .sort({ at: -1 })
      .limit(100)
      .toArray();
    res.json({ entries });
  });

  // --- runs ---------------------------------------------------------------

  app.post("/api/runs", async (req: Authed, res) => {
    const { goal, url } = req.body as { goal?: string; url?: string };
    if (!goal || !url) return res.status(400).json({ error: "missing_goal_or_url" });

    await assertBalance(store, uid(req), 5);

    const runId = randomUUID();
    const now = new Date();
    await store.runs.insertOne({
      _id: runId,
      userId: uid(req),
      goal,
      startUrl: url,
      status: "running",
      creditsSpent: 0,
      createdAt: now,
      updatedAt: now,
    });


  });

  /** Fails closed: a run that is not yours does not exist. */
  const ownRun = async (req: Authed, res: Response) => {
    const run = await store.runs.findOne({ _id: String(req.params.id ?? ""), userId: uid(req) });
    if (!run) {
      res.status(404).json({ error: "no_such_run" });
      return null;
    }
    return run;
  };

  app.post("/api/runs/:id/decide", async (req: Authed, res) => {
    const run = await ownRun(req, res);
    if (!run) return;

    const body = req.body as {
      subgoal: string;
      success: string;
      snapshot: Snapshot;
      nodes: Record<string, number>;
      nodeId: string;
      recent?: { action: string; text?: string | null }[];
    };
    await assertBalance(store, uid(req), 1);

    const d = await decide(jev(), {
      goal: run.goal,
      subgoal: body.subgoal,
      success: body.success,
      snapshot: body.snapshot,
      nodes: body.nodes,
      recent: body.recent ?? [],
    });
    const charge = await meter(store, uid(req), "decide", d.costUsd, run._id);

    await store.steps.insertOne({
      _id: randomUUID(),
      runId: run._id,
      userId: uid(req),
      nodeId: body.nodeId,
      operation: d.operation,
      ...(d.target ? { target: d.target.label } : {}),
      risk: d.risk,
      ...(d.targetConfidence !== undefined ? { confidence: d.targetConfidence } : {}),
      ...(d.selfConfidence !== undefined ? { selfConfidence: d.selfConfidence } : {}),
      requiresConfirmation: d.requiresConfirmation,
      url: body.snapshot.url,
      contentHash: body.snapshot.contentHash,
      inputTokens: d.inputTokens,
      costUsd: d.costUsd,
      latencyMs: d.latencyMs,
      at: new Date(),
    });

    res.json({ decision: d, balance: charge.balance });
  });

  app.post("/api/runs/:id/text", async (req: Authed, res) => {
    const run = await ownRun(req, res);
    if (!run) return;
    await assertBalance(store, uid(req), 1);
    const r = await fieldText(req.body, { apiKey: cfg.openrouterKey });
    const charge = await meter(store, uid(req), "text", r.costUsd, run._id);
    // `null` means the model declined rather than invent a value; the caller asks
    // the person instead. It is an answer, not an error.
    res.json({ text: r.text, balance: charge.balance });
  });

  /** One call maps an entire form. See packages/policy/src/fields.ts. */
  app.post("/api/runs/:id/fields", async (req: Authed, res) => {
    const run = await ownRun(req, res);
    if (!run) return;
    await assertBalance(store, uid(req), 1);
    const r = await mapFields(jev(), req.body);
    const charge = await meter(store, uid(req), "decide", r.costUsd, run._id);
    res.json({ mappings: r.mappings, balance: charge.balance });
  });

  app.post("/api/runs/:id/extract", async (req: Authed, res) => {
    const run = await ownRun(req, res);
    if (!run) return;
    const { intent, schema, pageText } = req.body as {
      intent: string;
      schema: unknown;
      pageText: string;
    };
    await assertBalance(store, uid(req), 1);
    const r = await extract({ apiKey: cfg.openrouterKey, intent, schema, pageText });
    const charge = await meter(store, uid(req), "extract", r.costUsd, run._id);
    res.json({ value: r.value, balance: charge.balance });
  });

  app.post("/api/runs/:id/compose", async (req: Authed, res) => {
    const run = await ownRun(req, res);
    if (!run) return;
    const { intent, inputs } = req.body as { intent: string; inputs: Record<string, unknown> };
    await assertBalance(store, uid(req), 1);
    const r = await compose({ apiKey: cfg.openrouterKey, intent, inputs });
    const charge = await meter(store, uid(req), "compose", r.costUsd, run._id);
    res.json({ value: r.value, balance: charge.balance });
  });

  app.post("/api/runs/:id/finish", async (req: Authed, res) => {
    const run = await ownRun(req, res);
    if (!run) return;
    await store.runs.updateOne(
      { _id: run._id },
      { $set: { status: req.body?.status ?? "done", updatedAt: new Date() } },
    );
    res.json({ ok: true });
  });

  app.get("/api/runs/:id", async (req: Authed, res) => {
    const run = await ownRun(req, res);
    if (!run) return;
    const steps = await store.steps.find({ runId: run._id }).sort({ at: 1 }).toArray();
    res.json({ run, steps });
  });

  // --- profile ------------------------------------------------------------

  app.put("/api/profile", async (req: Authed, res) => {
    const fields = (req.body?.fields ?? {}) as Record<string, string>;
    await store.profiles.updateOne(
      { userId: uid(req) },
      { $set: { fields, updatedAt: new Date() }, $setOnInsert: { _id: randomUUID() } },
      { upsert: true },
    );
    res.json({ ok: true });
  });

  app.get("/api/profile", async (req: Authed, res) => {
    const profile = await store.profiles.findOne({ userId: uid(req) });
    res.json({ fields: profile?.fields ?? {} });
  });

  /** Development affordance. Stripe replaces this with a webhook. */
  app.post("/api/dev/topup", async (req: Authed, res) => {
    if (process.env.NODE_ENV === "production") return res.status(404).json({ error: "not_found" });
    res.json({ balance: await topUp(store, uid(req), Number(req.body?.credits ?? 100)) });
  });

  // Express 5 forwards rejected promises here, so async handlers need no try/catch.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof InsufficientCredits) {
      return res.status(402).json({ error: "insufficient_credits", balance: err.balance });
    }
    // A provider that timed out or could not be reached is not an internal error,
    // and reporting it as one sent people looking in the wrong place. 504 with the
    // reason says whose problem it is and that retrying is reasonable.
    if (isTransient(err)) {
      console.error(`upstream: ${err.message}`);
      return res.status(504).json({
        error: "upstream_unavailable",
        message: "the model provider timed out or could not be reached — try again",
        detail: err.message.slice(0, 200),
      });
    }
    if (err instanceof JevError && err.status && err.status < 500) {
      console.error(`bad request to provider: ${err.message}`);
      return res.status(502).json({ error: "provider_rejected", message: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "internal", message: err.message });
  });

  return app;
}
