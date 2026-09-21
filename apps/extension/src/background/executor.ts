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
  /**
   * Follow a tab the page opens.
   *
   * Countless controls are target="_blank" — Google Forms' "Blank form" among them —
   * and bound to a single tabId the extension kept driving the page it started on
   * while the real work opened somewhere it could not see. It then tried to make
   * progress on the old page, which looked like the model going off the rails.
   *
   * The CDP driver already did this; the extension did not, which is exactly the
   * kind of gap two implementations of one contract produce.
   */
  private watchForNewTabs(): void {
    this.onCreated = (tab) => {
      if (tab.openerTabId !== this.tabId || !tab.id) return;
      this.tabId = tab.id;
    };
    chrome.tabs.onCreated.addListener(this.onCreated);
  }

  private onCreated: ((tab: chrome.tabs.Tab) => void) | undefined;

  /** Stop following; the tab belongs to the user once the run ends. */
  detach(): void {
    if (this.onCreated) chrome.tabs.onCreated.removeListener(this.onCreated);
    this.onCreated = undefined;
  }

  constructor(private tabId: number) {
    this.watchForNewTabs();
  }

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

  /**
   * Make sure the tab can answer us.
   *
   * A declarative content script only runs on page load, so any tab that was already
   * open when the extension was installed has none — which is most of them, and the
   * failure reads as "Receiving end does not exist" with no hint that a reload would
   * fix it. Injecting on demand covers that and a navigation tearing the script down.
   */
  async ensureContentScript(): Promise<void> {
    const alive = await chrome.tabs
      .sendMessage(this.tabId, { kind: "guard", node: null })
      .then(() => true)
      .catch(() => false);
    if (alive) return;

    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
    if (!files.length) throw new Error("no content script in the manifest");
    try {
      await chrome.scripting.executeScript({ target: { tabId: this.tabId }, files });
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      // The manifest is read fresh, so a missing file means the build on disk moved
      // under a loaded extension: Vite re-hashes asset names, and Chrome keeps
      // serving the manifest it read at load time until someone reloads it.
      if (/could not load file/i.test(why)) {
        throw new Error(
          "the extension was rebuilt since Chrome loaded it — reload it at chrome://extensions, then try again",
        );
      }
      // Otherwise nearly always a missing host permission for this origin. Say so,
      // rather than letting it surface later as an unexplained connection error.
      throw new Error(`cannot run on this tab: ${why}`);
    }
    // The loader imports the real module, so the listener is not registered yet.
    await new Promise((r) => setTimeout(r, 300));
  }

  private async inject(): Promise<void> {
    const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
    if (!files.length) return;
    await chrome.scripting
      .executeScript({ target: { tabId: this.tabId }, files })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 250));
  }

  /** The tab being driven right now, which a click may have changed. */
  activeTab(): number {
    return this.tabId;
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

  /**
   * Asked of Chrome every time rather than cached. The cached copy was "" for a tab a
   * click had just opened, and the runtime — believing it was on the wrong site —
   * navigated away from the page the user was on.
   */
  async url(): Promise<string> {
    const tab = await chrome.tabs.get(this.tabId);
    return tab.pendingUrl ?? tab.url ?? "";
  }

  async point(node: number, message: string, fp?: string): Promise<string | null> {
    const res = await this.send({ kind: "point", node, message, ...(fp ? { fp } : {}) });
    if (!res.ok) return res.error;
    return "refusal" in res ? res.refusal : null;
  }

  /** Put the agent's cursor away; the run is over. Never fails a run. */
  async hideCursor(): Promise<void> {
    await chrome.tabs.sendMessage(this.tabId, { kind: "cursor", hide: true }).catch(() => {});
  }

  async preflight(action: Action, node: number | null, fp?: string): Promise<string | null> {
    const res = await this.send({ kind: "preflight", action, node, ...(fp ? { fp } : {}) });
    if (!res.ok) return res.error;
    return "refusal" in res ? res.refusal : null;
  }

  async close(): Promise<void> {
    // The tab belongs to the user, not to us — but stop listening for new ones.
    this.detach();
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
