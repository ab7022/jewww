/**
 * Node-side helper that bundles the browser surface into one standalone IIFE.
 *
 * Why this exists: a CDP driver cannot pass functions into the page —
 * `page.evaluate(fn)` serializes with `.toString()`, and tsx/esbuild transpile with
 * `keepNames`, which wraps every function in a `__name(...)` helper that does not
 * exist there. So we bundle explicitly, with keepNames off, and hand the page a
 * self-contained script exposing the same functions a content script imports.
 *
 * The only file in this package that touches Node. What it emits still has zero deps.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const GLOBAL_NAME = "__jevSense";

let cached: string | undefined;

export async function collectorSource(): Promise<string> {
  if (cached) return cached;
  const entry = join(dirname(fileURLToPath(import.meta.url)), "browser.ts");
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    globalName: GLOBAL_NAME,
    platform: "browser",
    target: "chrome120",
    keepNames: false,
    minify: false,
    // esbuild's IIFE binds `var __jevSense`, and an evaluated string is wrapped in a
    // function scope by both Playwright and CDP — so the binding never reaches the
    // global object unless we put it there.
    footer: { js: `globalThis.${GLOBAL_NAME} = ${GLOBAL_NAME};` },
  });
  const out = result.outputFiles?.[0]?.text;
  if (!out) throw new Error("browser bundle produced no output");
  cached = out;
  return out;
}

/** Expressions the page can evaluate once the bundle above is installed. */
export const call = {
  snapshot: (maxCandidates = 2000) => `${GLOBAL_NAME}.snapshot(${maxCandidates})`,
  pageKey: () => `${GLOBAL_NAME}.pageKey()`,
  pageText: (maxChars = 40_000) => `${GLOBAL_NAME}.pageText(${maxChars})`,
  nodeGuard: (node: number, fp?: string) =>
    `${GLOBAL_NAME}.nodeGuard(${node}, ${JSON.stringify(fp ?? null)})`,
  resolvePoint: (node: number, kind: string, value?: string, fp?: string) =>
    `JSON.stringify(${GLOBAL_NAME}.resolvePoint(${node}, ${JSON.stringify(kind)}, ${JSON.stringify(value ?? null)}, ${JSON.stringify(fp ?? null)}))`,
  settle: (node: number | null, isCombobox: boolean) =>
    `${GLOBAL_NAME}.settle(${node === null ? "null" : node}, ${isCombobox})`,
};

/** @deprecated use `call.snapshot` */
export const collectorCall = call.snapshot;
