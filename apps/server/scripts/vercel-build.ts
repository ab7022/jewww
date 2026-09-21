/**
 * Build the whole product for Vercel, in Vercel's Build Output format (v3):
 *
 *   .vercel/output/static/            the website (apps/web/dist)
 *   .vercel/output/functions/server.func/   the API, bundled into ONE file
 *   .vercel/output/config.json        routes: API paths to the function, the rest static
 *
 * Why bundle ourselves: the workspace packages export TypeScript source, which Vercel's
 * default function builder does not reliably compile when it arrives through
 * node_modules. One esbuild bundle has no such question — what runs is what was built,
 * and the same bundle can be run locally (`node` it behind http.createServer) first.
 *
 *   pnpm build:vercel
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const out = join(root, ".vercel/output");
const web = join(root, "apps/web/dist");
if (!existsSync(join(web, "index.html"))) throw new Error("build the website first: pnpm build:web");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "functions/server.func"), { recursive: true });
cpSync(web, join(out, "static"), { recursive: true });

await build({
  entryPoints: [join(root, "apps/server/src/vercel.ts")],
  outfile: join(out, "functions/server.func/index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "linked",
  // Express and parts of the Mongo driver are CommonJS and call require().
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  // The Mongo driver's optional integrations, loaded only when configured to be.
  external: [
    "kerberos",
    "@mongodb-js/zstd",
    "@aws-sdk/credential-providers",
    "gcp-metadata",
    "snappy",
    "socks",
    "aws4",
    "mongodb-client-encryption",
  ],
  logLevel: "warning",
});

writeFileSync(
  join(out, "functions/server.func/.vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      // Hand Express the untouched request: the webhook verifies a signature over the
      // raw body, which a pre-parsed body would destroy.
      shouldAddHelpers: false,
      // A planning call can take a while; the default would cut it off.
      maxDuration: 300,
    },
    null,
    2,
  ),
);

writeFileSync(
  join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/(?:api|auth|webhooks)(?:/.*)?$", dest: "/server" },
        { src: "^/health$", dest: "/server" },
        { handle: "filesystem" },
        // Client-side routes (/dashboard, /account, /signin) all load the one page.
        { src: "^/.*$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);

console.log("wrote .vercel/output (static site + server function)");
