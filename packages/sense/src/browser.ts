import { FORBIDDEN_FIELD } from "@jev-browser/shared";
import type { RawSnapshot } from "@jev-browser/shared";
import { cursorClick, cursorHighlight, cursorTo } from "./cursor.js";
import {
  collectSnapshot,
  composedContains,
  deepElementFromPoint,
  deepQueryAll,
  findByFingerprint,
  nameOf,
  reachableRoots,
  roleOf,
  topRect,
} from "./collect.js";

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
/**
 * The element that actually takes text. The model may choose a wrapper — a labelled
 * container around an input, or a composer whose editable surface is a child — and
 * the text belongs in the editable thing inside it, not on the wrapper.
 */
export function editableWithin(el: HTMLElement): HTMLElement {
  // Tag names, not `instanceof`: an input inside a frame belongs to another realm and
  // is not an instance of THIS window's HTMLInputElement.
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return el;
  return (
    el.querySelector<HTMLElement>('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]') ??
    el
  );
}

/**
 * The name of the credential this field asks for, or "" if it is not one.
 *
 * Reads every label a page might use — autocomplete tokens included, since a card
 * field is often marked only `autocomplete="cc-number"`. This is the one deliberate
 * hard-coded check in the product: it must hold when the model is wrong or the page
 * has been built to manipulate it.
 */
export function isCredentialField(el: HTMLElement): string {
  const input = el as HTMLInputElement;
  if (input.type === "password") return "password";
  const autocomplete = el.getAttribute("autocomplete") ?? "";
  if (/\b(current-password|new-password|one-time-code|cc-number|cc-csc)\b/i.test(autocomplete)) {
    return autocomplete;
  }
  const label = [
    el.getAttribute("aria-label"),
    el.getAttribute("name"),
    el.id,
    el.getAttribute("placeholder"),
    input.labels?.[0]?.textContent,
  ]
    .filter(Boolean)
    .join(" ");
  return FORBIDDEN_FIELD.test(label) ? label.trim().slice(0, 60) : "";
}

/** The live element behind a node id, re-found by fingerprint after a re-render. */
export function elementFor(node: number, fp?: string): Element | undefined {
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
    deepQueryAll("input,textarea,select")
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
/**
 * Say what is in the way in terms the decision can act on.
 *
 * This used to report the topmost element as `tagName#id`, which on a modern
 * consent dialog, tour or cookie banner reads "covered by div" — a fact with no
 * lead in it. The model cannot map a tag name onto anything in its action space,
 * so it re-picked the same covered target and refused again. Google Forms' welcome
 * dialog produced exactly that loop.
 *
 * So describe the occluder the way the snapshot describes everything else: by role
 * and accessible name. "covered by dialog \u201cFamiliar and easier access control\u201d"
 * names something the model can find in its own action space and dismiss.
 *
 * The topmost pixel is usually an anonymous backdrop, so walk up for the nearest
 * ancestor a person would name, and failing that look for an open modal anywhere —
 * a backdrop is often a sibling of the dialog it dims, not its parent.
 */
function describeOccluder(top: Element | null): string {
  if (!top) return "nothing";

  for (let el: Element | null = top; el && el !== document.body; el = el.parentElement) {
    const role = roleOf(el);
    if (role === "dialog" || role === "alertdialog") {
      const named = nameOf(el).slice(0, 80);
      return named ? `dialog \u201c${named}\u201d` : "a dialog";
    }
    // An unlabelled container has no name of its own, so `nameOf` falls back to its
    // text — which for a nav column is every link in it run together. AWS' services
    // menu reported 'generic "Analytics Application Integration Blockchain..."'.
    // A name is only worth quoting when something actually labelled it.
    const labelled =
      el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") || el.hasAttribute("title");
    if (role === "generic" && !labelled) continue;
    const name = nameOf(el).slice(0, 80);
    if (name) return `${role} \u201c${name}\u201d`;
  }

  const modal = deepQueryAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open]')
    .find((d) => d.getBoundingClientRect().width > 0);
  if (modal) {
    const name = nameOf(modal).slice(0, 80);
    return name ? `an overlay, with the dialog \u201c${name}\u201d open` : "an overlay, with a dialog open";
  }

  return `${top.tagName.toLowerCase()}${top.id ? `#${top.id}` : ""}`;
}

export type Resolution = { x: number; y: number } | { refused: string };

export function resolvePoint(
  node: number,
  kind: "click" | "fill" | "select",
  value?: string,
  fp?: string,
  /** Check everything, perform nothing. See `preflight`. */
  dryRun = false,
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
  if (kind === "fill") {
    // Here, in the shared resolver, so BOTH executors refuse at the last moment
    // before a keystroke — the CDP driver used to rely on the model's label alone.
    const credential =
      isCredentialField(editableWithin(e as unknown as HTMLElement)) ||
      isCredentialField(e as unknown as HTMLElement);
    if (credential) return { refused: `refused to type into a credential field: ${credential}` };
  }

  // Top-viewport geometry throughout: an element inside a frame measures relative to
  // the frame, and the point we act on is in the top page.
  let r = topRect(e);
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
    r = topRect(e);
  }

  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
    return { refused: `off-screen after scrolling (${Math.round(x)},${Math.round(y)})` };
  }
  // Still covered after scrolling: something is genuinely on top of it.
  // Hit-tested through shadow roots and frames: `document.elementFromPoint` returns
  // the shadow host or the iframe, and every control inside one read as covered.
  const top = deepElementFromPoint(x, y);
  if (!composedContains(e, top)) {
    return { refused: `covered by ${describeOccluder(top)}` };
  }

  if (kind === "select") {
    const select = e as unknown as HTMLSelectElement;
    if (select.tagName !== "SELECT") return { refused: "not a native select" };
    const ok = Array.from(select.options).some(
      (o) => o.value === value && !o.disabled && !o.closest("optgroup[disabled]"),
    );
    if (!ok) return { refused: `no selectable option "${value}"` };
    if (dryRun) return { x, y };
    select.value = value ?? "";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return { x, y };
}

