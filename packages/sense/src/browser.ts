import type { RawSnapshot } from "@jev-browser/shared";
import { collectSnapshot, findByFingerprint } from "./collect.js";

/**
 * The browser-side surface, as real functions.
 *
 * ONE implementation, reached two ways: a CDP driver bundles this module into the
 * page and calls it by name, while an MV3 content script imports it directly. Writing
 * the guards as strings for CDP and again as functions for the extension would be two
 * implementations of the check that decides whether it is safe to click — which is
 * precisely the code that must not drift.
 *
 * Everything here is browser-context: no Node, no imports beyond a type.
 */

interface Cache {
  ids: WeakMap<Element, number>;
  nodes: Map<number, Element>;
  next: number;
  id(e: Element): number;
}

const cache = (): Cache | undefined =>
  (globalThis as unknown as { __jevSenseCache?: Cache }).__jevSenseCache;

/**
 * Resolve a node id to a live element, re-finding it by fingerprint when the original
 * has been replaced.
 *
 * A single-page app swaps DOM nodes on every render, so holding an object reference
 * across a model call is not reliable — on a React application form every field was
 * detached within the ~500ms a decision takes. The fingerprint identifies the element
 * by role, accessible name and ordinal, which is what a re-render preserves, and the
 * re-found element is written back so later steps do not pay for the search again.
 */
function elementFor(node: number, fp?: string): Element | undefined {
  const c = cache();
  if (!c) return undefined;
  const existing = c.nodes.get(node);
  if (existing?.isConnected) return existing;
  if (!fp) return undefined;
  const found = findByFingerprint(fp);
  if (!found) return undefined;
  c.nodes.set(node, found);
  return found;
}

/**
 * Everything that must not have changed for a decision about the PAGE to stand.
 * Excludes geometry and scroll, so animation and scrolling do not invalidate.
 */
export function pageKey(): string | null {
  const c = cache();
  if (!c) return null;
  const safe = (e: HTMLInputElement) => !["password", "file", "hidden"].includes(e.type);
  return JSON.stringify([
    location.href,
    document.title,
    Array.from(document.querySelectorAll("input,textarea,select"))
      .filter((e) => safe(e as HTMLInputElement))
      .map((e) => {
        const i = e as HTMLInputElement & { selectedIndex?: number };
        return [c.id(e), i.value, i.checked, i.selectedIndex, i.disabled, i.readOnly];
      }),
  ]);
}

/**
 * Everything that must not have changed for a decision about ONE ELEMENT to stand.
 *
 * Scoped context (the enclosing form, dialog or row) is included on purpose: it
 * catches a page that kept the control but changed what it means, while tolerating
 * unrelated content elsewhere updating. A heuristic, not a proof.
 */
