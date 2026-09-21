import { randomUUID } from "node:crypto";
import { fromEnv, isTransient, JevError } from "@jev-browser/jev";
import { extractDetails, makePlan } from "@jev-browser/planner";
import { readConstraints } from "@jev-browser/policy";
import { type EndpointName, type Endpoints, ROUTES } from "@jev-browser/protocol";
import { bindModels, type ModelCall } from "@jev-browser/runtime/models";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
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
import type { LedgerEntry, Run, Store } from "./db.js";

export interface AppConfig {
  store: Store;
  jwtSecret: string;
  /** Model keys live here and ONLY here — never in a client. */
  openrouterKey: string;
  google?: GoogleConfig;
  /**
   * The website's origin, e.g. https://jev.app. Sign-in may return here, and it is
   * allowed to make credentialed requests.
   */
  appUrl: string;
  /**
   * Chrome extension ids allowed to receive sign-in tokens. In production this MUST be
   * set; in development any unpacked extension is accepted, because its id depends on
   * the folder it was loaded from.
   */
  extensionIds?: string[];
  /** Serve the built website from here, when present. */
  webDir?: string;
  production?: boolean;
}

/** `userId` is set by requireAuth and is present on every /api handler. */
interface Authed extends Request {
  userId?: string;
}

const REFRESH_COOKIE = "jev_refresh";

