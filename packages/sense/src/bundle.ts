/**
 * Node-side helper that bundles the collector into a standalone IIFE string.
 *
 * Why this exists: `page.evaluate(collectSnapshot)` serializes the function with
 * `.toString()`, but tsx/esbuild transpile with `keepNames`, which wraps every
 * function in a `__name(...)` helper that does not exist inside the page. The same
 * would happen to any bundler-processed content script. So we bundle explicitly,
 * with keepNames off, and hand the page a self-contained script.
 *
 * This is the only file in the package that touches Node — the browser code it emits
 * still has zero dependencies. The extension build will reuse it verbatim.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export const GLOBAL_NAME = "__jevCollect";

let cached: string | undefined;

export async function collectorSource(): Promise<string> {
  if (cached) return cached;

  const entry = join(dirname(fileURLToPath(import.meta.url)), "collect.ts");
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__jevSense",
    platform: "browser",
    target: "chrome120",
    keepNames: false,
    minify: false,
    footer: { js: `globalThis.${GLOBAL_NAME} = __jevSense.collectSnapshot;` },
  });

  const out = result.outputFiles?.[0]?.text;
  if (!out) throw new Error("collector bundle produced no output");
  cached = out;
  return out;
}

/** Expression a page can evaluate once the source above has been installed. */
export function collectorCall(maxCandidates = 2000): string {
  return `globalThis.${GLOBAL_NAME}(${maxCandidates})`;
}
