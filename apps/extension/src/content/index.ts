import {
  nodeGuard,
  pageKey,
  resolvePoint,
  settle,
  snapshot,
  stillFresh,
} from "@jev-browser/sense";
import { FORBIDDEN_FIELD } from "@jev-browser/shared";
import type { FromContent, GuardPair, ToContent } from "../shared/messages.js";

/**
 * The page-side half of the executor.
 *
 * Runs in the content script's isolated world, which is a real advantage: the node
 * registry the guards address lives somewhere page JavaScript cannot reach or tamper
 * with, while still pointing at the same DOM.
 */

function currentGuard(node: number | null, fp?: string): GuardPair {
  return { pageKey: pageKey(), nodeGuard: node === null ? null : nodeGuard(node, fp) };
}

/** Native setters, because React ignores a plain `.value =` assignment. */
function setNativeValue(el: HTMLElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function handle(msg: ToContent): Promise<FromContent> {
  switch (msg.kind) {
    case "snapshot":
      return { ok: true, snapshot: snapshot(msg.maxCandidates ?? 2000) };

    case "pageText": {
      const main = document.querySelector("main,article,[role=main]") ?? document.body;
      const text = ((main as HTMLElement).innerText ?? "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, msg.maxChars ?? 40_000);
      return { ok: true, text };
    }

    case "guard":
      return { ok: true, guard: currentGuard(msg.node, msg.fp) };

    case "settle":
      await settle(msg.node, msg.isCombobox);
      return { ok: true };

    case "act": {
      const { action, node, guard, text, fp } = msg;

      if (action.kind === "navigate") {
        location.assign(action.url);
        return { ok: true };
      }
      if (action.kind === "wait") {
        await new Promise((r) => setTimeout(r, action.ms));
        return { ok: true };
      }
      if (action.kind === "scroll") {
        window.scrollBy({ top: (action.amount ?? 560) * (action.dir === "down" ? 1 : -1) });
        return { ok: true };
      }
      if (action.kind === "done" || action.kind === "blocked") return { ok: true };
      if (node === null) return { ok: false, error: "no node for action", unreachable: true };

      // Freshness immediately before input — not when the decision was made, which
      // may have been seconds ago while a model wrote the text we are about to type.
      if (!stillFresh(guard, currentGuard(node, fp))) {
        return { ok: false, error: "page changed since the decision", stale: true };
      }

      const kind = action.kind === "type" ? "fill" : action.kind === "select" ? "select" : "click";
      const option = action.kind === "select" ? action.option : undefined;
      const point = resolvePoint(node, kind, option, fp);
      if ("refused" in point) return { ok: false, error: point.refused, unreachable: true };
      if (kind === "select") return { ok: true };

      const el = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
      const target = (el?.closest("a,button,input,select,textarea,[role],[onclick]") ??
        el) as HTMLElement | null;
      if (!target) return { ok: false, error: "nothing at the resolved point", unreachable: true };

      if (action.kind === "type") {
        // Last line of defence. The worker checks this too, but the check that
        // matters is the one closest to the keystroke.
        const label =
          target.getAttribute("aria-label") ?? target.getAttribute("name") ?? target.id ?? "";
        if (
          (target as HTMLInputElement).type === "password" ||
          FORBIDDEN_FIELD.test(label)
        ) {
          return { ok: false, error: `refused to type into a credential field: ${label}` };
        }
        target.focus();
        setNativeValue(target, text ?? "");
        if (action.submit) {
          target.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
          );
        }
        return { ok: true };
      }

      target.click();
      return { ok: true };
    }
  }
}

chrome.runtime.onMessage.addListener((msg: ToContent, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  return true; // keeps the channel open for the async reply
});
