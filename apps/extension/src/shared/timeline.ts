import type { StampedEvent } from "@jev-browser/runtime";
import type { Action } from "@jev-browser/shared";

import type { ActionLine, TimelineStep } from "./state.js";

export type { ActionLine, StepStatus, TimelineStep } from "./state.js";

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
    // The occluder is now described by role and name, which is worth showing:
    // "Blocked by dialog \u201cFamiliar and easier access control\u201d" tells the
    // person watching exactly which thing to dismiss. Anonymous DOM fallbacks
    // ("covered by div") stay behind the vaguer wording.
    const what = /covered by (.+?)(?:,\s|$)/.exec(m)?.[1];
    if (what && /[\u201c"]|^an? /.test(what)) {
      return { kind: "problem", text: `Blocked by ${what}`, detail: m };
    }
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

/**
 * How long a step took. Both timestamps come from the runtime, and `endedAt` is
 * cleared whenever a loop re-enters the step — so there is no path to a negative.
 */
export function elapsed(step: TimelineStep): string | null {
  if (step.startedAt === undefined || step.endedAt === undefined) return null;
  const ms = step.endedAt - step.startedAt;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Fold one run event into the timeline the panel renders.
 *
 * Pure: time comes from the event (`at`, stamped by the runtime), and so does the
 * step it belongs to (`nodeId`). The previous reducer read the clock itself, at
 * whatever moment storage got round to it, and attributed warnings to "whichever step
 * looks current" — which is how a loop's second pass showed "−26223ms".
 */
export function applyEvent(steps: TimelineStep[], e: StampedEvent): TimelineStep[] {
  const next = steps.map((s) => ({ ...s, actions: [...s.actions] }));
  const byId = (id: string | undefined) => (id ? next.find((s) => s.id === id) : undefined);
  const running = () => next.find((s) => s.status === "running");

  switch (e.type) {
    case "node:start": {
      // The interpreter is sequential: whatever was running when this began is over.
      for (const s of next) {
        if (s.status === "running" && s.id !== e.id) {
          s.status = "done";
          s.endedAt = Math.max(e.at, s.startedAt ?? e.at);
        }
      }
      const existing = byId(e.id);
      const fresh: TimelineStep = {
        id: e.id,
        title: stepTitle(e.intent),
        kind: e.kind,
        status: "running",
        // A loop re-enters the same node; keep one step and let actions accumulate.
        actions: existing?.actions ?? [],
        startedAt: e.at,
        ...(e.iteration !== undefined ? { iteration: e.iteration } : {}),
      };
      // Replaced, not merged: a merge kept the previous pass's `endedAt`.
      if (existing) next[next.indexOf(existing)] = fresh;
      else next.push(fresh);
      return next;
    }

    case "node:done": {
      const step = byId(e.id);
      if (step) {
        if (step.status !== "waiting") step.status = "done";
        step.endedAt = Math.max(e.at, step.startedAt ?? e.at);
        if (e.detail) step.actions.push(humanize(e.detail));
      }
      return next;
    }

    case "step": {
      const step = byId(e.nodeId) ?? running();
      if (step && e.action.kind !== "done") step.actions.push(phrase(e.operation, e.action, e.target));
      return next;
    }

    case "text": {
      const step = running();
      // Show what was actually typed: seeing the value is the point of watching.
      if (step) {
        const last = step.actions[step.actions.length - 1];
        const line = {
          kind: "type" as const,
          text: `Typed ${JSON.stringify(e.value.slice(0, 40))} into “${e.field}”`,
        };
        if (last?.kind === "type") step.actions[step.actions.length - 1] = line;
        else step.actions.push(line);
      }
      return next;
    }

    case "reused":
      running()?.actions.push({ kind: "note", text: `Reused your earlier answer for “${e.field}”` });
      return next;

    case "queued":
      byId(e.nodeId)?.actions.push({ kind: "note", text: `Held back for you: ${e.preview}` });
      return next;

    case "explain":
      byId(e.nodeId)?.actions.push(
        { kind: "note", text: e.summary },
        ...e.notes.map((x) => ({ kind: "act" as const, text: `${x.n}. ${x.note}`, detail: x.target })),
      );
      return next;

    case "point":
      byId(e.nodeId)?.actions.push({ kind: "act", text: `Showed you: ${e.message}` });
      return next;

    case "asked":
      byId(e.nodeId)?.actions.push({
        kind: "note",
        text: `You answered ${e.answered} of ${e.count} question${e.count === 1 ? "" : "s"}`,
      });
      return next;

    case "warn":
      (byId(e.nodeId) ?? running())?.actions.push(humanize(e.message));
      return next;

    case "approval":
    case "suspend": {
      const step = byId(e.nodeId) ?? running();
      if (step) {
        step.status = "waiting";
        step.prompt = {
          preview: e.action ? phrase("", e.action, e.target).text : e.preview,
          risk: e.risk ?? "none",
          reason: e.type === "suspend" ? e.reason : "confirm",
        };
      }
      return next;
    }

    case "finish":
      // Anything still running when the loop ends did not finish.
      for (const s of next) {
        if (s.status === "running") {
          s.status = e.status === "done" ? "done" : "failed";
          s.endedAt = Math.max(e.at, s.startedAt ?? e.at);
        }
      }
      return next;

    default:
      return next;
  }
}
