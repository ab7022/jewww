import type { Action } from "./action.js";
import type { RawSnapshot } from "./snapshot.js";

/**
 * The browser contract.
 *
 * It lives in `shared`, not in `packages/executor`, because both implementations
 * depend on it and only one of them can exist in a given runtime: the CDP driver
 * imports Playwright, which must never reach an extension bundle. Keeping the
 * interface here lets the extension implement it without pulling Node code in.
 */

/** Semantic state that must not have changed between deciding and acting. */
export interface Guard {
  pageKey: string | null;
  nodeGuard: string | null;
}

/** A decision no longer refers to the page it was made about. */
export class StalePage extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StalePage";
  }
}

/** The target is gone, disabled, off-screen, or covered by something else. */
export class UnreachableTarget extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreachableTarget";
  }
}

export interface Executor {
  /** Current page as a snapshot, with live node identities. */
  snapshot(): Promise<RawSnapshot>;
  /**
   * Bulk visible text for extraction. Separate from `snapshot().text`, which is
   * capped small because it goes to the decision model on EVERY step — a `read`
   * node needs the article, the step loop needs a preview.
   */
  pageText(maxChars?: number): Promise<string>;
  /** Semantic guard for a decision about `node`, or the page alone when null. */
  guardFor(node: number | null): Promise<Guard>;
  /**
   * Execute. MUST re-verify `guard` immediately before input — including after text
   * generation, which takes seconds during which the page moves on.
   */
  act(action: Action, node: number | null, guard: Guard, text?: string): Promise<void>;
  /** Wait for the page to be worth observing again. */
  settle(node: number | null, isCombobox: boolean): Promise<void>;
  url(): string;
  close(): Promise<void>;
}
