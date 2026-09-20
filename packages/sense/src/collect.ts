import type { RawSnapshot } from "@jev-browser/shared";

/**
 * Browser-context collector: document -> RawSnapshot.
 *
 * DELIBERATELY ONE SELF-CONTAINED FUNCTION. Playwright injects it by serializing
 * `fn.toString()`, which cannot capture anything from module scope, and an MV3
 * content script will later run the very same source. So: every helper is nested,
 * the only import is a type (erased at compile time), and there are no runtime deps.
 *
 * It collects everything RENDERED rather than everything in the viewport, and stores
 * each element's rect. Ranking is a separate, pure function that runs later in Node,
 * so the benchmark can retune ranking against saved fixtures without re-capturing.
 */
export const SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[role]",
  "[onclick]",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable]:not([contenteditable=false])",
].join(",");

/**
 * Roles that describe a container, not a control.
 *
 * They match `[role]` in the selector and so were collected, then offered as click
 * targets — and clicking a group does nothing at all. On a Greenhouse form the model
 * kept choosing `[group] "Resume/CV"` after the upload had already succeeded,
 * repeating until the loop guard killed a run that had in fact finished.
 */
const CONTAINER_ROLES = new Set([
  "group", "region", "banner", "contentinfo", "navigation", "main", "form", "search",
  "list", "listitem", "table", "row", "rowgroup", "presentation", "none", "article",
  "document", "application", "status", "alert", "log", "tooltip", "separator",
  "heading", "img", "figure", "paragraph", "definition", "term", "toolbar",
]);

const TAG_ROLE: Record<string, string> = {
  A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox",
  SUMMARY: "disclosure", H1: "heading", H2: "heading", H3: "heading",
};

const INPUT_ROLE: Record<string, string> = {
  checkbox: "checkbox", radio: "radio", submit: "button", button: "button",
  reset: "button", file: "fileinput", range: "slider", email: "textbox",
  tel: "textbox", url: "textbox", search: "searchbox", password: "password",
  number: "spinbutton", date: "datepicker",
};

/** Tolerates non-strings: DOM clobbering makes `form.value` an Element. */
export const clean = (s: unknown): string =>
  typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 120) : "";

export function roleOf(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit.split(/\s+/)[0] ?? "generic";
  if (el.tagName === "INPUT") {
    const t = (el as HTMLInputElement).type.toLowerCase();
    return INPUT_ROLE[t] ?? "textbox";
  }
  if ((el as HTMLElement).isContentEditable) return "textbox";
  return TAG_ROLE[el.tagName] ?? "generic";
}

