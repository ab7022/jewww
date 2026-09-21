import type { AppConfig } from "./app.js";
import { dodoFromEnv } from "./billing.js";

/**
 * The server's configuration, read from the environment ONCE, for every way it runs —
 * the long-lived local server and the Vercel function alike. Each reading its own env
 * is how one of them ends up accepting any extension, or starting without a secret.
 *
 * Refuses to produce a configuration that would be unsafe in production.
 */
export interface ServerEnv {
  app: Omit<AppConfig, "store" | "webDir">;
  mongoUri: string;
  mongoDb: string;
  port: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const port = Number(env.PORT ?? 8787);
  const production = env.NODE_ENV === "production" || env.VERCEL_ENV === "production";

  const openrouterKey = env.OPENROUTER_API_KEY;
  if (!openrouterKey) throw new Error("OPENROUTER_API_KEY is not set");
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) throw new Error("JWT_SECRET is not set (any long random string)");
  if (production && jwtSecret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters in production");

  const extensionIds = (env.EXTENSION_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // A production server that accepts any extension would hand sign-in tokens to any
  // extension that asks. Refuse to start rather than run that way.
  if (production && !extensionIds.length) {
    throw new Error("EXTENSION_IDS must list the published extension id(s) in production");
  }

  // On Vercel the site and the API share one origin: the deployment's own URL.
  const appUrl =
    env.APP_URL ?? (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : `http://localhost:${port}`);

  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: env.GOOGLE_REDIRECT_URI ?? `${appUrl}/auth/google/callback`,
        }
      : undefined;
  if (production && !google) {
    // Development sign-in is refused in production, so without Google nobody could.
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required in production");
  }

  const mongoUri = env.MONGO_URI ?? (production ? "" : "mongodb://127.0.0.1:27017");
  if (!mongoUri) throw new Error("MONGO_URI is not set");

  const dodo = dodoFromEnv(env);
  if (production && dodo?.mode === "test") console.warn("payments are in TEST mode on a production server");

  return {
    app: {
      jwtSecret,
      openrouterKey,
      ...(google ? { google } : {}),
      appUrl,
      extensionIds,
      production,
      ...(dodo ? { dodo } : {}),
    },
    mongoUri,
    mongoDb: env.MONGO_DB ?? "jevbrowser",
    port,
  };
}
