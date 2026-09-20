import { z } from "zod";

/**
 * The complete action vocabulary. The executor (Playwright today, a content script
 * later) implements exactly these and nothing else.
 */
export const Action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), eid: z.string() }),
  z.object({ kind: z.literal("type"), eid: z.string(), text: z.string(), submit: z.boolean().optional() }),
  z.object({ kind: z.literal("select"), eid: z.string(), option: z.string() }),
  z.object({ kind: z.literal("scroll"), dir: z.enum(["up", "down"]), amount: z.number().optional() }),
  z.object({ kind: z.literal("navigate"), url: z.string() }),
  z.object({ kind: z.literal("attach"), eid: z.string(), file: z.string() }),
  z.object({ kind: z.literal("wait"), ms: z.number() }),
  z.object({ kind: z.literal("done"), summary: z.string().optional() }),
  z.object({ kind: z.literal("blocked"), reason: z.string() }),
]);
export type Action = z.infer<typeof Action>;

/** Consequence classes. Anything but "none" must pass a human gate. */
export const RISK = {
  none: "reversible navigation, reading, scrolling, or filtering",
  money: "a purchase, payment, transfer, or subscription",
  message: "sending an email, DM, post, comment, or application",
  destroy: "deleting or permanently removing data",
  settings: "changing account, privacy, or security settings",
  auth: "signing in, signing out, or entering credentials",
} as const;
export type Risk = keyof typeof RISK;

/**
 * Why the agent had to stop and hand the browser back.
 *
 * These are ordinary outcomes, not errors — roughly half of enterprise ATS postings
 * require an account, and a run that stops there is behaving correctly. The model
 * classifies this from the page rather than a word list, because a word list only
 * covers the sites whoever wrote it happened to look at.
 */
export const BLOCKER = {
  none: "nothing is blocking progress",
  captcha: "an active CAPTCHA or human-verification challenge must be solved",
  account_required: "an account must be created before continuing",
  login_required: "the user must sign in before continuing",
  credentials: "a password, card number, or other secret must be entered",
  paywall: "payment is required to continue",
  unsupported: "the page needs an interaction this agent cannot perform",
} as const;
export type Blocker = keyof typeof BLOCKER;

/** Blockers the agent must never attempt to get past itself. */
export const MUST_HAND_OFF: readonly Blocker[] = [
  "captcha",
  "account_required",
  "login_required",
  "credentials",
  "paywall",
];

/**
 * The one deliberate hard-coded check in the system.
 *
 * Everything else about risk is now a model judgement, because word lists do not
 * generalise. This does not become one — not because a model cannot classify a
 * password field, but because this gate has to hold WHEN THE MODEL IS WRONG or when
 * the page has manipulated it. A secret typed into the wrong box cannot be undone,
 * and no amount of calibration justifies making that outcome reachable.
 */
export const FORBIDDEN_FIELD =
  /\b(password|passwd|cvv|cvc|card.?number|ssn|social.?security|otp|2fa|mfa|\bpin\b)\b/i;
