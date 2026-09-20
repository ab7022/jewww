/**
 * Captures RawSnapshots from live pages, once, so every later benchmark run replays
 * saved JSON offline for pennies.
 *
 * The collector is injected by serializing `collectSnapshot` into the page — the
 * identical source an MV3 content script will run later. That is the point: this
 * harness is not a throwaway mock of the extension, it exercises the real thing.
 *
 *   pnpm eval:capture                # everything missing
 *   pnpm eval:capture gh-form hn     # named tasks
 *   pnpm eval:capture --all          # re-capture, overwriting
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectorCall, collectorSource } from "@jev-browser/sense/bundle";
import type { RawSnapshot } from "@jev-browser/shared";
import { chromium } from "playwright";
import { TASKS, type Task } from "./tasks.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURES = join(ROOT, "fixtures");

const args = process.argv.slice(2);
const force = args.includes("--all");
const named = args.filter((a) => !a.startsWith("--"));

const selected = named.length ? TASKS.filter((t) => named.includes(t.slug)) : TASKS;
const todo = force ? selected : selected.filter((t) => !existsSync(fixturePath(t.slug)));

/** Passed explicitly so the injected function has a concrete arg for Playwright. */
const MAX_CANDIDATES = 2000;

export function fixturePath(slug: string): string {
  return join(FIXTURES, `${slug}.json`);
}

async function capture(task: Task, browser: import("playwright").Browser): Promise<RawSnapshot> {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  try {
    await page.goto(task.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(task.settleMs ?? 800);

    for (const text of task.follow ?? []) {
      const link = page.getByRole("link", { name: new RegExp(text, "i") }).first();
      const button = page.getByRole("button", { name: new RegExp(text, "i") }).first();
      const target = (await link.count()) > 0 ? link : button;
      if ((await target.count()) === 0) throw new Error(`follow step "${text}" found nothing`);
      await target.click({ timeout: 10_000 });
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(task.settleMs ?? 1200);
    }

    // Install the bundled collector, then call it. Both evaluates are STRINGS, so
    // nothing passes through tsx's transpiler on the way into the page.
    const source = await collectorSource();
    for (let attempt = 0; ; attempt++) {
      try {
        await page.evaluate(source);
        return (await page.evaluate(collectorCall(MAX_CANDIDATES))) as RawSnapshot;
      } catch (err) {
        // SPAs routinely navigate during settle, destroying the execution context.
        // Let the navigation land and re-inject rather than losing the fixture.
        const destroyed = String(err).includes("Execution context was destroyed");
        if (!destroyed || attempt >= 2) throw err;
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.waitForTimeout(1500);
      }
    }
  } finally {
    await ctx.close();
  }
}

mkdirSync(FIXTURES, { recursive: true });

if (!todo.length) {
  console.log("nothing to capture (use --all to re-capture)");
  process.exit(0);
}

const browser = await chromium.launch();
const ok: string[] = [];
const failed: { slug: string; why: string }[] = [];

for (const task of todo) {
  process.stdout.write(`${task.slug.padEnd(18)} `);
  try {
    const snap = await capture(task, browser);
    writeFileSync(fixturePath(task.slug), JSON.stringify(snap, null, 2));
    console.log(
      `ok  ${String(snap.elements.length).padStart(4)} elements ` +
        `(${snap.totalCandidates} candidates)  ${snap.url.slice(0, 60)}`,
    );
    ok.push(task.slug);
  } catch (err) {
    const why = err instanceof Error ? err.message.split("\n")[0] ?? "?" : String(err);
    console.log(`FAIL  ${why.slice(0, 90)}`);
    failed.push({ slug: task.slug, why });
  }
}
await browser.close();

console.log(`\n${ok.length} captured, ${failed.length} failed`);
if (failed.length) {
  console.log("\nFailed tasks — swap the URL in eval/src/tasks.ts and re-run:");
  for (const f of failed) console.log(`  ${f.slug.padEnd(18)} ${f.why.slice(0, 80)}`);
}
