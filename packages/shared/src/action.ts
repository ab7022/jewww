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
 * Deterministic backstop. Runs on the element name regardless of what the model
 * answered, so a page that talks JEV into `risk: none` still cannot get past it.
 */
export const IRREVERSIBLE_NAME = /\b(pay|buy|purchase|order|checkout|submit|apply|send|post|publish|delete|remove|cancel|confirm|subscribe|transfer|withdraw)\b/i;

/** Never typed into, by anything, ever. */
export const FORBIDDEN_FIELD = /\b(password|passwd|cvv|cvc|card.?number|ssn|social.?security|otp|2fa|mfa|pin)\b/i;
