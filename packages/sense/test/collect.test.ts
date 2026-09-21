// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { RawElement } from "@jev-browser/shared";
import { collectSnapshot } from "../src/collect.js";
import { rankElements, rankedSnapshot, rankOf, tokenize } from "../src/rank.js";

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

const byName = (s: { elements: RawElement[] }, n: string) =>
  s.elements.find((e) => e.name === n);

beforeEach(() => {
  stubLayout();
  document.body.innerHTML = "";
});

describe("collectSnapshot", () => {
  /**
   * `fillable` gates whether TYPE_TEXT is offered, so it must mean "can take text
   * now". AWS' console search is a read-only input acting as a button: offering it
   * as a typing target got it chosen and then refused by the resolver, when the
   * right move was always to click it.
   */
  it("does not offer read-only or disabled fields as typing targets", () => {
    document.body.innerHTML = `
      <label for="ro">Search</label><input id="ro" readonly value="prod">
      <label for="ar">Aria search</label><input id="ar" aria-readonly="true">
      <label for="dis">Disabled</label><input id="dis" disabled>
      <label for="ok">Normal</label><input id="ok">`;
    const s = collectSnapshot();
    expect(byName(s, "Search")?.fillable).toBe(false);
    expect(byName(s, "Aria search")?.fillable).toBe(false);
    expect(byName(s, "Disabled")?.fillable).toBe(false);
    expect(byName(s, "Normal")?.fillable).toBe(true);
  });

  it("still reports what a read-only field is displaying", () => {
    document.body.innerHTML = `<label for="ro">Region</label><input id="ro" readonly value="ap-south-1">`;
    expect(byName(collectSnapshot(), "Region")?.value).toBe("ap-south-1");
  });

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

describe("rankedSnapshot", () => {
  it("keeps the ranked selection but presents it in document order", () => {
    document.body.innerHTML = `
      <a href="/1">Alpha story</a>
      <a href="/2">Beta story</a>
      <a href="/3">Pricing</a>`;
    const raw = collectSnapshot();
    // Ranking floats "Pricing" to the top for this intent...
    expect(rankElements(raw, "open pricing")[0]?.name).toBe("Pricing");
    // ...but the snapshot the model sees must still run in page order, or an intent
    // like "open the first story" has no way to be answered.
    const snap = rankedSnapshot(raw, "open pricing");
    expect(snap.elements.map((e) => e.name)).toEqual(["Alpha story", "Beta story", "Pricing"]);
  });

  it("still drops everything past the cap", () => {
    document.body.innerHTML = Array.from({ length: 30 }, (_, i) => `<a href="/${i}">Link ${i}</a>`).join("");
    const snap = rankedSnapshot(collectSnapshot(), "link 7", 5);
    expect(snap.elements).toHaveLength(5);
  });
});

describe("dedupe", () => {
  it("keeps result links inside a container whose text contains them", () => {
    // GitHub/Stack Overflow shape: a clickable row wrapping the real result link.
    // A naive "parent text includes mine" rule deletes every result on the page.
    document.body.innerHTML = `
      <div role="listitem" onclick="x()">
        <a href="/a">How do I await a Playwright locator</a>
        <span>42 votes</span>
      </div>
      <div role="listitem" onclick="x()">
        <a href="/b">Why does my selector time out</a>
      </div>`;
    const names = collectSnapshot().elements.map((e) => e.name);
    expect(names).toContain("How do I await a Playwright locator");
    expect(names).toContain("Why does my selector time out");
  });

  it("still collapses a button wrapping its own label", () => {
    document.body.innerHTML = `<button><span>Submit application</span></button>`;
    const hits = collectSnapshot().elements.filter((e) => e.name.includes("Submit application"));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.role).toBe("button");
  });
});

describe("clickable containers", () => {
  it("collects a div the page styles as clickable", () => {
    // Modal close buttons are usually a bare div with a listener and cursor:pointer.
    // Nothing marks them up as controls, and without this the agent can see the link
    // it wants but not the overlay covering it.
    document.body.innerHTML = `<div id="bottomSheet-model-close" style="cursor:pointer">✕</div>`;
    const el = collectSnapshot().elements.find((e) => e.name === "✕");
    expect(el).toBeTruthy();
    expect(el?.role).toBe("button");
  });

  it("names an icon-only control from its id when it has no text", () => {
    document.body.innerHTML = `<div id="bottomSheet-model-close" style="cursor:pointer"><svg></svg></div>`;
    const names = collectSnapshot().elements.map((e) => e.name);
    expect(names.some((n) => n.includes("bottomSheet"))).toBe(true);
  });

  it("ignores a div that is not styled as clickable", () => {
    document.body.innerHTML = `<div id="plain">just text</div>`;
    expect(collectSnapshot().elements.find((e) => e.name === "just text")).toBeUndefined();
  });

  it("does not swallow the controls inside a clickable row", () => {
    document.body.innerHTML = `
      <div role="listitem" onclick="x()" style="cursor:pointer">
        <a href="/a">How do I await a Playwright locator</a>
      </div>`;
    const names = collectSnapshot().elements.map((e) => e.name);
    expect(names).toContain("How do I await a Playwright locator");
  });
});
