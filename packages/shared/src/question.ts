import { z } from "zod";

/**
 * Provider-neutral question and answer shapes.
 *
 * OpenRouter spells boolean "noul"; Vercel spells it "boolean". Neither dialect is
 * allowed out of packages/jev — everything above this line speaks the types below.
 */

export const BooleanQuestion = z.object({
  type: z.literal("boolean"),
  instructions: z.string(),
  criteria: z.object({ true: z.string().optional(), false: z.string().optional() }).optional(),
});

export const ChoiceQuestion = z.object({
  type: z.literal("choice"),
  instructions: z.string(),
  /** Option name -> what that option means. JEV caps this at 255 entries. */
  criteria: z.record(z.string(), z.string()),
});

export const ScoreQuestion = z.object({
  type: z.literal("score"),
  instructions: z.string(),
  /** Ordered lowest to highest, 2-10 rungs. */
  criteria: z.array(z.string()).min(2).max(10),
});

export const Question = z.discriminatedUnion("type", [
  BooleanQuestion,
  ChoiceQuestion,
  ScoreQuestion,
]);
export type Question = z.infer<typeof Question>;
export type Questions = Record<string, Question>;

/**
 * `confidence` is reported by Jev alongside the distribution and is NOT the same
 * number as the chosen option's probability — an observed response gave
 * probability 0.95 with confidence 0.91. Treat it as the model's own assessment of
 * the decision and the distribution as the spread over options.
 */
export const BooleanAnswer = z.object({
  type: z.literal("boolean"),
  probability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional(),
});
/**
 * Per the AI SDK reference, probability distributions are OPTIONAL on choice and
 * score answers and required only on boolean. The whole escalation threshold reads
 * these, so model the absence honestly instead of assuming they arrive.
 */
export const ChoiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export const ScoreAnswer = z.object({
  type: z.literal("score"),
  score: z.number(),
  probabilities: z.record(z.string(), z.number()).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const Answer = z.discriminatedUnion("type", [BooleanAnswer, ChoiceAnswer, ScoreAnswer]);
export type Answer = z.infer<typeof Answer>;

/** Maps each declared question to the answer shape it must produce. */
export type AnswerFor<Q extends Question> = Q extends { type: "boolean" }
  ? z.infer<typeof BooleanAnswer>
  : Q extends { type: "choice" }
    ? z.infer<typeof ChoiceAnswer>
    : z.infer<typeof ScoreAnswer>;

export type AnswersFor<Q extends Questions> = { [K in keyof Q]: AnswerFor<Q[K]> };

/**
 * Confidence in whatever the model actually picked, or undefined when the provider
 * did not return a distribution. Callers must decide what to do with undefined —
 * silently treating it as 0 would force an escalation on every step.
 */
export function confidenceOf(a: Answer): number | undefined {
  if (a.type === "boolean") return Math.max(a.probability, 1 - a.probability);
  if (a.type === "choice") return a.probabilities?.[a.choice];
  if (!a.probabilities) return undefined;
  const p = Object.values(a.probabilities);
  return p.length ? Math.max(...p) : undefined;
}

/**
 * Structural validation of a choice answer before anything acts on it.
 *
 * A malformed distribution must stop the step, not be coerced into an action: the
 * offered keys must match exactly, every number must be finite in [0, 1], the mass
 * must sum to 1, and the returned choice must actually be the argmax. Anything else
 * means we do not understand the response and must not execute it.
 */
export function validateChoice(
  answer: Answer | undefined,
  offered: readonly string[],
): asserts answer is Extract<Answer, { type: "choice" }> {
  if (!answer || answer.type !== "choice") throw new Error("expected a choice answer");
  const ids = new Set(offered);
  if (!ids.has(answer.choice)) throw new Error(`chose "${answer.choice}", which was not offered`);

  const probs = answer.probabilities;
  if (!probs) return; // distribution is optional; the choice itself is still usable

  const keys = Object.keys(probs);
  if (keys.length !== ids.size || keys.some((k) => !ids.has(k))) {
    throw new Error("probability keys do not match the offered options");
  }
  const values = Object.values(probs);
  if (answer.confidence !== undefined) values.push(answer.confidence);
  if (values.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) {
    throw new Error("probability outside [0,1] or not finite");
  }
  const total = Object.values(probs).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 0.02) throw new Error(`probabilities sum to ${total.toFixed(3)}, not 1`);
  const best = Math.max(...Object.values(probs));
  if ((probs[answer.choice] ?? 0) < best - 1e-6) {
    throw new Error("chosen option is not the most probable one");
  }
}
