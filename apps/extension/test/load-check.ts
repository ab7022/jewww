/// <reference types="chrome" />
/**
 * Loads the BUILT extension into a real Chrome and checks the parts that only exist
 * at runtime: that the content script is injected, that it answers the worker's
 * messages, and that the collector sees the real page.
 *
 * Unit tests cannot cover any of this — there is no DOM, no message bus and no
 * service worker in vitest.
 *
 *   pnpm --filter @jev-browser/extension build && pnpm check:extension
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
if (!existsSync(join(dist, "manifest.json"))) {
  throw new Error("build the extension first: pnpm --filter @jev-browser/extension build");
}

const results: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail?: string) =>
  results.push({ name, pass, ...(detail ? { detail } : {}) });

const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8")) as {
  host_permissions?: string[];
  permissions?: string[];
  optional_permissions?: string[];
};

// The single most important property of the shipped manifest.
check(
  "host_permissions is EMPTY at install",
  !manifest.host_permissions || manifest.host_permissions.length === 0,
  JSON.stringify(manifest.host_permissions),
);
check(
  "debugger is optional, not granted up front",
  !manifest.permissions?.includes("debugger") &&
    Boolean(manifest.optional_permissions?.includes("debugger")),
);

const profile = mkdtempSync(join(tmpdir(), "jev-ext-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});

try {
  // The service worker registering at all is the thing MV3 most often gets wrong.
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  check("service worker registered", Boolean(extensionId), extensionId);

  const page = await context.newPage();
  await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // Drive the content script exactly as the worker does.
  const snapshot = (await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://example.com/*" });
    if (!tab?.id) return { error: "no tab" };
    return chrome.tabs.sendMessage(tab.id, { kind: "snapshot" });
  })) as { ok?: boolean; snapshot?: { elements: unknown[]; url: string }; error?: string };

  check(
    "content script answers a snapshot request",
    Boolean(snapshot?.ok && snapshot.snapshot),
    snapshot?.error ?? "",
  );
  check(
    "collector sees real elements with node ids",
    Boolean(snapshot?.snapshot?.elements?.length),
    `${snapshot?.snapshot?.elements?.length ?? 0} elements`,
  );

  const guard = (await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://example.com/*" });
    if (!tab?.id) return { error: "no tab" };
    return chrome.tabs.sendMessage(tab.id, { kind: "guard", node: 1 });
  })) as { ok?: boolean; guard?: { pageKey: string | null } };
  check("guards run in the content script", Boolean(guard?.ok && guard.guard?.pageKey));

  // The case that broke in real use: a tab open before the extension existed has no
  // content script, and the only clue is "Receiving end does not exist". The worker
  // injects on demand, so the manifest's files must actually be injectable — CRXJS
  // ships a loader that imports the real module, which is easy to get wrong.
  const injected = (await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://example.com/*" });
    if (!tab?.id) return { error: "no tab" };
    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
      await new Promise((r) => setTimeout(r, 400));
      const reply = await chrome.tabs.sendMessage(tab.id, { kind: "guard", node: null });
      return { ok: true, reply };
    } catch (err) {
      return { error: String(err) };
    }
  })) as { ok?: boolean; error?: string };
  // Without a host grant this MUST fail, and must fail legibly. The permission is
  // requested from the side panel during the click; here there is no gesture and no
  // grant, so the assertion is that the reason is stated rather than surfacing later
  // as an unexplained "Receiving end does not exist".
  const namesThePermission = /permission to access this host/i.test(injected?.error ?? "");
  check(
    "on-demand injection fails legibly without a host grant",
    Boolean(injected?.ok) || namesThePermission,
    injected?.error?.slice(0, 80) ?? "",
  );

  const text = (await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://example.com/*" });
    if (!tab?.id) return { error: "no tab" };
    return chrome.tabs.sendMessage(tab.id, { kind: "pageText" });
  })) as { ok?: boolean; text?: string };
  check(
    "bulk page text is available for extraction",
    Boolean(text?.ok && (text.text?.length ?? 0) > 20),
    `${text?.text?.length ?? 0} chars`,
  );
  // X, Slack, Gmail and Notion all compose into a contenteditable, which has no
  // `value` property — calling an input's native setter on one throws "Illegal
  // invocation", which is exactly what killed a real tweet-composing run.
  await page.evaluate(`
    document.body.innerHTML =
      '<div id="c" contenteditable="true" role="textbox" aria-label="Post text"></div>';
  `);
  await page.waitForTimeout(300);

  const typed = (await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://example.com/*" });
    if (!tab?.id) return { error: "no tab" };
    const snap = (await chrome.tabs.sendMessage(tab.id, { kind: "snapshot" })) as {
      ok?: boolean;
      snapshot?: { elements: { eid: string; node: number; name: string; fp: string }[] };
    };
    const box = snap.snapshot?.elements.find((e) => e.name === "Post text");
    if (!box) return { error: "collector missed the contenteditable" };
    const guard = (await chrome.tabs.sendMessage(tab.id, { kind: "guard", node: box.node, fp: box.fp })) as {
      guard: unknown;
    };
    return chrome.tabs.sendMessage(tab.id, {
      kind: "act",
      action: { kind: "type", eid: box.eid, text: "hello from the agent" },
      node: box.node,
      fp: box.fp,
      guard: guard.guard,
      text: "hello from the agent",
    });
  })) as { ok?: boolean; error?: string };

  const landed = await page.evaluate(`document.getElementById('c')?.textContent ?? ''`);
  check(
    "types into a contenteditable composer",
    Boolean(typed?.ok) && landed === "hello from the agent",
    typed?.error ?? `got "${landed}"`,
  );
} finally {
  await context.close();
}

// Copy shown to a person must not be a log line. These are the exact strings the
// runtime emits, and the panel is the only place they are worded for a human.
for (const [raw, expected] of [
  ["a: covered by div#bottomSheet-model-close", "Something was covering it"],
  ["a: filled 9/20, left blank: Resume, Why us", "Filled 9 of 20 fields"],
  ["-> $.details (18204 chars from /pull/1842)", "Read 18,204 characters"],
  ["a: page unchanged for 3 steps, giving up", "Nothing changed after a few tries"],
  ["navigated to https://in.bookmyshow.com/explore", "Opened in.bookmyshow.com"],
] as const) {
  const { humanize } = await import("../src/shared/timeline.js");
  check(`phrases: ${expected}`, humanize(raw).text.startsWith(expected), humanize(raw).text);
}

for (const r of results) {
  console.log(`  ${r.pass ? "ok  " : "FAIL"} ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} extension checks passed`);
process.exitCode = failed.length ? 1 : 0;
