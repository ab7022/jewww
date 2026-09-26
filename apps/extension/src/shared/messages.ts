import type { Action, Mark, RawSnapshot } from "@jev-browser/shared";

/**
 * Typed messages between the three extension contexts. Every payload crosses a
 * process boundary as JSON, so nothing here may carry a function or a DOM node.
 */
export type ToContent =
  | { kind: "snapshot"; maxCandidates?: number }
  | { kind: "pageText"; maxChars?: number }
  | { kind: "guard"; node: number | null; fp?: string }
  | { kind: "act"; action: Action; node: number | null; guard: GuardPair; text?: string; fp?: string }
  | { kind: "preflight"; action: Action; node: number | null; fp?: string }
  | { kind: "point"; node: number; message: string; fp?: string }
  | { kind: "annotate"; marks: Mark[] }
  /** The agent's on-page cursor: hide it, or show the listening pill. */
  | { kind: "cursor"; hide?: boolean; listening?: boolean }
  | { kind: "settle"; node: number | null; isCombobox: boolean };

export interface GuardPair {
  pageKey: string | null;
  nodeGuard: string | null;
}

export type FromContent =
  | { ok: true; snapshot: RawSnapshot }
  | { ok: true; text: string }
  | { ok: true; guard: GuardPair }
  | { ok: true; refusal: string | null }
  | { ok: true; drawn: number; refused: string[] }
  | { ok: true }
  | { ok: false; error: string; stale?: boolean; unreachable?: boolean };

/** Panel <-> worker. */
export type ToWorker =
  | { kind: "start"; goal: string; tabId: number }
  | { kind: "approve"; approved: boolean }
  | { kind: "abort" }
  | { kind: "state" }
  | { kind: "account" }
  | { kind: "signIn" }
  | { kind: "signInDev" }
  | { kind: "signOut" }
  | { kind: "getProfile" }
  | { kind: "saveProfile"; fields: Record<string, string>; instructions: string }
  | { kind: "reset" }
  /** Answers to the questions a form asked; an empty value leaves that field blank. */
  | { kind: "answer"; values: Record<string, string> }
  /** The panel's microphone is taking a request: show the pill on the page. */
  | { kind: "listening"; on: boolean };

export type { HistoryEntry, PanelState, Question } from "./state.js";
