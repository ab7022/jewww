import type { Action, Risk } from "@jev-browser/shared";

/**
 * Everything the loop emits. The CLI prints these; the extension renders them in the
 * side panel; the server writes them to the step log. One vocabulary for all three.
 */
export type RunEvent =
  | { type: "plan"; nodes: number; sites: string[]; costUsd: number }
  | { type: "node:start"; id: string; kind: string; intent: string }
  | { type: "node:done"; id: string; detail?: string }
  | { type: "step"; nodeId: string; action: Action; operation: string; target?: string; confidence?: number; risk: Risk; latencyMs: number; costUsd: number }
  | { type: "text"; field: string; value: string; latencyMs: number; costUsd: number }
  | { type: "escalate"; nodeId: string; reason: string }
  | {
      type: "suspend";
      nodeId: string;
      reason: "confirm" | "handoff";
      preview: string;
      risk?: Risk;
      /** What it wanted to do, so the UI can word it rather than show internals. */
      action?: Action;
      target?: string;
    }
  | { type: "queued"; nodeId: string; preview: string; risk: Risk }
  /**
   * Emitted BEFORE waiting on the person, so the interface can actually ask.
   *
   * Without it the loop awaited an answer to a question nobody had been shown, and
   * the run hung on a prompt that existed only inside the runtime — the safety gate
   * silently becoming a deadlock.
   */
  | {
      type: "approval";
      nodeId: string;
      preview: string;
      risk: Risk;
      action?: Action;
      target?: string;
    }
  | { type: "asked"; nodeId: string; count: number; answered: number }
  /** Show mode: the cursor is pointing at what the person should do next. */
  | { type: "point"; nodeId: string; message: string; target?: string }
  | { type: "reused"; field: string; from: string }
  /** Something went wrong inside a node. `nodeId` is always set when one is known, so
   *  the interface never has to guess which step a warning belongs to. */
  | { type: "warn"; nodeId?: string; message: string }
  | { type: "finish"; status: RunStatus; steps: number; costUsd: number; elapsedMs: number };

/** "aborted" = the person pressed Stop; nothing further was done after it. */
export type RunStatus = "done" | "blocked" | "suspended" | "budget" | "aborted";

/**
 * An irreversible step that was queued instead of executed.
 *
 * Ten separate interruptions across a forty-minute run is a product nobody uses, and
 * suspending on the first one abandons the other nine. Gated steps are collected here
 * and reviewed once, which is the only shape in which "apply to 10 jobs" works.
 */
export interface GatedAction {
  nodeId: string;
  url: string;
  operation: string;
  target: string;
  risk: string;
  /** Loop item this belonged to, when it happened inside a foreach. */
  item?: unknown;
}

/** A field the agent could not fill from anything it knows. */
export interface MissingField {
  /** Stable key the answer is stored under, so it is reused next time. */
  key: string;
  /** The question as the page words it. */
  label: string;
  role: string;
  required: boolean;
}

/**
 * Identity and time, added by the runtime to every event it emits — never by the call
 * site, so no call site can get them wrong.
 *
 * Without them, a `foreach` re-entering the same node ids made iteration 2 inherit
 * iteration 1's end time, and the panel showed "−26223ms"; and timestamps were taken
 * whenever the UI's storage write got round to the event, not when it happened.
 */
export interface Stamp {
  /** Epoch ms, taken when the runtime emitted the event. */
  at: number;
  /**
   * Position inside enclosing loops, outermost first: "3" is the fourth item of a
   * foreach, "3.0" the first item of a loop nested in it. Absent outside any loop.
   * A node INSTANCE is `nodeId` + `iteration`; that, not the node id, is what a
   * timeline step is.
   */
  iteration?: string;
}

export type StampedEvent = RunEvent & Stamp;

export type Emit = (event: StampedEvent) => void;

/**
 * Ask the user for what the agent does not know.
 *
 * Returning a value for a key stores it for the rest of the run, so a question
 * answered on the first application is filled automatically on the next nine — which
 * is the difference between this being useful and being a form that asks you the same
 * thing ten times. Returning nothing leaves the field blank.
 */
export type Ask = (missing: MissingField[]) => Promise<Record<string, string>>;
