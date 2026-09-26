/**
 * The zip the Chrome Web Store takes: the production build, minus the manifest `key`.
 *
 *   pnpm package:extension   → apps/extension/jev-extension.zip
 *
 * The key pins the id of the UNPACKED extension. The store refuses a manifest that
 * carries one and assigns its own id — which then has to be added to the server's
 * EXTENSION_IDS, or the published extension cannot sign in.
 */
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(here, ".store");
const zip = join(here, "jev-extension.zip");
rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
cpSync(join(here, "dist"), stage, { recursive: true });
const manifest = JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8"));
delete manifest.key;
writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));
execFileSync("zip", ["-qr", zip, "."], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log(`wrote ${zip} (version ${manifest.version})`);
