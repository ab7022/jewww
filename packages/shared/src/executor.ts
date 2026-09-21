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
  /**
   * Semantic guard for a decision about `node`, or the page alone when null.
   * `fp` lets a re-rendered element be re-found rather than reported as gone.
   */
  guardFor(node: number | null, fp?: string): Promise<Guard>;
  /**
   * Execute. MUST re-verify `guard` immediately before input — including after text
   * generation, which takes seconds during which the page moves on.
   */
  act(action: Action, node: number | null, guard: Guard, text?: string, fp?: string): Promise<void>;
  /**
   * Would `act` be able to perform this right now? Returns the reason it could not
   * (covered, read-only, disabled, gone…) or null. Performs no input.
   *
   * Exists so a person is never asked to approve something that cannot happen: the
   * gate used to come first, and LinkedIn's post-submit dialog produced five
   * approvals in a row for a click that was blocked every time.
   */
  preflight(action: Action, node: number | null, fp?: string): Promise<string | null>;
  /**
   * Show mode: move the agent's cursor to the element and outline it, with `message`
   * as its label — without touching it. Returns why it could not, or null.
   */
  point(node: number, message: string, fp?: string): Promise<string | null>;
  /** Wait for the page to be worth observing again. */
  settle(node: number | null, isCombobox: boolean): Promise<void>;
  /**
   * Where the driven tab is NOW. Async on purpose: the extension used to answer from a
   * cached value that was "" for a freshly opened tab, and the runtime — believing it
   * was on the wrong site — navigated away from the page the user was on.
   */
  url(): Promise<string>;
  close(): Promise<void>;
}

/**
 * What `preflight` / `act` refusals mean for the next decision. A refusal of one of
 * these kinds is a fact about the element as the page stands, not a judgement to
 * re-litigate, so the runtime withdraws that element until the page changes.
 */
export const PHYSICALLY_UNREACHABLE =
  /covered by|not visible|has no size|is disabled|left the document|not in the registry/i;
