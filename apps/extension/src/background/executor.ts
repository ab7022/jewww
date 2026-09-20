import {
  type Action,
  type Executor,
  type Guard,
  type RawSnapshot,
  StalePage,
  UnreachableTarget,
} from "@jev-browser/shared";
import type { FromContent, ToContent } from "../shared/messages.js";

/**
 * The worker-side half of the executor. Same `Executor` interface the CDP driver
 * implements, so `runPlan` cannot tell the difference — which is what made this a
 * one-file swap rather than a rewrite.
 */
export class TabExecutor implements Executor {
  constructor(private readonly tabId: number) {}

  private async send(msg: ToContent): Promise<FromContent> {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await chrome.tabs.sendMessage(this.tabId, msg)) as FromContent;
      } catch (err) {
        if (attempt >= 3) throw new StalePage(`tab unreachable: ${String(err).slice(0, 80)}`);
        // Two reasons the tab does not answer, and injecting fixes both: a tab that
        // was already open when the extension loaded never got the content script at
        // all, and a navigation tears down the one that was there. Requiring the user
        // to reload every tab they already had open is not a real answer.
        await this.inject();
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  /** Inject the content script, using the paths the built manifest declares. */
  private async inject(): Promise<void> {
    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
    if (!files.length) return;
    await chrome.scripting
      .executeScript({ target: { tabId: this.tabId }, files })
      .catch(() => {});
  }

  async snapshot(): Promise<RawSnapshot> {
    const res = await this.send({ kind: "snapshot" });
    if (!("snapshot" in res) || !res.ok) throw new StalePage("could not observe the page");
    return res.snapshot;
  }

  async pageText(maxChars = 40_000): Promise<string> {
    const res = await this.send({ kind: "pageText", maxChars });
    return "text" in res && res.ok ? res.text : "";
  }

  async guardFor(node: number | null, fp?: string): Promise<Guard> {
    const res = await this.send({ kind: "guard", node, ...(fp ? { fp } : {}) });
    if (!("guard" in res) || !res.ok) return { pageKey: null, nodeGuard: null };
    return res.guard;
  }

  async act(
    action: Action,
    node: number | null,
    guard: Guard,
    text?: string,
    fp?: string,
  ): Promise<void> {
    const res = await this.send({
      kind: "act",
      action,
      node,
      guard,
      ...(text !== undefined ? { text } : {}),
      ...(fp ? { fp } : {}),
    });
    if (res.ok) return;
    if (res.stale) throw new StalePage(res.error);
    if (res.unreachable) throw new UnreachableTarget(res.error);
    throw new Error(res.error);
  }

  async settle(node: number | null, isCombobox: boolean): Promise<void> {
    await this.send({ kind: "settle", node, isCombobox }).catch(() => undefined);
  }

  url(): string {
    return "";
  }

  async close(): Promise<void> {
    // The tab belongs to the user, not to us.
  }
}

/**
 * Verify access to one origin. Only ever CHECKS — the prompt belongs in the side
 * panel's click handler, because chrome.permissions.request needs a user gesture and
 * a service worker resuming after an await does not have one.
 */
export async function hasHostPermission(url: string): Promise<boolean> {
  return chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] });
}
