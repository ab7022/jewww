import {
  approach,
  cursorHide,
  cursorListening,
  deepElementFromPoint,
  editableWithin,
  elementFor,
  isCredentialField,
  nodeGuard,
  pageKey,
  pageText,
  point,
  annotate,
  preflight,
  settle,
  snapshot,
  stillFresh,
} from "@jev-browser/sense";
import type { FromContent, GuardPair, ToContent } from "../shared/messages.js";
import { pressAt } from "./press.js";

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

/**
 * Put text into a field, whatever kind of field it is.
 *
 * Three cases, and getting them confused is how this broke: a real <input> or
 * <textarea> needs the NATIVE value setter, because React installs its own and
 * ignores a plain assignment; a contenteditable — which is what X, Slack, Gmail and
 * Notion all use — has no value property at all, so calling an input's setter on it
 * throws "Illegal invocation"; and rich editors track their own state, so the text
 * has to arrive as a real input event rather than a DOM mutation.
 */
function setFieldValue(el: HTMLElement, value: string): void {
  // Everything from the element's OWN document and window. An input inside a frame
  // belongs to another realm: `instanceof HTMLInputElement` is false for it, and this
  // window's selection and execCommand do not reach into its document.
  const doc = el.ownerDocument;
  const view = (doc.defaultView ?? window) as typeof window;
  el.focus();

  if (el.isContentEditable) {
    const range = doc.createRange();
    range.selectNodeContents(el);
    const selection = view.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // execCommand is deprecated but remains the only thing rich editors reliably
    // observe: it produces the same beforeinput/input pair a keystroke would.
    const inserted = doc.execCommand("insertText", false, value);
    if (!inserted) {
      el.textContent = value;
      el.dispatchEvent(new view.InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    }
    return;
  }

  const proto =
    el.tagName === "TEXTAREA"
      ? view.HTMLTextAreaElement.prototype
      : el.tagName === "SELECT"
        ? view.HTMLSelectElement.prototype
        : el.tagName === "INPUT"
          ? view.HTMLInputElement.prototype
          : null;
  // The NATIVE setter: React installs its own on the instance and ignores assignment.
  const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : undefined;
  if (setter) setter.call(el, value);
  else (el as HTMLInputElement).value = value;
  el.dispatchEvent(new view.Event("input", { bubbles: true }));
  el.dispatchEvent(new view.Event("change", { bubbles: true }));
}

async function handle(msg: ToContent): Promise<FromContent> {
  switch (msg.kind) {
    case "snapshot":
      return { ok: true, snapshot: snapshot(msg.maxCandidates ?? 2000) };

    case "pageText":
      return { ok: true, text: pageText(msg.maxChars ?? 40_000) };

    case "guard":
      return { ok: true, guard: currentGuard(msg.node, msg.fp) };

    case "settle":
      await settle(msg.node, msg.isCombobox);
      return { ok: true };

    case "point":
      return { ok: true, refusal: await point(msg.node, msg.message, msg.fp) };

    case "annotate":
      return { ok: true, ...annotate(msg.marks) };

    case "cursor":
      if (msg.hide) cursorHide();
      if (msg.listening !== undefined) cursorListening(msg.listening);
      return { ok: true };

    case "preflight": {
      const { action, node, fp } = msg;
      if (node === null) return { ok: true, refusal: null };
      if (action.kind !== "click" && action.kind !== "type" && action.kind !== "select") {
        return { ok: true, refusal: null };
      }
      const kind = action.kind === "type" ? "fill" : action.kind === "select" ? "select" : "click";
      return {
        ok: true,
        refusal: preflight(node, kind, action.kind === "select" ? action.option : undefined, fp),
      };
    }

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
      // Glides the agent's cursor to the target, then re-resolves: the point acted on
      // is measured after the cursor arrives, not before.
      const at = await approach(node, kind, option, fp);
      if ("refused" in at) return { ok: false, error: at.refused, unreachable: true };
      if (kind === "select") return { ok: true };

      // `approach` has just proved the chosen element is what sits at this point.
      // `hit` is the innermost element there — events are dispatched on it so they
      // bubble the real path. Text goes to the CHOSEN element: climbing from the hit
      // to the nearest `[role]` once landed on a dialog wrapper and set `.value` on a
      // div, which does nothing.
      const hit = deepElementFromPoint(at.x, at.y) as HTMLElement | null;
      const chosen = elementFor(node, fp) as HTMLElement | undefined;
      const target = chosen ?? hit;
      if (!target || !hit) return { ok: false, error: "nothing at the resolved point", unreachable: true };

      if (action.kind === "type") {
        // Last line of defence. The worker checks this too, but the check that
        // matters is the one closest to the keystroke — so it runs on the element
        // that will actually RECEIVE the text, not the one the model named. Checking
        // a wrapper would let the password field inside it through.
        const field = editableWithin(target);
        const credential = isCredentialField(field) || isCredentialField(target);
        if (credential) {
          return { ok: false, error: `refused to type into a credential field: ${credential}` };
        }
        // Click first, exactly as a person would: comboboxes, masked inputs and rich
        // editors initialise on focus/pointerdown, and some only accept text after it.
        pressAt(hit, target, at.x, at.y);
        setFieldValue(field, text ?? "");
        if (action.submit) {
          for (const type of ["keydown", "keypress", "keyup"]) {
            field.dispatchEvent(
              new KeyboardEvent(type, {
                key: "Enter",
                code: "Enter",
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true,
                composed: true,
              } as KeyboardEventInit),
            );
          }
        }
        return { ok: true };
      }

      pressAt(hit, target, at.x, at.y);
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