export function nodeGuard(node: number, fp?: string): string | null {
  const e = elementFor(node, fp) as (HTMLInputElement & { selectedIndex?: number }) | undefined;
  if (!e?.isConnected) return null;
  if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
  const scope =
    e.closest('form,dialog,[role="dialog"],article,li,tr,[role="row"]') ?? e.parentElement;
  return JSON.stringify([
    e.getAttribute("role"),
    e.tagName,
    (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
    e.value ?? null,
    e.checked ?? null,
    e.selectedIndex ?? null,
    e.readOnly ?? null,
    e.matches(":disabled"),
    e.getAttribute("aria-disabled"),
    e.getAttribute("aria-expanded"),
    e.getAttribute("aria-checked"),
    e.getAttribute("aria-selected"),
    e.getAttribute("href"),
    ((scope as HTMLElement | null)?.innerText ?? "").slice(0, 2000),
  ]);
}

/**
 * Resolve a node to a click point immediately before input, or null to abort.
 *
 * The hit test is the important part. An element can be connected, visible, enabled
 * and still sit under a cookie banner — clicking its centre then hits the overlay,
 * which is how agents silently "accept" things nobody agreed to.
 */
export type Resolution = { x: number; y: number } | { refused: string };

export function resolvePoint(
  node: number,
  kind: "click" | "fill" | "select",
  value?: string,
  fp?: string,
): Resolution {
  const e = elementFor(node, fp) as (HTMLInputElement & { options?: HTMLOptionElement[] }) | undefined;
  // Every refusal names its reason. A bare null turned "the form is below the fold"
  // and "a modal is covering it" into the same unactionable message.
  if (!e) return { refused: "node is not in the registry" };
  if (!e.isConnected) return { refused: "element left the document" };
  if (e.matches(":disabled") || e.closest('[aria-disabled="true"],[inert]')) {
    return { refused: "element is disabled" };
  }
  // A file input is exempt: it is hidden on purpose and never clicked, only filled
  // by the driver.
  const isFileInput = e.tagName === "INPUT" && e.type === "file";
  if (!isFileInput && !e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
    return { refused: "element is not visible" };
  }
  if (isFileInput) return { x: 0, y: 0 };
  if (kind === "fill" && (e.readOnly || e.getAttribute("aria-readonly") === "true")) {
    return { refused: "field is read-only" };
  }

  let r = e.getBoundingClientRect();
  if (!r.width || !r.height) return { refused: "element has no size" };

  // Bring it into view before measuring. Refusing anything below the fold made every
  // long form unreachable — a 26-field application is mostly off-screen, and the
  // agent reported "target is covered" for fields that were merely further down.
  // Scrolling is safe here: the page key deliberately excludes scroll position, so
  // this cannot invalidate the decision we are in the middle of executing.
  const inView =
    r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  if (!inView) {
    // `behavior: "instant"` is load-bearing. Many sites set CSS `scroll-behavior:
    // smooth`, which makes scrollIntoView ANIMATED and asynchronous — the rect is
    // then re-measured before anything has moved, and every element below the fold
    // resolves as unreachable. Greenhouse does exactly this.
    e.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    r = e.getBoundingClientRect();
  }

  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
    return { refused: `off-screen after scrolling (${Math.round(x)},${Math.round(y)})` };
  }
  // Still covered after scrolling: something is genuinely on top of it.
  const top = document.elementFromPoint(x, y);
  if (!e.contains(top)) {
    const what = top ? `${top.tagName.toLowerCase()}${top.id ? `#${top.id}` : ""}` : "nothing";
    return { refused: `covered by ${what}` };
  }

  if (kind === "select") {
    const select = e as unknown as HTMLSelectElement;
    if (select.tagName !== "SELECT") return { refused: "not a native select" };
    const ok = Array.from(select.options).some(
      (o) => o.value === value && !o.disabled && !o.closest("optgroup[disabled]"),
    );
    if (!ok) return { refused: `no selectable option "${value}"` };
    select.value = value ?? "";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return { x, y };
}

/**
 * Wait for the page to be worth observing again.
 *
 * A flat delay is wrong both ways: too long after an ordinary click, too short after
 * typing into a combobox whose suggestions have not rendered — and asking the model
 * to choose from an empty popup wastes an entire decision.
 */
export function settle(node: number | null, isCombobox: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const field = node === null ? undefined : elementFor(node);
    let frames = 0;
    let stopped = false;
    const finish = () => {
      stopped = true;
      resolve(true);
    };
    setTimeout(finish, isCombobox ? 200 : 50);
    const ready = () => {
      if (stopped) return;
      const ids = (
        field?.getAttribute("aria-controls") ??
        field?.getAttribute("aria-owns") ??
        ""
      )
        .split(/\s+/)
        .filter(Boolean);
      const roots: ParentNode[] = ids.length
        ? ids.map((i) => document.getElementById(i)).filter((n): n is HTMLElement => Boolean(n))
        : [document];
      const visibleOption = roots
        .flatMap((root) => Array.from(root.querySelectorAll('[role="option"]')))
        .some((o) => {
          const r = o.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.height > 0 &&
            r.bottom > 0 &&
            r.top < innerHeight &&
            o.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          );
        });
      if (++frames >= 2 && (!isCombobox || visibleOption)) finish();
      else requestAnimationFrame(ready);
    };
    requestAnimationFrame(ready);
  });
}

/** Snapshot the page. Re-exported so one bundle serves the whole browser surface. */
export function snapshot(maxCandidates = 2000): RawSnapshot {
  return collectSnapshot(maxCandidates);
}

/** True when a decision about this element may still be executed. */
export function stillFresh(
  before: { pageKey: string | null; nodeGuard: string | null },
  after: { pageKey: string | null; nodeGuard: string | null },
): boolean {
  if (after.pageKey === null) return false;
  if (before.nodeGuard !== null && after.nodeGuard === null) return false;
  return before.pageKey === after.pageKey && before.nodeGuard === after.nodeGuard;
}
