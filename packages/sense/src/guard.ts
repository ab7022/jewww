import type { RawElement } from "@jev-browser/shared";

/**
 * Freshness guards and occlusion-checked resolution.
 *
 * `contentHash` answers "did anything change?", which is the wrong question: any
 * animation invalidates it, and it still cannot tell you whether *the element you
 * are about to click* is still the same element meaning the same thing.
 *
 * These guards compare SEMANTICS instead — the page's form state, and the specific
 * target's role, name, value, disabled/checked state and surrounding context. Before
 * input we re-resolve geometry and hit-test, because an element can be present,
 * enabled and completely covered by a modal.
 *
 * Both functions below are browser-context and self-contained, same as collect.ts.
 */

/** Stable identity for a node across snapshots within one page lifetime. */
export interface NodeHandle {
  /** Index into the collector's WeakMap-backed registry. */
  node: number;
}

/**
 * Everything that must not have changed for a decision about the PAGE to stand.
 * Deliberately excludes geometry and text so scroll and animation do not invalidate.
 */
export function pageKeyScript(): string {
  return `(() => {
    const c = window.__jevSenseCache;
    if (!c) return null;
    const safe = (e) => !['password','file','hidden'].includes(e.type);
    return JSON.stringify([
      location.href,
      document.title,
      [...document.querySelectorAll('input,textarea,select')].filter(safe)
        .map((e) => [c.id(e), e.value, e.checked, e.selectedIndex, e.disabled, e.readOnly]),
    ]);
  })()`;
}

/**
 * Everything that must not have changed for a decision about ONE ELEMENT to stand.
 *
 * Scoped context (the enclosing form, dialog or row) is included deliberately: it
 * catches the case where the page kept the same control but changed what it means,
 * while still tolerating unrelated content elsewhere updating. That is a practical
 * heuristic, not a proof that unrelated changes are irrelevant.
 */
export function nodeGuardScript(node: number): string {
  return `(() => {
    const c = window.__jevSenseCache;
    const e = c && c.nodes.get(${node});
    if (!e || !e.isConnected) return null;
    if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
    const scope = e.closest('form,dialog,[role="dialog"],article,li,tr,[role="row"]') || e.parentElement;
    return JSON.stringify([
      e.getAttribute('role'), e.tagName,
      (e.getAttribute('aria-label') || e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      e.value ?? null, e.checked ?? null, e.selectedIndex ?? null, e.readOnly ?? null,
      e.matches(':disabled'),
      e.getAttribute('aria-disabled'), e.getAttribute('aria-expanded'),
      e.getAttribute('aria-checked'), e.getAttribute('aria-selected'), e.getAttribute('href'),
      (scope && scope.innerText || '').slice(0, 2000),
    ]);
  })()`;
}

/**
 * Resolve a node to a click point immediately before input, or null to abort.
 *
 * The hit test is the important part. An element can be connected, visible, enabled
 * and still sit underneath a cookie banner or modal — clicking its centre then hits
 * the overlay instead, which is how agents silently "accept" things nobody agreed to.
 */
export function resolveScript(node: number, kind: "click" | "fill" | "select", value?: string): string {
  return `(() => {
    const c = window.__jevSenseCache;
    const e = c && c.nodes.get(${node});
    if (!e || !e.isConnected) return null;
    if (e.matches(':disabled') || e.closest('[aria-disabled="true"],[inert]')) return null;
    if (!e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return null;
    if (${JSON.stringify(kind)} === 'fill' && (e.readOnly || e.getAttribute('aria-readonly') === 'true')) return null;
    const r = e.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (!r.width || !r.height || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
    // Covered by an overlay: the point belongs to something else.
    if (!e.contains(document.elementFromPoint(x, y))) return null;
    if (${JSON.stringify(kind)} === 'select') {
      const v = ${JSON.stringify(value ?? "")};
      if (e.tagName !== 'SELECT') return null;
      if (![...e.options].some((o) => o.value === v && !o.disabled && !o.closest('optgroup[disabled]'))) return null;
      e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return JSON.stringify({ x, y });
  })()`;
}

/**
 * Wait for the page to be worth observing again.
 *
 * A flat delay is wrong in both directions: too long after an ordinary click, too
 * short after typing into a combobox whose suggestions have not rendered yet — and
 * asking the model to choose from an empty popup wastes a whole decision.
 */
export function settleScript(node: number | null, isCombobox: boolean): string {
  return `new Promise((resolve) => {
    const c = window.__jevSenseCache;
    const field = c && ${node === null ? "null" : `c.nodes.get(${node})`};
    const autocomplete = ${isCombobox};
    let frames = 0, stopped = false;
    const finish = () => { stopped = true; resolve(true); };
    setTimeout(finish, autocomplete ? 200 : 50);
    const ready = () => {
      if (stopped) return;
      const ids = ((field && (field.getAttribute('aria-controls') || field.getAttribute('aria-owns'))) || '')
        .split(/\\s+/).filter(Boolean);
      const roots = ids.length ? ids.map((i) => document.getElementById(i)).filter(Boolean) : [document];
      const options = roots.flatMap((root) => [...root.querySelectorAll('[role="option"]')]);
      const visibleOption = options.some((o) => {
        const r = o.getBoundingClientRect();
        return r.width && r.height && r.bottom > 0 && r.top < innerHeight &&
          o.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      });
      if (++frames >= 2 && (!autocomplete || visibleOption)) finish();
      else requestAnimationFrame(ready);
    };
    requestAnimationFrame(ready);
  })`;
}

/** True when a decision about this element may still be executed. */
export function stillFresh(
  before: { pageKey: string | null; nodeGuard: string | null },
  after: { pageKey: string | null; nodeGuard: string | null },
): boolean {
  if (after.pageKey === null || after.nodeGuard === null) return false;
  return before.pageKey === after.pageKey && before.nodeGuard === after.nodeGuard;
}

export type { RawElement };
