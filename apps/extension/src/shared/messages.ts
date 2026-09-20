import type { Action, RawSnapshot } from "@jev-browser/shared";

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
  | { kind: "signOut" };

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
  log: string[];
  pending?: PendingApproval;
  status?: string;
  /** What the run produced, shown when it finishes. */
  result?: string;
}
