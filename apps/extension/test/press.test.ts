// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { pressAt } from "../src/content/press.js";

/**
 * `target.click()` fires a lone `click` event. A large share of the web decides on
 * `pointerdown` or `mousedown` instead — jsaction (all of Google), menus, drag-aware
 * widgets — and never saw it. The executor reported success and the page did nothing,
 * so these assert the whole sequence, not just that something fired.
 */
describe("pressAt", () => {
  const press = (el: HTMLElement) => pressAt(el, el, 10, 10);

  it("fires the events a real mouse fires, in order", () => {
    const el = document.createElement("div");
    document.body.append(el);
    const seen: string[] = [];
    for (const t of ["pointerover", "mouseover", "mousemove", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.addEventListener(t, () => seen.push(t));
    }
    press(el);
    expect(seen).toEqual([
      "pointerover", "mouseover", "mousemove",
      "pointerdown", "mousedown", "pointerup", "mouseup", "click",
    ]);
  });

  it("reaches a mousedown-only handler — the Google Forms case", () => {
    const el = document.createElement("div");
    document.body.append(el);
    let fired = 0;
    el.addEventListener("mousedown", () => { fired += 1; });
    press(el);
    expect(fired).toBe(1);
  });

  it("bubbles to a delegated ancestor listener", () => {
    const tile = document.createElement("div");
    const caption = document.createElement("span");
    tile.append(caption);
    document.body.append(tile);
    const seen: string[] = [];
    tile.addEventListener("mousedown", () => seen.push("mousedown"));
    tile.addEventListener("click", () => seen.push("click"));
    pressAt(caption, caption, 10, 10);
    expect(seen).toEqual(["mousedown", "click"]);
  });

  it("carries the point and the primary button", () => {
    const el = document.createElement("div");
    document.body.append(el);
    let ev: MouseEvent | undefined;
    el.addEventListener("mousedown", (e) => { ev = e as MouseEvent; });
    pressAt(el, el, 42, 99);
    expect([ev?.clientX, ev?.clientY, ev?.button, ev?.buttons]).toEqual([42, 99, 0, 1]);
  });

  it("focuses the target without throwing on an unfocusable one", () => {
    const input = document.createElement("input");
    document.body.append(input);
    press(input);
    expect(document.activeElement).toBe(input);
    expect(() => press(document.createElement("div"))).not.toThrow();
  });
});
