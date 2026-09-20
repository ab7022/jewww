import type { Action, RawSnapshot } from "@jev-browser/shared";
import type { TimelineStep } from "./timeline.js";

/**
 * Typed messages between the three extension contexts. Every payload crosses a
 * process boundary as JSON, so nothing here may carry a function or a DOM node.
 */
export type ToContent =
  | { kind: "snapshot"; maxCandidates?: number }
  | { kind: "pageText"; maxChars?: number }
  | { kind: "guard"; node: number | null; fp?: string }
  | { kind: "act"; action: Action; node: number | null; guard: GuardPair; text?: string; fp?: string }
  | { kind: "settle"; node: number | null; isCombobox: boolean };

export interface GuardPair {
  pageKey: string | null;
  nodeGuard: string | null;
}

export type FromContent =
  | { ok: true; snapshot: RawSnapshot }
  | { ok: true; text: string }
  | { ok: true; guard: GuardPair }
  | { ok: true }
  | { ok: false; error: string; stale?: boolean; unreachable?: boolean };

/** Panel <-> worker. */
export type ToWorker =
  | { kind: "start"; goal: string; tabId: number }
  | { kind: "approve"; approved: boolean }
  | { kind: "abort" }
  | { kind: "state" }
  | { kind: "signIn" }
  | { kind: "signInDev" }
  | { kind: "signOut" }
  | { kind: "getProfile" }
  | { kind: "saveProfile"; fields: Record<string, string>; instructions: string }
  | { kind: "reset" };

/** One finished run, kept so the panel can show what was done earlier. */
export interface HistoryEntry {
  id: string;
  goal: string;
  status: string;
  steps: number;
  credits: number;
  seconds: number;
  at: number;
}

export interface PendingApproval {
  preview: string;
  risk: string;
}

export interface PanelState {
  signedIn: boolean;
  /** Which sign-in the server offers. */
  auth?: { google: boolean; dev: boolean };
  email?: string;
  credits?: number;
  running: boolean;
  goal?: string;
  /** The plan as a timeline — what the panel actually renders. */
  steps: TimelineStep[];
  status?: "planning" | "running" | "done" | "blocked" | "suspended" | "budget" | "error";
  /** What the run produced, shown when it finishes. */
  result?: string;
  error?: string;
  /** Totals for the run, shown once it ends. */
  summary?: { steps: number; credits: number; seconds: number };
  /** Irreversible steps queued for review. */
  queued?: { preview: string; risk: string }[];
  /** Finished runs, newest first. Survives the service worker dying. */
  history?: HistoryEntry[];
}
