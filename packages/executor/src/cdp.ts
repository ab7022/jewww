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
import type { Browser, BrowserContext, Page } from "playwright";
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
  private context: BrowserContext | null = null;
  /** Tabs open at the moment of the last action, to detect one the click opened. */
  private pagesBefore = 0;

  private constructor(
    private readonly browser: Browser | null,
    private page: Page,
    private readonly maxCandidates: number,
    private source: string,
  ) {}

  /**
   * Follow tabs the page opens.
   *
   * A great many "Apply", "Open", and "Continue" controls are `target="_blank"`.
   * Holding a single page meant the click worked, a new tab appeared, and the agent
   * kept observing the old one — reporting "the page did not change" and giving up,
   * over and over, on sites where it had actually succeeded.
   */
  private follow(context: BrowserContext): void {
    this.context = context;
    context.on("page", (opened) => {
      this.page = opened;
      opened.on("close", () => {
        const remaining = context.pages().filter((p) => !p.isClosed());
        const last = remaining[remaining.length - 1];
        if (last) this.page = last;
      });
    });
  }

  /**
   * Give a tab the click may have opened time to appear, and adopt it.
   *
   * Bounded and conditional: it polls only while no new tab has shown up, and gives
   * up quickly. Simply waiting a fixed 120ms — which was the first attempt — misses
   * the tab often enough that the agent reports "the page did not change" on sites
   * where the click had in fact worked.
   */
  private async adoptNewTab(maxWaitMs = 600): Promise<boolean> {
    if (!this.context) return false;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const open = this.context.pages().filter((p) => !p.isClosed());
      if (open.length > this.pagesBefore) {
        const last = open[open.length - 1];
        if (last) {
          this.page = last;
          await last.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
          return true;
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

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

    const executor = new CdpExecutor(
      opts.cdpUrl ? null : browser,
      page,
      opts.maxCandidates ?? 2000,
      await collectorSource(),
    );
    executor.follow(context);
    return executor;
  }

  async url(): Promise<string> {
    return this.page.url();
  }

  async point(node: number, message: string, fp?: string): Promise<string | null> {
    try {
      await this.page.evaluate(this.source);
      return (await this.page.evaluate(call.point(node, message, fp))) as string | null;
    } catch (err) {
      return `could not point at the target: ${String(err).slice(0, 100)}`;
    }
  }

  async preflight(action: Action, node: number | null, fp?: string): Promise<string | null> {
    if (node === null) return null;
    if (action.kind !== "click" && action.kind !== "type" && action.kind !== "select") return null;
    const kind = action.kind === "type" ? "fill" : action.kind === "select" ? "select" : "click";
    const option = action.kind === "select" ? action.option : undefined;
    try {
      await this.page.evaluate(this.source);
      return (await this.page.evaluate(call.preflight(node, kind, option, fp))) as string | null;
    } catch (err) {
      return `could not check the target: ${String(err).slice(0, 100)}`;
    }
  }

  /** Run arbitrary setup in the page. For tests and diagnostics only. */
  async inject(expression: string): Promise<void> {
    await this.page.evaluate(expression);
  }

  /** Evaluate and return a value. For diagnostics only. */
  async probe(expression: string): Promise<unknown> {
    return this.page.evaluate(expression);
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
    // Injected first: a navigation since the last snapshot would have wiped the
    // bundle, and extraction must not silently return an empty page.
    await this.page.evaluate(this.source).catch(() => {});
    return ((await this.evalOrNull(call.pageText(maxChars))) as string | null) ?? "";
  }

  async guardFor(node: number | null, fp?: string): Promise<Guard> {
    const pageKey = (await this.evalOrNull(call.pageKey())) as string | null;
    const nodeGuard =
      node === null ? null : ((await this.evalOrNull(call.nodeGuard(node, fp))) as string | null);
    return { pageKey, nodeGuard };
  }

  async act(
    action: Action,
    node: number | null,
    guard: Guard,
    text?: string,
    fp?: string,
  ): Promise<void> {
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

    if (action.kind === "attach") {
      if (node === null) throw new UnreachableTarget("attach without a node");
      if (!action.file) throw new UnreachableTarget("no file to attach");
      // A file input's value cannot be set from page JavaScript at all — the setter
      // is privileged. This is the one action that genuinely needs driver access.
      // Mark the exact element the model chose so we upload to that one, not merely
      // the first file input on the page.
      const marked = await this.page.evaluate(
        `(() => {
           const e = globalThis.__jevSenseCache?.nodes.get(${node});
           if (!e || e.tagName !== 'INPUT' || e.type !== 'file') return false;
           e.setAttribute('data-jev-upload', '1');
           return true;
         })()`,
      );
      if (!marked) throw new UnreachableTarget("chosen target is not a file input");

      // Where the upload widget sits, in absolute page coordinates, captured BEFORE
      // the upload. Sites replace the input with a filename display once a file is
      // chosen, which detaches the node — so scrolling to it afterwards silently
      // does nothing, and the next observation shows the top of the page with no
      // sign of the file that was just attached.
      const anchorY = (await this.page.evaluate(
        `(() => {
           const e = globalThis.__jevSenseCache?.nodes.get(${node});
           const box = e?.parentElement ?? e;
           if (!box) return null;
           return box.getBoundingClientRect().top + window.scrollY;
         })()`,
      )) as number | null;

      try {
        await this.page.setInputFiles("input[data-jev-upload]", action.file, { timeout: 10_000 });
        if (anchorY !== null) {
          await this.page
            .evaluate(
              `window.scrollTo({ top: Math.max(0, ${anchorY} - window.innerHeight / 2), behavior: "instant" })`,
            )
            .catch(() => {});
        }
      } finally {
        await this.page
          .evaluate(`document.querySelector('input[data-jev-upload]')?.removeAttribute('data-jev-upload')`)
          .catch(() => {});
      }
      return;
    }

    if (node === null) throw new UnreachableTarget(`${action.kind} without a node`);

    // 1. Freshness, immediately before input — not when the decision was made.
    const now = await this.guardFor(node, fp);
    if (!stillFresh(guard, now)) {
      throw new StalePage("page changed since the decision; observe again");
    }

    // 2. Resolve geometry and hit-test at the last moment. For `select` this also
    //    performs the mutation, because a native select cannot be driven by a click.
    const kind = action.kind === "type" ? "fill" : action.kind === "select" ? "select" : "click";
    const option = action.kind === "select" ? action.option : undefined;
    // `approach` glides the agent's cursor to the target and re-resolves on arrival:
    // the same browser-side code the extension runs, so both show it and both re-check.
    const raw = await this.page
      .evaluate(call.approach(node, kind, option, fp))
      .catch((err: unknown) => ({ evalError: String(err).slice(0, 120) }));
    if (typeof raw !== "string") {
      throw new StalePage(`could not resolve the target: ${JSON.stringify(raw)}`);
    }
    const resolution = JSON.parse(raw) as { x: number; y: number } | { refused: string };
    if ("refused" in resolution) throw new UnreachableTarget(resolution.refused);
    if (kind === "select") return;

    const { x, y } = resolution;

    // 3. Execute. No retries past this line.
    this.pagesBefore = this.context?.pages().filter((pg) => !pg.isClosed()).length ?? 0;
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
    // A click that opened a tab means the interesting page is the new one, and the
    // settle below belongs to it rather than to the page we left.
    if (await this.adoptNewTab()) return;
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
