import { createApp } from "./app.js";
import { connect } from "./db.js";

const port = Number(process.env.PORT ?? 8787);
const store = await connect(
  process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017",
  process.env.MONGO_DB ?? "jevbrowser",
);

const openrouterKey = process.env.OPENROUTER_API_KEY;
if (!openrouterKey) throw new Error("OPENROUTER_API_KEY is not set");
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error("JWT_SECRET is not set (any long random string)");

const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri:
          process.env.GOOGLE_REDIRECT_URI ?? `http://localhost:${port}/auth/google/callback`,
      }
    : undefined;

createApp({
  store,
  jwtSecret,
  openrouterKey,
  ...(google ? { google } : {}),
  appUrl: process.env.APP_URL ?? `http://localhost:${port}/health`,
}).listen(port, () => {
  console.log(`server on http://localhost:${port}`);
  console.log(
    google
      ? `google sign-in: http://localhost:${port}/auth/google/start`
      : "google sign-in NOT configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
  );
});