/** What the cursor's label says while it heads for an element. */
function cursorLabel(kind: "click" | "fill" | "select", el: Element | undefined, value?: string): string {
  const name = el ? nameOf(el) : "";
  const quoted = name ? `\u201c${name.length > 40 ? `${name.slice(0, 39)}\u2026` : name}\u201d` : "";
  if (kind === "fill") return quoted ? `Typing into ${quoted}` : "Typing";
  if (kind === "select") return `Choosing \u201c${value ?? ""}\u201d${quoted ? ` in ${quoted}` : ""}`;
  return quoted ? `Clicking ${quoted}` : "Clicking";
}

/**
 * Resolve the target, glide the cursor to it, then resolve AGAIN and return that.
 *
 * The second resolve is the one acted on: the glide takes a few hundred milliseconds,
 * the page can move in that time, and acting on a point measured before the animation
 * would click whatever slid under it. Both executors call this instead of resolving
 * directly, so both show the cursor and neither can skip the re-check.
 */
export async function approach(
  node: number,
  kind: "click" | "fill" | "select",
  value?: string,
  fp?: string,
): Promise<Resolution> {
  const first = resolvePoint(node, kind, value, fp, true);
  if ("refused" in first) return first;
  await cursorTo(first.x, first.y, cursorLabel(kind, elementFor(node, fp), value), kind === "fill" ? "type" : "click");
  const final = resolvePoint(node, kind, value, fp);
  if (!("refused" in final) && kind === "click") cursorClick();
  return final;
}

/**
 * Show mode: point at the element and say what to do, without touching it.
 * Returns the reason it could not be pointed at, or null.
 */
export async function point(node: number, message: string, fp?: string): Promise<string | null> {
  const r = resolvePoint(node, "click", undefined, fp, true);
  if ("refused" in r) return r.refused;
  const el = elementFor(node, fp);
  await cursorTo(r.x, r.y, message, "point");
  cursorHighlight(el ? topRect(el) : null);
  return null;
}

export { cursorClick, cursorHide, cursorHighlight, cursorListening, cursorTo } from "./cursor.js";

/**
 * Could this be acted on right now? The reason it could not, or null.
 *
 * The same code path as `resolvePoint` with the mutation switched off, so a
 * pre-flight and the real action can never disagree about what is reachable. It may
 * scroll the element into view — the page key excludes scroll, so that is harmless.
 */
export function preflight(
  node: number,
  kind: "click" | "fill" | "select",
  value?: string,
  fp?: string,
): string | null {
  const r = resolvePoint(node, kind, value, fp, true);
  return "refused" in r ? r.refused : null;
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
      const home = (field?.getRootNode() ?? document) as Document | ShadowRoot;
      const options = ids.length
        ? ids
            .map((i) => home.getElementById(i))
            .filter((n): n is HTMLElement => Boolean(n))
            .flatMap((n) => Array.from(n.querySelectorAll('[role="option"]')))
        : deepQueryAll('[role="option"]');
      const visibleOption = options
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

/**
 * Visible text for extraction, with the page's links appended.
 *
 * `innerText` contains no hrefs, so an extraction asked for "the jobs and their
 * URLs" can only return what is written on screen — on Hacker News that is
 * "supabase.link", not a URL you can navigate to. Every link the agent might follow
 * has to be readable, or it cannot plan navigation at all.
 */
export function pageText(maxChars = 40_000): string {
  const main = document.querySelector("main,article,[role=main]") ?? document.body;
  // innerText does not include what lives in shadow roots or frames; read those too.
  // `nodeType`, not `instanceof Document`: a frame's document belongs to another realm
  // and is not an instance of this window's Document.
  const extra = reachableRoots()
    .slice(1)
    .map((root) =>
      root.nodeType === Node.DOCUMENT_NODE
        ? ((root as Document).body?.innerText ?? "")
        : (root.textContent ?? ""),
    )
    .filter((t) => t.trim());
  const body = [(main as HTMLElement).innerText ?? "", ...extra]
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const seen = new Set<string>();
  const links: string[] = [];
  for (const a of deepQueryAll("a[href]") as HTMLAnchorElement[]) {
    const href = a.href;
    if (!href || !/^https?:/.test(href) || seen.has(href)) continue;
    if (!a.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const label = (a.innerText || a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!label) continue;
    seen.add(href);
    links.push(`- [${label}](${href})`);
    if (links.length >= 300) break;
  }

  const linkSection = links.length ? `\n\nLinks on this page:\n${links.join("\n")}` : "";
  return `${body.slice(0, Math.max(0, maxChars - linkSection.length))}${linkSection}`;
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
