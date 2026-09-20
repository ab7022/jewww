// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { resolvePoint } from "../src/browser.js";
import { collectSnapshot } from "../src/collect.js";

/**
 * A refusal is only useful if the decision can act on it. "covered by div" is a fact
 * with no lead in it — the model cannot find a tag name in its action space, so it
 * re-picked the same covered target and refused again. These assert the occluder is
 * named the way the snapshot names everything else: by role and accessible name.
 */
describe("occlusion refusals name what is in the way", () => {
  // happy-dom lays nothing out, so give everything a plausible rect.
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      return new DOMRect(10, 10, 200, 30);
    };
    document.body.innerHTML = "";
  });

  /** Register the target, then resolve it with `top` sitting on top of it. */
  function refuse(top: Element): string {
    const snap = collectSnapshot();
    const node = snap.elements.find((e) => e.name === "Open Form title")?.node;
    expect(node, "target was not collected").toBeTypeOf("number");
    document.elementFromPoint = () => top;
    const r = resolvePoint(node as number, "click");
    return "refused" in r ? r.refused : "not refused";
  }

  function target() {
    const b = document.createElement("button");
    b.textContent = "Open Form title";
    document.body.append(b);
  }

  it("names a covering dialog by its accessible name", () => {
    target();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Familiar and easier access control");
    document.body.append(dialog);

    expect(refuse(dialog)).toBe("covered by dialog “Familiar and easier access control”");
  });

  it("finds the open modal when the topmost element is an anonymous backdrop", () => {
    target();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Got it");
    const backdrop = document.createElement("div"); // a sibling of the dialog, not its parent
    document.body.append(dialog, backdrop);

    expect(refuse(backdrop)).toBe("covered by an overlay, with the dialog “Got it” open");
  });

  it("does not quote a container's run-together text as its name", () => {
    target();
    // AWS' services menu: an unlabelled nav column whose textContent is every link
    // in it. `nameOf` happily returns that, and the refusal became unreadable.
    const column = document.createElement("div");
    for (const t of ["Analytics", "Application Integration", "Blockchain", "Compute"]) {
      const a = document.createElement("a");
      a.textContent = t;
      column.append(a);
    }
    document.body.append(column);

    const refusal = refuse(column);
    expect(refusal).not.toMatch(/Analytics Application Integration/);
    expect(refusal).toBe("covered by div");
  });

  it("falls back to the DOM description when nothing is nameable", () => {
    target();
    // No id, no text, no aria: `nameOf` has nothing to offer, so the refusal keeps
    // the old DOM wording rather than inventing a name.
    const plain = document.createElement("div");
    document.body.append(plain);

    expect(refuse(plain)).toBe("covered by div");
  });
});
