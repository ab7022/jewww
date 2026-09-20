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
        // A navigation tears down the content script; it is re-injected on the new
        // document a moment later.
        if (attempt >= 3) throw new StalePage(`tab unreachable: ${String(err).slice(0, 80)}`);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
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

  async guardFor(node: number | null): Promise<Guard> {
    const res = await this.send({ kind: "guard", node });
    if (!("guard" in res) || !res.ok) return { pageKey: null, nodeGuard: null };
    return res.guard;
  }

  async act(action: Action, node: number | null, guard: Guard, text?: string): Promise<void> {
    const res = await this.send({
      kind: "act",
      action,
      node,
      guard,
      ...(text !== undefined ? { text } : {}),
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

/** Ask for access to one origin, at the moment a run actually needs it. */
export async function ensureHostPermission(url: string): Promise<boolean> {
  const origin = `${new URL(url).origin}/*`;
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  return chrome.permissions.request({ origins: [origin] });
}
