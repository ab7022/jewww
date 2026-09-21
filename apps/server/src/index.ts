import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { configFromEnv } from "./config.js";
import { connect } from "./db.js";

const env = configFromEnv();

// The website is served from here when it has been built.
const webDir = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
const hasWeb = existsSync(join(webDir, "index.html"));

const store = await connect(env.mongoUri, env.mongoDb);

createApp({ ...env.app, store, ...(hasWeb ? { webDir } : {}) }).listen(env.port, () => {
  const { port } = env;
  console.log(`server on http://localhost:${port}`);
  console.log(
    env.app.google
      ? `google sign-in: http://localhost:${port}/auth/google/start`
      : "google sign-in NOT configured — dev sign-in is available (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for real sign-in)",
  );
  if (hasWeb) console.log(`website: http://localhost:${port}/`);
  console.log(
    env.app.dodo
      ? `payments: Dodo (${env.app.dodo.mode} mode)`
      : "payments NOT configured — set DODO_API_KEY, DODO_WEBHOOK_SECRET and DODO_PRODUCT_{STARTER,PRO,TEAM}",
  );
});
