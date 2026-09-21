import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";
import { createApp } from "./app.js";
import { configFromEnv } from "./config.js";
import { connect } from "./db.js";

/**
 * The API as a Vercel function. The static site is served by Vercel itself; every
 * /api, /auth, /webhooks and /health request lands here.
 *
 * The app and its database connection are built on the first request and kept for as
 * long as the instance lives, so a warm function does not reconnect to Mongo per call.
 * A failed start is not cached: the next request tries again.
 */
let ready: Promise<Express> | undefined;

function app(): Promise<Express> {
  ready ??= (async () => {
    const env = configFromEnv();
    const store = await connect(env.mongoUri, env.mongoDb);
    return createApp({ ...env.app, store });
  })().catch((err: unknown) => {
    ready = undefined;
    throw err;
  });
  return ready;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    (await app())(req, res);
  } catch (err) {
    console.error("server failed to start:", err);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "unavailable", message: "the server is not configured correctly" }));
  }
}