export function createApp(cfg: AppConfig): Express {
  const app = express();
  const { store } = cfg;
  const production = cfg.production ?? process.env.NODE_ENV === "production";
  const appOrigin = new URL(cfg.appUrl).origin;

  // Built lazily so the app is constructible without a live model key — otherwise
  // every test of auth and billing would need one.
  let provider: ReturnType<typeof fromEnv> | undefined;
  const jev = () => (provider ??= fromEnv("openrouter"));

  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));

  /**
   * Who may call us from a browser.
   *
   * This used to reflect ANY origin. With bearer tokens that was survivable; with the
   * website's refresh cookie it would let any page ride a signed-in user's session.
   * Now only the website and our extension get CORS headers, and only they may send
   * credentials. Everything else is refused by the browser before it reads a byte.
   */
  const trustedOrigin = (origin: string | undefined): boolean => {
    if (!origin) return false;
    if (origin === appOrigin) return true;
    const ext = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
    if (ext) return !production || (cfg.extensionIds ?? []).includes(ext[1] as string);
    // Local development of the website on another port.
    return !production && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  };

  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (trustedOrigin(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Allow-Credentials", "true");
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
      res.set("Vary", "Origin");
    }
    if (req.method === "OPTIONS") return res.sendStatus(trustedOrigin(origin) ? 204 : 403);
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  /**
   * Nothing may hang a client forever. A handler that falls through without
   * responding once left the panel saying "working out how to do this" indefinitely.
   */
  app.use((req, res, next) => {
    const timer = setTimeout(() => {
      if (res.headersSent) return;
      console.error(`no response from ${req.method} ${req.path} after 180s`);
      res.status(504).json({ error: "no_response", message: "the server did not answer in time — try again" });
    }, 180_000);
    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));
    next();
  });

  // --- auth ---------------------------------------------------------------

  function allowDevAuth(): boolean {
    return !production && !cfg.google;
  }

  /**
   * Where a sign-in may deliver tokens.
   *
   * The target used to be whatever `?redirect=` said, signed into `state` by us — so
   * `/auth/google/start?redirect=https://attacker.example` handed a working session to
   * the attacker the moment the victim signed in with Google. Signing proves WE chose
   * the value; it says nothing about whether we should have. Only the website and our
   * own extension's identity redirect are allowed.
   */
  function allowedReturn(raw: string): URL | null {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (url.origin === appOrigin) return url;
    const ext = /^([a-p]{32})\.chromiumapp\.org$/.exec(url.hostname);
    if (url.protocol === "https:" && ext) {
      return !production || (cfg.extensionIds ?? []).includes(ext[1] as string) ? url : null;
    }
    return null;
  }

  function setRefreshCookie(res: Response, refresh: string): void {
    res.cookie(REFRESH_COOKIE, refresh, {
      httpOnly: true,
      secure: production,
      sameSite: "lax",
      path: "/auth",
      maxAge: 30 * 24 * 3600 * 1000,
    });
  }

  function refreshFromCookie(req: Request): string {
    const header = req.get("cookie") ?? "";
    for (const part of header.split(";")) {
      const [k, ...v] = part.trim().split("=");
      if (k === REFRESH_COOKIE) return decodeURIComponent(v.join("="));
    }
    return "";
  }

  /** Whether real sign-in is available, so a client can offer the right button. */
  app.get(ROUTES.authConfig.path, (_req, res) => {
    const body: Endpoints["authConfig"]["result"] = { google: Boolean(cfg.google), dev: allowDevAuth() };
    res.json(body);
  });

  /**
   * Development sign-in: the same tokens Google would issue, for exercising the product
   * before OAuth credentials exist. Refused in production AND whenever Google is
   * configured — a bypass that survives into a deployment is one someone will find.
   */
  app.post("/auth/dev", async (req, res) => {
    if (!allowDevAuth()) return res.status(404).json({ error: "not_found" });
    const email = String(req.body?.email ?? "dev@localhost").slice(0, 200);
    const user = await upsertGoogleUser(store, { sub: `dev_${email}`, email, name: "Dev User" });
    const refresh = await issueRefresh(store, user._id);
    const access = signJwt({ sub: user._id }, cfg.jwtSecret);
    // The website keeps its refresh token in an httpOnly cookie, out of reach of any
    // script on the page; the extension has no cookies and stores both.
    if (req.body?.client === "web") {
      setRefreshCookie(res, refresh);
      return res.json({ access, refresh: "", credits: user.credits });
    }
    res.json({ access, refresh, credits: user.credits });
  });

  app.get("/auth/google/start", (req, res) => {
    if (!cfg.google) return res.status(501).json({ error: "google_not_configured" });
    const target = allowedReturn(String(req.query.redirect ?? cfg.appUrl));
    if (!target) return res.status(400).json({ error: "redirect_not_allowed" });
    const state = signJwt({ r: target.toString() }, cfg.jwtSecret, 600);
    res.redirect(googleAuthUrl(cfg.google, state));
  });

  app.get("/auth/google/callback", async (req, res) => {
    if (!cfg.google) return res.status(501).json({ error: "google_not_configured" });
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");
    if (!code || !state) return res.status(400).json({ error: "missing_code_or_state" });

    const claims = verifyJwt(state, cfg.jwtSecret);
    // Checked again here, not only at /start: a state minted before an allow-list
    // change must not outlive it.
    const target = claims ? allowedReturn(String(claims.r ?? cfg.appUrl)) : null;
    if (!target) return res.status(400).json({ error: "bad_state" });

    const profile = await exchangeGoogleCode(cfg.google, code);
    const user = await upsertGoogleUser(store, profile);
    const refresh = await issueRefresh(store, user._id);
    const access = signJwt({ sub: user._id }, cfg.jwtSecret);

    // Tokens go in the fragment, which browsers never send to a server and which stays
    // out of access logs and Referer headers. The website gets only the short-lived
    // access token there; its refresh token is an httpOnly cookie.
    if (target.origin === appOrigin) {
      setRefreshCookie(res, refresh);
      target.hash = new URLSearchParams({ access }).toString();
    } else {
      target.hash = new URLSearchParams({ access, refresh }).toString();
    }
    res.redirect(target.toString());
  });

  app.post("/auth/refresh", async (req, res) => {
    const refresh = String(req.body?.refresh ?? "") || refreshFromCookie(req);
    if (!refresh) return res.status(400).json({ error: "missing_refresh" });
    const userId = await redeemRefresh(store, refresh);
    if (!userId) return res.status(401).json({ error: "invalid_refresh" });
    res.json({ access: signJwt({ sub: userId }, cfg.jwtSecret) });
  });

  app.post("/auth/logout", async (req, res) => {
    const refresh = String(req.body?.refresh ?? "") || refreshFromCookie(req);
    if (refresh) await revokeRefresh(store, refresh);
    res.clearCookie(REFRESH_COOKIE, { path: "/auth" });
    res.json({ ok: true });
  });

  // --- everything below needs a user --------------------------------------

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

  /**
   * Register a handler for a named endpoint of the protocol.
   *
   * The body is parsed with the endpoint's schema before the handler sees it, so an
   * unknown or missing field is a 400 naming the field — never a model call made with
   * `undefined` in it. The handler's argument and return types come from the same
   * table the clients are generated from.
   */
  function handle<K extends EndpointName>(
    name: K,
    fn: (
      req: Authed,
      body: Endpoints[K]["body"],
      params: Endpoints[K]["params"],
    ) => Promise<Endpoints[K]["result"]>,
  ): void {
    const route = ROUTES[name];
    const method = route.method.toLowerCase() as "get" | "post" | "put";
    app[method](route.path, async (req: Authed, res: Response) => {
      const body = (route.schema ? route.schema.parse(req.body) : undefined) as Endpoints[K]["body"];
      const result = await fn(req, body, req.params as Endpoints[K]["params"]);
      res.json(result);
    });
  }

  handle("me", async (req) => {
    const user = await store.users.findOne({ _id: uid(req) });
    if (!user) throw new HttpError(401, "unauthorized");
    return {
      id: user._id,
      email: user.email,
      ...(user.name ? { name: user.name } : {}),
      credits: user.credits,
      // 15 credits is the measured cost of a ~20-step task.
      approxTasks: Math.floor(user.credits / 15),
    };
  });

  handle("ledger", async (req) => {
    const entries = await store.ledger.find({ userId: uid(req) }).sort({ at: -1 }).limit(100).toArray();
    return {
      entries: entries.map((e) => ({
        kind: e.kind,
        credits: e.credits,
        ...(e.runId ? { runId: e.runId } : {}),
        at: e.at.toISOString(),
      })),
    };
  });

  // --- runs ---------------------------------------------------------------

  /** The user's standing instructions — trusted, loaded server-side, never sent by a client. */
  const standing = async (userId: string): Promise<string | undefined> => {
    const p = await store.profiles.findOne({ userId });
    return p?.instructions?.trim() || undefined;
  };

  /** Fails closed: a run that is not yours does not exist. */
  const ownRun = async (req: Authed, id: string): Promise<Run> => {
    const run = await store.runs.findOne({ _id: id, userId: uid(req) });
    if (!run) throw new HttpError(404, "no_such_run");
    return run;
  };

  const summarise = (run: Run) => ({
    id: run._id,
    goal: run.goal,
    startUrl: run.startUrl,
    status: run.status,
    creditsSpent: run.creditsSpent,
    steps: run.steps ?? 0,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  });

  handle("listRuns", async (req) => {
    const runs = await store.runs.find({ userId: uid(req) }).sort({ createdAt: -1 }).limit(50).toArray();
    return { runs: runs.map(summarise) };
  });

  handle("getRun", async (req, _body, params) => {
    const run = await ownRun(req, params.id);
    const steps = await store.steps.find({ runId: run._id }).sort({ at: 1 }).toArray();
    return { run: summarise(run), steps };
  });

  /**
   * Start a run: plan it, and work out everything the runtime needs that the server
   * knows better than a client — how much authority the user's words grant, and
   * which of their details to use.
   *
   * Autonomy used to be computed only by the CLI. The extension never set it, so every
   * extension run defaulted to "confirm" — "apply to 10 jobs" stopped for approval at
   * every single Easy Apply. The profile used to be fetched and merged by the client,
   * which broke the day its response shape changed.
   */
  handle("createRun", async (req, body) => {
    const { goal, url } = body;
    await assertBalance(store, uid(req), 5);
    const instructions = await standing(uid(req));

    const runId = randomUUID();
    const now = new Date();
    await store.runs.insertOne({
      _id: runId,
      userId: uid(req),
      goal,
      startUrl: url,
      status: "running",
      autonomy: "confirm",
      creditsSpent: 0,
      steps: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Standing instructions can set a default ("never submit without asking me");
    // the goal, being the more recent statement of intent, is read alongside them.
    const authorityText = instructions ? `${goal}\n\n(Standing instructions: ${instructions})` : goal;
    const [planned, constraints, saved] = await Promise.all([
      makePlan({ apiKey: cfg.openrouterKey, goal, start: url, jev: jev(), instructions }),
      readConstraints(jev(), authorityText),
      store.profiles.findOne({ userId: uid(req) }),
    ]);

    // Details stated in the request itself ("…with name John, email john@x.com"), only
    // when the plan actually fills a form.
    const fillsAForm = hasFill(planned.plan.nodes);
    const stated = fillsAForm
      ? await extractDetails({ apiKey: cfg.openrouterKey, goal }).catch(() => ({ fields: {}, costUsd: 0 }))
      : { fields: {} as Record<string, string>, costUsd: 0 };

    await store.runs.updateOne({ _id: runId }, { $set: { autonomy: constraints.autonomy } });
    const charge = await meter(
      store,
      uid(req),
      "plan",
      planned.costUsd + stated.costUsd + constraints.costUsd,
      runId,
    );

    return {
      runId,
      plan: planned.plan,
      autonomy: constraints.autonomy,
      // What was just typed is more specific than a saved default.
      profile: { ...(saved?.fields ?? {}), ...stated.fields },
      balance: charge.balance,
    };
  });

  /**
   * Capabilities for one request, bound to the run's OWN goal and the user's own
   * instructions — read from the database, never from the request body.
   */
  async function capabilitiesFor(req: Authed, run: Run) {
    let balance: number | undefined;
    const caps = bindModels({
      apiKey: cfg.openrouterKey,
      jev: jev(),
      goal: run.goal,
      instructions: await standing(uid(req)),
      onCost: async (kind: ModelCall, costUsd: number) => {
        const ledgerKind: LedgerEntry["kind"] = kind;
        balance = (await meter(store, uid(req), ledgerKind, costUsd, run._id)).balance;
      },
    });
    return { caps, balance: () => balance ?? 0 };
  }

  handle("decide", async (req, body, params) => {
    const run = await ownRun(req, params.id);
    await assertBalance(store, uid(req), 1);
    const { caps, balance } = await capabilitiesFor(req, run);
    const d = await caps.decide(body);

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
    return { decision: d, balance: balance() };
  });

  handle("text", async (req, body, params) => {
    const run = await ownRun(req, params.id);
    await assertBalance(store, uid(req), 1);
    const { caps, balance } = await capabilitiesFor(req, run);
    // `null` means the model declined rather than invent a value; the caller asks the
    // person instead. It is an answer, not an error.
    return { text: await caps.text(body), balance: balance() };
  });

  handle("fields", async (req, body, params) => {
    const run = await ownRun(req, params.id);
    await assertBalance(store, uid(req), 1);
    const { caps, balance } = await capabilitiesFor(req, run);
    const r = await caps.mapFields(body);
    return { mappings: r.mappings, costUsd: r.costUsd, balance: balance() };
  });

  handle("extract", async (req, body, params) => {
    const run = await ownRun(req, params.id);
    await assertBalance(store, uid(req), 1);
    const { caps, balance } = await capabilitiesFor(req, run);
    return { value: await caps.extract(body), balance: balance() };
  });

  handle("compose", async (req, body, params) => {
    const run = await ownRun(req, params.id);
    await assertBalance(store, uid(req), 1);
    const { caps, balance } = await capabilitiesFor(req, run);
    return { value: await caps.compose(body), balance: balance() };
  });

  handle("finish", async (req, body, params) => {
    const run = await ownRun(req, params.id);
    await store.runs.updateOne(
      { _id: run._id },
      {
        $set: {
          status: body.status,
          updatedAt: new Date(),
          ...(body.steps !== undefined ? { steps: body.steps } : {}),
          ...(body.summary !== undefined ? { summary: body.summary } : {}),
        },
      },
    );
    return { ok: true as const };
  });

  // --- profile ------------------------------------------------------------

  handle("getProfile", async (req) => {
    const profile = await store.profiles.findOne({ userId: uid(req) });
    return { fields: profile?.fields ?? {}, instructions: profile?.instructions ?? "" };
  });

  handle("putProfile", async (req, body) => {
    const set: { fields?: Record<string, string>; instructions?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    // Blank values are dropped rather than stored: a blank "phone" would otherwise be
    // offered to field mapping as a real answer.
    if (body.fields) {
      set.fields = Object.fromEntries(
        Object.entries(body.fields)
          .map(([k, v]) => [k, v.trim()] as const)
          .filter(([, v]) => v),
      );
    }
    if (body.instructions !== undefined) set.instructions = body.instructions.trim();
    await store.profiles.updateOne(
      { userId: uid(req) },
      {
        $set: set,
        $setOnInsert: { _id: randomUUID(), ...(set.fields ? {} : { fields: {} }) },
      },
      { upsert: true },
    );
    return { ok: true as const };
  });

  /** Development affordance. Stripe replaces this with a webhook. */
  app.post("/api/dev/topup", async (req: Authed, res) => {
    if (production) return res.status(404).json({ error: "not_found" });
    res.json({ balance: await topUp(store, uid(req), Math.min(10_000, Number(req.body?.credits ?? 100))) });
  });

  // --- website --------------------------------------------------------------

  if (cfg.webDir) {
    app.use(express.static(cfg.webDir, { index: false, maxAge: production ? "1h" : 0 }));
    // Client-side routes (/dashboard, /signin …) all load the same page.
    app.get(/^\/(?!api\/|auth\/).*/, (_req, res) => {
      res.sendFile("index.html", { root: cfg.webDir as string });
    });
  }

  // Express 5 forwards rejected promises here, so async handlers need no try/catch.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: "invalid_request",
        message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
        issues: err.issues,
      });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    if (err instanceof InsufficientCredits) {
      return res.status(402).json({ error: "insufficient_credits", balance: err.balance });
    }
    // A provider that timed out is not an internal error; 504 says whose problem it is
    // and that retrying is reasonable.
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
    res.status(500).json({ error: "internal", message: production ? "something went wrong" : err.message });
  });

  return app;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

/** Whether a plan contains a fill node anywhere, including inside a loop. */
function hasFill(nodes: { kind: string; do?: unknown }[]): boolean {
  return nodes.some(
    (n) => n.kind === "fill" || (Array.isArray(n.do) && hasFill(n.do as { kind: string; do?: unknown }[])),
  );
}
