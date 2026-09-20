import type { Action, RawSnapshot } from "@jev-browser/shared";

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

/**
 * Everything the loop needs from a browser. One CDP implementation today; a
 * content-script implementation later swaps in without the loop changing.
 */
export interface Executor {
  /** Current page as a ranked-input snapshot, with live node identities. */
  snapshot(): Promise<RawSnapshot>;
  /**
   * Bulk visible text for extraction. Deliberately separate from `snapshot().text`,
   * which is capped small because it is sent to the decision model on EVERY step.
   * A `read` node needs the article; the step loop needs a preview.
   */
  pageText(maxChars?: number): Promise<string>;
  /** Semantic guard for a decision about `node`, or the page alone when null. */
  guardFor(node: number | null): Promise<Guard>;
  /**
   * Execute. MUST re-verify `guard` immediately before input — including after any
   * text generation, which can take seconds during which the page moves on.
   */
  act(action: Action, node: number | null, guard: Guard, text?: string): Promise<void>;
  /** Wait for the page to be worth observing again. */
  settle(node: number | null, isCombobox: boolean): Promise<void>;
  url(): string;
  close(): Promise<void>;
}
