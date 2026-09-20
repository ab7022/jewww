import { call, collectorSource } from "@jev-browser/sense/bundle";
import { stillFresh } from "@jev-browser/sense";
import {
  type Action,
  type Executor,
  type Guard,
  type RawSnapshot,
  StalePage,
  UnreachableTarget,
} from "@jev-browser/shared";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";

export interface CdpOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  /** Attach to an already-running Chrome instead of launching one. */
  cdpUrl?: string;
  maxCandidates?: number;
}

/**
 * Playwright/CDP executor.
 *
 * The ordering in `act` is the whole point of this class and is not negotiable:
 *
 *   1. verify the guard BEFORE anything mutates — the caller may have spent seconds
 *      generating text since the decision was made;
 *   2. resolve geometry and hit-test at the last possible moment, because an element
 *      can be present, enabled, visible and completely covered;
 *   3. never retry a mutation. A click that may have landed must not land twice.
 */
export class CdpExecutor implements Executor {
  private constructor(
    private readonly browser: Browser | null,
    private readonly page: Page,
    private readonly maxCandidates: number,
    private source: string,
  ) {}

  static async launch(url: string, opts: CdpOptions = {}): Promise<CdpExecutor> {
    const browser = opts.cdpUrl
      ? await chromium.connectOverCDP(opts.cdpUrl)
      : await chromium.launch({ headless: opts.headless ?? true });

    const context = opts.cdpUrl
      ? (browser.contexts()[0] ?? (await browser.newContext()))
      : await browser.newContext({
          viewport: opts.viewport ?? { width: 1280, height: 900 },
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    return new CdpExecutor(
      opts.cdpUrl ? null : browser,
      page,
      opts.maxCandidates ?? 2000,
      await collectorSource(),
    );
  }

  url(): string {
    return this.page.url();
  }

  async snapshot(): Promise<RawSnapshot> {
    for (let attempt = 0; ; attempt++) {
      try {
        // Re-injected every time: a navigation wipes the page's globals, and the
        // collector's node registry must belong to the document we are reading.
        await this.page.evaluate(this.source);
        return (await this.page.evaluate(call.snapshot(this.maxCandidates))) as RawSnapshot;
      } catch (err) {
        if (attempt >= 3) throw new StalePage(`could not observe the page: ${String(err).slice(0, 120)}`);
        await this.page.waitForLoadState("domcontentloaded").catch(() => {});
        await this.page.waitForTimeout(250);
      }
    }
  }

  async pageText(maxChars = 40_000): Promise<string> {
    const text = (await this.evalOrNull(
      `(() => {
         const main = document.querySelector('main,article,[role=main]') || document.body;
         return (main.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, ${maxChars});
       })()`,
    )) as string | null;
    return text ?? "";
  }

  async guardFor(node: number | null): Promise<Guard> {
    const pageKey = (await this.evalOrNull(call.pageKey())) as string | null;
    const nodeGuard = node === null ? null : ((await this.evalOrNull(call.nodeGuard(node))) as string | null);
    return { pageKey, nodeGuard };
  }

  async act(action: Action, node: number | null, guard: Guard, text?: string): Promise<void> {
    if (action.kind === "navigate") {
      await this.page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      return;
    }
    if (action.kind === "wait") {
      await this.page.waitForTimeout(action.ms);
      return;
    }
    if (action.kind === "scroll") {
      const amount = action.amount ?? 560;
      await this.page.mouse.wheel(0, action.dir === "down" ? amount : -amount);
      return;
    }
    if (action.kind === "done" || action.kind === "blocked") return;

    if (node === null) throw new UnreachableTarget(`${action.kind} without a node`);

    // 1. Freshness, immediately before input — not when the decision was made.
    const now = await this.guardFor(node);
    if (!stillFresh(guard, now)) {
      throw new StalePage("page changed since the decision; observe again");
    }

    // 2. Resolve geometry and hit-test at the last moment. For `select` this also
    //    performs the mutation, because a native select cannot be driven by a click.
    const kind = action.kind === "type" ? "fill" : action.kind === "select" ? "select" : "click";
    const option = action.kind === "select" ? action.option : undefined;
    const raw = (await this.evalOrNull(call.resolvePoint(node, kind, option))) as string | null;
    const point = raw && raw !== "null" ? (JSON.parse(raw) as { x: number; y: number }) : null;
    if (!point) {
      throw new UnreachableTarget("target is gone, disabled, off-screen, or covered");
    }
    if (kind === "select") return;

    const { x, y } = point;

    // 3. Execute. No retries past this line.
    await this.page.mouse.click(x, y);
    if (action.kind === "type") {
      if (text === undefined) throw new Error("type action reached the executor with no text");
      // Replace rather than append: the field may already hold a previous attempt.
      await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
      await this.page.keyboard.insertText(text);
      if (action.submit) await this.page.keyboard.press("Enter");
    }
  }

  async settle(node: number | null, isCombobox: boolean): Promise<void> {
    try {
      await this.page.evaluate(call.settle(node, isCombobox));
    } catch {
      // A navigation during settle is normal and not an error — the next snapshot
      // will observe wherever we landed.
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }

  private async evalOrNull(expression: string): Promise<unknown> {
    try {
      return await this.page.evaluate(expression);
    } catch {
      return null;
    }
  }
}
