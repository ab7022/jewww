import type { SnapshotElement } from "@jev-browser/shared";

/**
 * One index per element, with a SEPARATE target set per operation.
 *
 * This is the point of the whole file: `click_target` contains only clickable
 * elements and `type_text_target` only editable ones, so choosing to type into a
 * button is not unlikely — it is unrepresentable. A single shared target list makes
 * that error merely improbable, which is a much weaker guarantee for free.
 */
export type Operation =
  | "CLICK"
  | "TYPE_TEXT"
  | "SELECT"
  | "SCROLL_DOWN"
  | "SCROLL_UP"
  | "WAIT"
  | "DONE"
  | "BLOCKED";

export interface TargetEntry {
  eid: string;
  node: number;
  role: string;
  label: string;
  value?: string;
  state?: string;
  /** For SELECT only: the option value to set. */
  option?: string;
}

export interface ActionSpace {
  elements: SnapshotElement[];
  targets: Partial<Record<"CLICK" | "TYPE_TEXT" | "SELECT", Record<string, TargetEntry>>>;
  operations: Record<string, string>;
}

const EDITABLE = /^(textbox|searchbox|spinbutton|combobox|datepicker)$/;

const OPERATION_LABEL: Record<string, string> = {
  CLICK: "Click an element: a button, link, menu option, autocomplete suggestion, or calendar day.",
  TYPE_TEXT: "Enter or replace text in an editable field. A small model supplies the value from the goal.",
  SELECT: "Choose a value in an observed native dropdown.",
  SCROLL_DOWN: "Reveal content below the current viewport.",
  SCROLL_UP: "Reveal content above the current viewport.",
  WAIT: "The needed control is absent or disabled, or submitted results are still loading.",
  DONE: "Every requirement of the subgoal is visibly satisfied on this page.",
  BLOCKED: "No supported operation can make progress here.",
};

export function buildActionSpace(
  elements: SnapshotElement[],
  nodes: Record<string, number>,
  opts: { canScrollDown: boolean; canScrollUp: boolean },
): ActionSpace {
  const targets: ActionSpace["targets"] = {};
  const put = (op: "CLICK" | "TYPE_TEXT" | "SELECT", key: string, entry: TargetEntry) => {
    (targets[op] ??= {})[key] = entry;
  };

  for (const e of elements) {
    const node = nodes[e.eid];
    if (node === undefined) continue;
    const base: TargetEntry = {
      eid: e.eid,
      node,
      role: e.role,
      label: e.name,
      ...(e.value !== undefined ? { value: e.value } : {}),
      ...(e.st !== undefined ? { state: e.st } : {}),
    };

    if (e.role === "combobox" && e.value !== undefined && !EDITABLE.test(e.role)) {
      put("SELECT", e.eid, base);
      continue;
    }
    if (EDITABLE.test(e.role) && !e.st?.includes("disabled")) {
      put("TYPE_TEXT", e.eid, base);
      // An editable control can also just be OPENED — a date field or an autocomplete
      // often wants a click first. Offering both lets the model say which it meant.
      put("CLICK", e.eid, { ...base, label: `Open ${e.name}` });
      continue;
    }
    put("CLICK", e.eid, base);
  }

  const operations: Record<string, string> = {};
  for (const op of ["CLICK", "TYPE_TEXT", "SELECT"] as const) {
    if (targets[op] && Object.keys(targets[op]).length) operations[op] = OPERATION_LABEL[op] ?? op;
  }
  if (opts.canScrollDown) operations.SCROLL_DOWN = OPERATION_LABEL.SCROLL_DOWN ?? "";
  if (opts.canScrollUp) operations.SCROLL_UP = OPERATION_LABEL.SCROLL_UP ?? "";
  operations.WAIT = OPERATION_LABEL.WAIT ?? "";
  operations.DONE = OPERATION_LABEL.DONE ?? "";
  operations.BLOCKED = OPERATION_LABEL.BLOCKED ?? "";

  return { elements, targets, operations };
}

export function targetHeadName(op: string): string {
  return `${op.toLowerCase()}_target`;
}

export function describeTarget(t: TargetEntry): string {
  const bits = [`${t.role}: ${t.label}`];
  if (t.value) bits.push(`= ${t.value}`);
  if (t.state) bits.push(`[${t.state}]`);
  return bits.join(" ");
}
