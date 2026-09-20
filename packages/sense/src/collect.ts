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
export function collectSnapshot(maxCandidates = 2000): RawSnapshot {
  const SELECTOR = [
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

  const TAG_ROLE: Record<string, string> = {
    A: "link",
    BUTTON: "button",
    SELECT: "combobox",
    TEXTAREA: "textbox",
    SUMMARY: "disclosure",
    H1: "heading",
    H2: "heading",
    H3: "heading",
  };

  const INPUT_ROLE: Record<string, string> = {
    checkbox: "checkbox",
    radio: "radio",
    submit: "button",
    button: "button",
    reset: "button",
    file: "fileinput",
    range: "slider",
    email: "textbox",
    tel: "textbox",
    url: "textbox",
    search: "searchbox",
    password: "password",
    number: "spinbutton",
    date: "datepicker",
  };

  // Must tolerate non-strings: DOM clobbering means `form.value` can be an Element
  // when the form contains <input name="value">, and the same trick applies to any
  // property name. Arbitrary pages do this, sometimes on purpose.
  const clean = (s: unknown): string =>
    typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 120) : "";

  function roleOf(el: Element): string {
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

  function nameOf(el: Element): string {
    const aria = clean(el.getAttribute("aria-label"));
    if (aria) return aria;

    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const parts = by
        .split(/\s+/)
        .map((i) => clean(document.getElementById(i)?.textContent))
        .filter(Boolean);
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

  function visible(el: Element): DOMRect | null {
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
      const rect = visible(el);
      if (!rect) continue;
      const role = roleOf(el);
      // A bare [role] hook with no interactive meaning is noise.
      if (role === "generic" && !el.hasAttribute("onclick")) continue;
      const name = nameOf(el);
      if (!name) continue;
      kept.push({ el, role, name, rect });
    } catch {
      // A single hostile element must never cost us the whole snapshot.
    }
  }

  // Collapse nested clickables: keep the OUTERMOST element carrying a given name.
  const set = new Set(kept.map((k) => k.el));
  const outermost = kept.filter(({ el, name }) => {
    let p = el.parentElement;
    while (p) {
      if (set.has(p)) {
        const pn = nameOf(p);
        if (pn === name || pn.includes(name)) return false;
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

  const main = document.querySelector("main,article,[role=main]") ?? document.body;
  const text = clean((main as HTMLElement).innerText).slice(0, 1500);

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
