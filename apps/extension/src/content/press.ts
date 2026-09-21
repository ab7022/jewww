/**
 * Click the way a mouse does.
 *
 * This used to be `target.click()`, which fires a lone `click` event and nothing
 * else — no hover, no pointerdown, no mousedown, no focus. A large share of the
 * web never sees it: jsaction (all of Google), most drag-aware widgets, menus
 * that open on pointerdown, and anything that decides on mousedown. The click
 * returned `ok: true` and the page did nothing, so the model saw an unchanged
 * page, assumed the target was wrong, and went looking for another one — which is
 * why Google Forms ended up typing "Blank form" into the search bar.
 *
 * The CDP driver never had this bug because CDP dispatches real input. That is the
 * point worth remembering: one `Executor` contract with two implementations will
 * drift exactly here, in the part the interface does not describe.
 *
 * Events go to the element actually under the point so they bubble the real path;
 * focus goes to the resolved target, which is the thing a user would be focusing.
 */
export function pressAt(hit: HTMLElement, target: HTMLElement, x: number, y: number): void {
  // `x`/`y` are top-viewport coordinates. An element inside a frame is in another
  // window: its events carry THAT window as their view, coordinates local to it, and
  // are built from its own constructors.
  const view = (hit.ownerDocument.defaultView ?? window) as typeof window;
  const local = toLocal(view, x, y);
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
    clientX: local.x,
    clientY: local.y,
    button: 0,
    detail: 1,
  };
  const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };
  const { PointerEvent, MouseEvent } = view;

  // Hover first: menus and tiles that reveal their real target on hover need it.
  hit.dispatchEvent(new PointerEvent("pointerover", { ...pointer, buttons: 0 }));
  hit.dispatchEvent(new MouseEvent("mouseover", { ...base, buttons: 0 }));
  hit.dispatchEvent(new MouseEvent("mousemove", { ...base, buttons: 0 }));

  hit.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
  hit.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));

  // A real mousedown focuses unless the handler prevented it. Doing it here keeps
  // blur-driven widgets (comboboxes, date pickers) behaving as they do for a user.
  try {
    target.focus({ preventScroll: true });
  } catch {
    // Not focusable. Not a failure.
  }

  hit.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
  hit.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
  hit.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
}

/** A top-viewport point, in the coordinates of a (possibly nested) frame's window. */
function toLocal(view: Window, x: number, y: number): { x: number; y: number } {
  let lx = x;
  let ly = y;
  const chain: HTMLElement[] = [];
  for (let v: Window | null = view; v && v !== window.top && v.frameElement; ) {
    chain.push(v.frameElement as HTMLElement);
    v = (v.frameElement as HTMLElement).ownerDocument.defaultView;
  }
  for (const frame of chain.reverse()) {
    const r = frame.getBoundingClientRect();
    lx -= r.left + frame.clientLeft;
    ly -= r.top + frame.clientTop;
  }
  return { x: lx, y: ly };
}