function labelText(el: Element): string {
  const id = el.getAttribute("id");
  if (id) {
    const esc = id.replace(/["\\]/g, "\\$&");
    const lbl = document.querySelector(`label[for="${esc}"]`);
    if (lbl) return clean(lbl.textContent);
  }
  const wrapping = el.closest("label");
  if (wrapping) return clean(wrapping.textContent);
  // Common ATS pattern: the label is a sibling div, not a <label> at all.
  const prev = el.previousElementSibling;
  if (prev && /^(LABEL|SPAN|DIV|P)$/.test(prev.tagName)) {
    const t = clean(prev.textContent);
    if (t && t.length < 80) return t;
  }
  return "";
}

export function nameOf(el: Element): string {
  // A file input is visually hidden, so its own label is usually the word on the
  // button covering it ("Attach"). The surrounding field says what it is actually
  // for ("Resume/CV"), which is what the model needs to choose correctly.
  if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "file") {
    // Walk out until a container names the FIELD rather than the button sitting on
    // it. Every wrapper around a Greenhouse upload is labelled "Attach"; the field is
    // called "Resume/CV" several levels up, and a label that contains the input is by
    // definition the button's own, so it is skipped.
    let scope: Element | null = el.parentElement;
    for (let depth = 0; scope && depth < 10; depth++, scope = scope.parentElement) {
      const aria = clean(scope.getAttribute("aria-label"));
      if (aria) return aria;
      for (const candidate of scope.querySelectorAll("label,legend,h1,h2,h3,h4")) {
        if (candidate.contains(el)) continue;
        const text = clean(candidate.textContent);
        if (text) return text;
      }
    }
  }
  const aria = clean(el.getAttribute("aria-label"));
  if (aria) return aria;
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const parts = by.split(/\s+/).map((i) => clean(document.getElementById(i)?.textContent)).filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  const lbl = labelText(el);
  if (lbl) return lbl;
  const ph = clean(el.getAttribute("placeholder"));
  if (ph) return ph;
  const title = clean(el.getAttribute("title"));
  if (title) return title;
  if (el.tagName === "INPUT") {
    const input = el as HTMLInputElement;
    if (/^(submit|button|reset)$/.test(input.type)) {
      const v = clean(input.value);
      if (v) return v;
    }
    const nm = clean(input.getAttribute("name"));
    if (nm) return nm.replace(/[_-]+/g, " ");
  }
  const alt = clean(el.querySelector("img[alt]")?.getAttribute("alt"));
  if (alt) return alt;
  const text = clean((el as HTMLElement).innerText || el.textContent);
  if (text) return text;
  return "";
}

/**
 * Find the element a fingerprint describes, for when the original node has been
 * replaced by a re-render.
 *
 * React and friends swap DOM nodes constantly — on a Greenhouse application form,
 * every field was detached within the ~500ms a model call takes, so every action
 * failed with "element left the document". The fingerprint is `role|name|nth`, which
 * identifies the element by what it MEANS rather than by object identity, and that is
 * the thing a re-render preserves.
 */
export function findByFingerprint(fp: string): Element | null {
  const [role, name, nthRaw] = fp.split("|");
  if (!role || name === undefined) return null;
  const nth = Number(nthRaw ?? 0);
  let seen = 0;
  for (const el of document.querySelectorAll(SELECTOR)) {
    if (roleOf(el) !== role) continue;
    if (nameOf(el) !== name) continue;
    if (seen++ === nth) return el;
  }
  return null;
}

export function collectSnapshot(maxCandidates = 2000): RawSnapshot {
  // A code-owned identity per live DOM node, so a decision can name the element it
  // was made about and the executor can re-resolve that exact node later. These are
  // OUR ids, never CDP backend node ids and never anything the model emits.
  interface Cache {
    ids: WeakMap<Element, number>;
    nodes: Map<number, Element>;
    next: number;
    id(e: Element): number;
  }
  const g = globalThis as unknown as { __jevSenseCache?: Cache };
  const cache: Cache = (g.__jevSenseCache ??= {
    ids: new WeakMap<Element, number>(),
    nodes: new Map<number, Element>(),
    next: 1,
    id(e: Element) {
      let id = this.ids.get(e);
      if (id === undefined) {
        id = this.next++;
        this.ids.set(e, id);
      }
      this.nodes.set(id, e);
      return id;
    },
  });
  // Drop references to nodes the page has removed.
  for (const [id, el] of cache.nodes) if (!el.isConnected) cache.nodes.delete(id);




  // Must tolerate non-strings: DOM clobbering means `form.value` can be an Element
  // when the form contains <input name="value">, and the same trick applies to any
  // property name. Arbitrary pages do this, sometimes on purpose.



  function ctxOf(el: Element): string {
    const landmark = el.closest("nav,header,footer,aside,main,form,dialog,[role=dialog]");
    if (landmark) {
      const l = clean(landmark.getAttribute("aria-label"));
      const tag = landmark.tagName.toLowerCase();
      if (l) return `${tag}: ${l}`;
      if (tag !== "main") return tag;
    }
    let node: Element | null = el;
    for (let i = 0; node && i < 6; i++) {
      let sib: Element | null = node.previousElementSibling;
      while (sib) {
        if (/^H[1-4]$/.test(sib.tagName)) {
          const h = clean(sib.textContent);
          if (h) return h;
        }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  }

  function stateOf(el: Element): string {
    const s: string[] = [];
    const any = el as HTMLInputElement;
    if (any.disabled === true || el.getAttribute("aria-disabled") === "true") s.push("disabled");
    if (any.checked === true || el.getAttribute("aria-checked") === "true") s.push("checked");
    const exp = el.getAttribute("aria-expanded");
    if (exp) s.push(exp === "true" ? "expanded" : "collapsed");
    if (el === document.activeElement) s.push("focused");
    if (any.required === true || el.getAttribute("aria-required") === "true") s.push("required");
    return s.join(" ");
  }

  /** True when clicking this would only raise the native file dialog. */
  function isFilePickerTrigger(el: Element): boolean {
    if (el.querySelector('input[type="file"]')) return true;
    let scope: Element | null = el.parentElement;
    for (let depth = 0; scope && depth < 3; depth++, scope = scope.parentElement) {
      const input = scope.querySelector('input[type="file"]');
      if (!input) continue;
      // Only when the widget is small: a whole form containing an upload field
      // somewhere must not have every button removed.
      if (scope.querySelectorAll(SELECTOR).length <= 4) return true;
    }
    return false;
  }

  function visible(el: Element): DOMRect | null {
    // File inputs are hidden by design almost everywhere — sites style a button or
    // label over an `opacity:0` input. Dropping them for being invisible means the
    // agent can never upload anything, and it cannot click its way to the dialog
    // either. They are collected regardless and uploaded through the driver.
    if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "file") {
      return new DOMRect(0, 0, 1, 1);
    }
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return null;
    // Guard the empty string: Number("") is 0, which would drop every element on
    // any engine that does not resolve opacity to a number.
    const opacity = Number.parseFloat(cs.opacity);
    if (Number.isFinite(opacity) && opacity === 0) return null;
    return r;
  }

  function hash(s: string): string {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  // --- collect -------------------------------------------------------------

  const all = Array.from(document.querySelectorAll(SELECTOR));
  const kept: { el: Element; role: string; name: string; rect: DOMRect }[] = [];

  for (const el of all) {
    if (kept.length >= maxCandidates) break;
    try {
      // A control that only opens the file picker is a dead end: clicking it raises
      // a native dialog no agent can answer, so the page never changes and the run
      // burns its retries. The file input itself is collected and filled by the
      // driver instead.
      //
      // Both shapes count — a wrapper containing the input, and a button sitting
      // beside it inside the same small upload widget, which is how Greenhouse,
      // Lever and Ashby all build it.
      if (el.tagName !== "INPUT" && isFilePickerTrigger(el)) continue;

      const rect = visible(el);
      if (!rect) continue;
      const role = roleOf(el);
      // A bare [role] hook, or a container role, is not something to act on — unless
      // the page has explicitly made it clickable.
      const actionable = el.hasAttribute("onclick") || el.hasAttribute("tabindex");
      if ((role === "generic" || CONTAINER_ROLES.has(role)) && !actionable) continue;
      const name = nameOf(el);
      if (!name) continue;
      kept.push({ el, role, name, rect });
    } catch {
      // A single hostile element must never cost us the whole snapshot.
    }
  }

  // Collapse nested clickables: keep the OUTERMOST element carrying a given name.
  //
  // The test must be "the ancestor says the SAME thing", not "the ancestor's text
  // contains mine". A search-result row is a container whose text contains every
  // link inside it, so a `includes` test deletes the actual results and leaves only
  // page chrome — which is exactly what it did to GitHub search and Stack Overflow.
  const INTERACTIVE = /^(link|button|checkbox|radio|tab|menuitem|option|disclosure)$/;
  const set = new Map(kept.map((k) => [k.el, k]));
  const outermost = kept.filter(({ el, name }) => {
    let p = el.parentElement;
    while (p) {
      const parent = set.get(p);
      if (parent && INTERACTIVE.test(parent.role)) {
        // Same label, or a label barely longer than ours — a wrapper, not a list.
        if (parent.name === name) return false;
        if (parent.name.includes(name) && parent.name.length <= name.length + 12) return false;
      }
      p = p.parentElement;
    }
    return true;
  });

  // --- emit ----------------------------------------------------------------

  const seen = new Map<string, number>();
  const elements = outermost.map(({ el, role, name, rect }, i) => {
    const key = `${role}|${name}`;
    const nth = seen.get(key) ?? 0;
    seen.set(key, nth + 1);

    const tag = el.tagName;
    const inputType = tag === "INPUT" ? (el as HTMLInputElement).type.toLowerCase() : "";
    const fillable =
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      (el as HTMLElement).isContentEditable ||
      (tag === "INPUT" && !/^(submit|button|reset|image)$/.test(inputType));

    const value = fillable ? clean((el as HTMLInputElement).value) : "";
    const st = stateOf(el);
    const ctx = ctxOf(el);

    return {
      eid: `e${i + 1}`,
      node: cache.id(el),
      role,
      name,
      ...(value ? { value } : {}),
      ...(ctx ? { ctx } : {}),
      ...(st ? { st } : {}),
      fp: `${role}|${name}|${nth}`,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      fillable,
    };
  });

  // Text that is ON SCREEN, not the first 1500 characters of the document.
  //
  // The old version returned the top of the page regardless of where the agent had
  // scrolled, so it could never confirm anything further down — after uploading a
  // resume it could not see the filename that had just appeared, and kept hunting
  // for the field it had already filled until the loop guard killed the run.
  const words: string[] = [];
  let textLength = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let textNode = walker.nextNode();
  while (textNode && textLength < 2000) {
    const value = (textNode.textContent ?? "").trim();
    const parent = textNode.parentElement;
    textNode = walker.nextNode();
    if (!value || !parent) continue;
    if (parent.closest("script,style,noscript,template")) continue;
    range.selectNodeContents(textNode ? parent : parent);
    const r = range.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
    words.push(value);
    textLength += value.length;
  }
  const text = words.join("\n").slice(0, 2000);

  return {
    url: location.href,
    title: document.title,
    viewport: {
      w: window.innerWidth,
      h: window.innerHeight,
      scrollY: Math.round(window.scrollY),
      maxScrollY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    },
    elements,
    text,
    contentHash: hash(location.pathname + elements.map((e) => e.fp).join("~") + text.slice(0, 200)),
    totalCandidates: all.length,
  };
}
