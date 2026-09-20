// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { collectSnapshot } from "../src/collect.js";
import { rankElements, rankOf, tokenize } from "../src/rank.js";

/**
 * happy-dom lays nothing out, so every rect is 0x0 and the visibility filter would
 * drop everything. Stub geometry: elements get a plausible rect, and anything marked
 * data-hidden gets a zero one so we can still exercise the filter.
 */
function stubLayout() {
  let y = 0;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.hasAttribute("data-zero")) return new DOMRect(0, 0, 0, 0);
    y += 40;
    return new DOMRect(10, y % 1600, 200, 30);
  };
}

const byName = (s: { elements: { name: string; role: string; eid: string }[] }, n: string) =>
  s.elements.find((e) => e.name === n);

beforeEach(() => {
  stubLayout();
  document.body.innerHTML = "";
});

describe("collectSnapshot", () => {
  it("names inputs from their <label for>", () => {
    document.body.innerHTML = `
      <form>
        <label for="em">Email address</label><input id="em" type="email">
        <label for="ph">Phone</label><input id="ph" type="tel">
      </form>`;
    const s = collectSnapshot();
    expect(byName(s, "Email address")?.role).toBe("textbox");
    expect(byName(s, "Phone")).toBeTruthy();
  });

  it("falls back through aria-label, placeholder, then text", () => {
    document.body.innerHTML = `
      <button aria-label="Close dialog"><svg></svg></button>
      <input type="text" placeholder="Search jobs">
      <a href="/x">Read more</a>`;
    const s = collectSnapshot();
    expect(byName(s, "Close dialog")).toBeTruthy();
    expect(byName(s, "Search jobs")?.role).toBe("textbox");
    expect(byName(s, "Read more")?.role).toBe("link");
  });

  it("picks up the sibling-div label pattern ATS forms use", () => {
    document.body.innerHTML = `<div><div>Years of experience</div><input type="text"></div>`;
    const s = collectSnapshot();
    expect(byName(s, "Years of experience")).toBeTruthy();
  });

  it("collapses a nested clickable to its outermost named ancestor", () => {
    document.body.innerHTML = `<button><span>Submit application</span></button>`;
    const s = collectSnapshot();
    const hits = s.elements.filter((e) => e.name.includes("Submit application"));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.role).toBe("button");
  });

  it("drops zero-size and display:none elements", () => {
    document.body.innerHTML = `
      <button data-zero>Invisible</button>
      <button style="display:none">Hidden</button>
      <button>Visible</button>`;
    const s = collectSnapshot();
    expect(byName(s, "Invisible")).toBeUndefined();
    expect(byName(s, "Hidden")).toBeUndefined();
    expect(byName(s, "Visible")).toBeTruthy();
  });

  it("marks fillable controls and excludes buttons", () => {
    document.body.innerHTML = `
      <label for="a">Full name</label><input id="a" type="text">
      <button>Send</button>`;
    const s = collectSnapshot();
    expect(s.elements.find((e) => e.name === "Full name")?.fillable).toBe(true);
    expect(s.elements.find((e) => e.name === "Send")?.fillable).toBe(false);
  });

  it("records required state and form context", () => {
    document.body.innerHTML = `
      <form aria-label="Application">
        <label for="a">Full name</label><input id="a" required>
      </form>`;
    const el = byName(collectSnapshot(), "Full name") as { st?: string; ctx?: string };
    expect(el.st).toContain("required");
    expect(el.ctx).toBe("form: Application");
  });

  it("survives DOM clobbering, where form.value is an element not a string", () => {
    // Real page (npmjs.com) crashed the collector this way.
    document.body.innerHTML = `
      <form role="search">
        <label for="q">Search packages</label><input id="q" name="value" type="text">
      </form>`;
    const s = collectSnapshot();
    expect(byName(s, "Search packages")).toBeTruthy();
  });

  it("changes contentHash when the page changes, not when it does not", () => {
    document.body.innerHTML = `<button>One</button>`;
    const a = collectSnapshot().contentHash;
    stubLayout();
    const b = collectSnapshot().contentHash;
    document.body.innerHTML = `<button>Two</button>`;
    stubLayout();
    const c = collectSnapshot().contentHash;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("rank", () => {
  it("drops stopwords when tokenizing an intent", () => {
    expect([...tokenize("click the Submit button for a job")]).toEqual(["submit", "job"]);
  });

  it("floats intent-matching elements to the top", () => {
    document.body.innerHTML = `
      <a href="/1">Careers</a>
      <a href="/2">Privacy policy</a>
      <a href="/3">Pricing</a>`;
    const raw = collectSnapshot();
    expect(rankElements(raw, "open the pricing page")[0]?.name).toBe("Pricing");
  });

  it("reports where the target landed so recall is measurable", () => {
    document.body.innerHTML = `<button>Alpha</button><button>Beta</button>`;
    const raw = collectSnapshot();
    const beta = raw.elements.find((e) => e.name === "Beta");
    expect(rankOf(raw, "click beta", beta?.eid ?? "")).toBe(0);
    expect(rankOf(raw, "anything", "nope")).toBe(-1);
  });
});
