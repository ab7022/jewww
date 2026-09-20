import type { JevProvider } from "@jev-browser/jev";
import type { Questions } from "@jev-browser/shared";
import { validateChoice } from "@jev-browser/shared";

/**
 * What the user actually asked for, read from their own words.
 *
 * The agent should not interrupt someone who did not ask to be interrupted — they
 * gave it a task, and stopping before every button turns the run into a click-through
 * ritual that trains people to approve without reading. Equally, "fill these in but
 * do not submit" is an instruction, and a flag must never override it.
 *
 * So autonomy is derived from the goal rather than fixed in code, once per run.
 */
export const AUTONOMY = {
  full: "the user gave a task and did not ask to be consulted — carry it out, including any final action it requires",
  confirm: "the user asked to review, approve, or be asked before anything is finalised",
  never: "the user explicitly said not to submit, send, buy, post, or otherwise finalise anything",
} as const;
export type Autonomy = keyof typeof AUTONOMY;

export interface Constraints {
  autonomy: Autonomy;
  confidence: number;
  costUsd: number;
}

const INSTRUCTIONS = `Read the user's goal and decide how much authority they granted.

Judge only what the user wrote. Do not infer caution they did not ask for, and do not
ignore a restriction they did state. If they described a task without mentioning
review or approval, they expect it done.`;

export async function readConstraints(jev: JevProvider, goal: string): Promise<Constraints> {
  const questions: Questions = {
    autonomy: {
      type: "choice",
      instructions: `${INSTRUCTIONS}\n\nThe user's goal: "${goal}"`,
      criteria: { ...AUTONOMY },
    },
  };

  const r = await jev.evaluate({ goal }, questions);
  const answer = r.answers.autonomy;
  try {
    validateChoice(answer, Object.keys(AUTONOMY));
  } catch {
    // Unreadable answer: assume the cautious reading rather than acting freely.
    return { autonomy: "confirm", confidence: 0, costUsd: r.costUsd };
  }
  return {
    autonomy: answer.choice as Autonomy,
    confidence: answer.probabilities?.[answer.choice] ?? 1,
    costUsd: r.costUsd,
  };
}
