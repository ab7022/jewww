import type { Action, Risk } from "@jev-browser/shared";

/**
 * What the panel renders.
 *
 * The worker used to flatten every event into a line of text, which threw away the
 * structure the UI needs: a plan is a sequence of steps, each with a state and a few
 * things that happened inside it. That is a timeline, not a log.
 */
export type StepStatus = "pending" | "running" | "done" | "failed" | "waiting";

export interface ActionLine {
  /** Plain language: "Clicked Apply", not `CLICK "Apply" p=0.93`. */
  text: string;
  /** Technical detail, shown only when someone asks for it. */
  detail?: string;
  kind: "act" | "type" | "navigate" | "note" | "problem";
}

/**
 * Internal phrasing, worded for a person.
 *
 * These strings were written for a terminal and leaked straight into the panel:
 * "covered by div#bottomSheet-model-close, re-observing" tells someone watching
 * their own browser nothing they can act on. The raw text is kept as the detail.
 */
export function humanize(message: string): ActionLine {
  const m = message.replace(/^[a-z0-9_-]+:\s*/i, "");

  if (/covered by/.test(m)) {
    return { kind: "problem", text: "Something was covering it — looking again", detail: m };
  }
  if (/page changed since the decision|page moved/.test(m)) {
    return { kind: "note", text: "The page changed — looking again", detail: m };
  }
  if (/gone, disabled, off-screen|element left the document|not in the registry/.test(m)) {
    return { kind: "problem", text: "That control disappeared", detail: m };
  }
  if (/page unchanged for/.test(m)) {
    return { kind: "problem", text: "Nothing changed after a few tries — giving up here", detail: m };
  }
  if (/no profile loaded/.test(m)) {
    return { kind: "problem", text: "No profile, so there was nothing to fill in", detail: m };
  }
  const filled = m.match(/filled (\d+)\/(\d+)(?:, left blank: (.*))?/);
  if (filled) {
    const [, done, total, blank] = filled;
    return {
      kind: "note",
      text: `Filled ${done} of ${total} fields${blank ? `, left ${blank.split(", ").length} for you` : ""}`,
      detail: blank,
    };
  }
  const read = m.match(/->\s*\$?\.?(\S+)\s*\((\d+) chars from (\S+)\)/);
  if (read) {
    const chars = Number(read[2]).toLocaleString();
    return { kind: "note", text: `Read ${chars} characters from the page`, detail: m };
  }
  const wrote = m.match(/^->\s*\$?\.?(\S+)$/);
  if (wrote) return { kind: "note", text: "Saved what it found", detail: m };

  const navigated = m.match(/^navigated to (\S+)$/);
  if (navigated) {
    try {
      return { kind: "navigate", text: `Opened ${new URL(navigated[1] ?? "").host.replace(/^www\./, "")}`, detail: m };
    } catch {
      return { kind: "navigate", text: "Opened a new page", detail: m };
    }
  }

  const attached = m.match(/^attached (.+)$/);
  if (attached) return { kind: "act", text: `Attached ${attached[1]}` };

  const iterations = m.match(/only (\d+) of (\d+) required iterations succeeded/);
  if (iterations) {
    return { kind: "problem", text: `Only ${iterations[1]} of ${iterations[2]} completed`, detail: m };
  }
  return { kind: "note", text: m };
}

export interface TimelineStep {
  id: string;
  title: string;
  kind: string;
  status: StepStatus;
  actions: ActionLine[];
  startedAt?: number;
  endedAt?: number;
  /** Shown on a step that is waiting for the person. */
  prompt?: { preview: string; risk: Risk; reason: "confirm" | "handoff" };
}

const host = (url: string): string => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const quote = (s: string, max = 44): string =>
  `“${s.length > max ? `${s.slice(0, max - 1)}…` : s}”`;

/**
 * An action as a person would describe it.
 *
 * `CLICK "Apply" p=0.93` is a debugging artefact. Someone watching wants to know
 * what just happened to their browser.
 */
export function phrase(
  operation: string,
  action: Action,
  target?: string,
): ActionLine {
  switch (action.kind) {
    case "click":
      return { kind: "act", text: target ? `Clicked ${quote(target)}` : "Clicked" };
    case "type":
      return {
        kind: "type",
        text: target ? `Typed into ${quote(target, 32)}` : "Typed",
      };
    case "select":
      return { kind: "act", text: `Chose ${quote(action.option)}${target ? ` in ${quote(target, 24)}` : ""}` };
    case "attach":
      return { kind: "act", text: `Attached ${action.file.split("/").pop() ?? "a file"}` };
    case "navigate":
      return { kind: "navigate", text: `Opened ${host(action.url)}`, detail: action.url };
    case "scroll":
      return { kind: "note", text: action.dir === "down" ? "Scrolled down" : "Scrolled up" };
    case "wait":
      return { kind: "note", text: "Waiting for the page" };
    case "done":
      return { kind: "note", text: "Finished this step" };
    case "blocked":
      return { kind: "problem", text: "Could not go further", detail: action.reason };
    default:
      return { kind: "note", text: operation.toLowerCase().replace(/_/g, " ") };
  }
}

/** A step's title, from the plan's own intent, trimmed to something readable. */
export function stepTitle(intent: string): string {
  const clean = intent.replace(/\s+/g, " ").trim();
  const first = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return first.length > 76 ? `${first.slice(0, 75)}…` : first;
}

export function elapsed(step: TimelineStep): string | null {
  if (!step.startedAt || !step.endedAt) return null;
  const ms = step.endedAt - step.startedAt;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
