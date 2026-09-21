import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { connect } from "./db.js";

const port = Number(process.env.PORT ?? 8787);
const production = process.env.NODE_ENV === "production";

const openrouterKey = process.env.OPENROUTER_API_KEY;
if (!openrouterKey) throw new Error("OPENROUTER_API_KEY is not set");
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error("JWT_SECRET is not set (any long random string)");
if (production && jwtSecret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters in production");

const extensionIds = (process.env.EXTENSION_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// A production server that accepts any extension would hand sign-in tokens to any
// extension that asks. Refuse to start rather than run that way.
if (production && !extensionIds.length) {
  throw new Error("EXTENSION_IDS must list the published extension id(s) in production");
}

const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI ?? `http://localhost:${port}/auth/google/callback`,
      }
    : undefined;

// The website is served from here when it has been built.
const webDir = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");

const store = await connect(
  process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017",
  process.env.MONGO_DB ?? "jevbrowser",
);

createApp({
  store,
  jwtSecret,
  openrouterKey,
  ...(google ? { google } : {}),
  appUrl: process.env.APP_URL ?? `http://localhost:${port}`,
  extensionIds,
  production,
  ...(existsSync(join(webDir, "index.html")) ? { webDir } : {}),
}).listen(port, () => {
  console.log(`server on http://localhost:${port}`);
  console.log(
    google
      ? `google sign-in: http://localhost:${port}/auth/google/start`
      : "google sign-in NOT configured — dev sign-in is available (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for real sign-in)",
  );
  if (existsSync(join(webDir, "index.html"))) console.log(`website: http://localhost:${port}/`);
});
