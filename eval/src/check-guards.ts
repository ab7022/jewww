/**
 * Browser check for the freshness guards and the occlusion test. No model calls.
 *
 * These cannot be unit-tested meaningfully: happy-dom has no layout, so
 * `elementFromPoint` and `checkVisibility` are meaningless there. Without this they
 * would ship unverified — and the occlusion test in particular is what stops the
 * agent clicking a cookie banner that is sitting on top of the button it meant.
 *
 *   pnpm exec tsx eval/src/check-guards.ts
 */
import { call, collectorSource } from "@jev-browser/sense/bundle";
import type { RawSnapshot } from "@jev-browser/shared";
import { chromium } from "playwright";

const PAGE = `<!doctype html><html><body style="margin:0">
  <form>
    <label for="q">Search</label><input id="q" value="start">
    <button id="go" style="position:absolute;top:100px;left:10px;width:120px;height:40px">Submit order</button>
  </form>
  <button id="plain" style="position:absolute;top:200px;left:10px;width:120px;height:40px">Plain</button>
  <div id="veil" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9"></div>
  <div style="height:3000px"></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.setContent(PAGE);
await page.evaluate(await collectorSource());
const snap = (await page.evaluate(call.snapshot(500))) as RawSnapshot;

const byName = (n: string) => snap.elements.find((e) => e.name.includes(n));
const go = byName("Submit order");
const search = byName("Search");
if (!go || !search) throw new Error(`collector missed a control: ${snap.elements.map((e) => e.name).join(", ")}`);

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail?: string) =>
  results.push({ name, pass, ...(detail ? { detail } : {}) });

const pageKey = () => page.evaluate(call.pageKey()) as Promise<string | null>;
const guard = (node: number) => page.evaluate(call.nodeGuard(node)) as Promise<string | null>;
const resolve = async (node: number, kind: "click" | "fill") => {
  const raw = (await page.evaluate(call.resolvePoint(node, kind))) as string;
  const r = JSON.parse(raw) as { x: number } | { refused: string };
  return "refused" in r ? null : raw;
};

// 1. Scrolling is not a semantic change. If it invalidated decisions, every page
//    with a sticky header would re-decide forever.
const before = await pageKey();
await page.evaluate("window.scrollTo(0, 400)");
check("pageKey survives a scroll", (await pageKey()) === before);

// 2. A changed form value IS semantic — a decision made before it must not stand.
await page.fill("#q", "changed");
check("pageKey changes when a form value changes", (await pageKey()) !== before);

// 3. The element guard tracks the element's own meaning.
const g0 = await guard(go.node);
check("nodeGuard is stable when nothing about the element changed", (await guard(go.node)) === g0);

await page.evaluate("document.getElementById('go').disabled = true");
check("nodeGuard changes when the target becomes disabled", (await guard(go.node)) !== g0);
await page.evaluate("document.getElementById('go').disabled = false");

await page.evaluate("document.getElementById('go').textContent = 'Submit something else'");
check("nodeGuard changes when the target's label changes", (await guard(go.node)) !== g0);

// 4. A removed element has no guard at all, so a stale decision cannot execute.
const plain = byName("Plain");
if (plain) {
  await page.evaluate("document.getElementById('plain').remove()");
  check("nodeGuard is null once the element leaves the document", (await guard(plain.node)) === null);
}

// 5. Occlusion. The control is present, enabled and visible — and covered.
await page.evaluate("window.scrollTo(0, 0)");
check("resolve returns a point for an uncovered control", (await resolve(go.node, "click")) !== null);
await page.evaluate("document.getElementById('veil').style.display = 'block'");
check("resolve REFUSES a control covered by an overlay", (await resolve(go.node, "click")) === null);
await page.evaluate("document.getElementById('veil').style.display = 'none'");

// 6. A readonly field cannot be typed into.
await page.evaluate("document.getElementById('q').readOnly = true");
check("resolve refuses to type into a readonly field", (await resolve(search.node, "fill")) === null);

await browser.close();

for (const r of results) console.log(`  ${r.pass ? "ok  " : "FAIL"} ${r.name}`);
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} guard checks passed`);
process.exitCode = failed.length ? 1 : 0;
