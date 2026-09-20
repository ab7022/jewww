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

export const BooleanAnswer = z.object({
  type: z.literal("boolean"),
  probability: z.number().min(0).max(1),
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
});
export const ScoreAnswer = z.object({
  type: z.literal("score"),
  score: z.number(),
  probabilities: z.record(z.string(), z.number()).optional(),
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
