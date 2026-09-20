import { fromEnv } from "@jev-browser/jev";
import { type Node, type Plan, type Questions, walk } from "@jev-browser/shared";

/**
 * The checks a regex cannot do, handed to JEV.
 *
 * Whether a success criterion is genuinely observable is a judgement — "the CRM
 * displays the list of leads" is observable and no word list reliably knows that.
 * This is exactly the shape JEV is for: a bounded question with a typed answer and a
 * calibrated probability. Every act node in a plan goes in ONE call.
 */
export interface JevPlanScore {
  slug: string;
  /** Fraction of act nodes whose success criterion is observable. */
  observableRate: number;
  vague: { id: string; success: string; p: number }[];
  /** 0-3 rubric: could a browser agent actually execute this plan? */
  achievable: number;
  costUsd: number;
  latencyMs: number;
}

const OBSERVABLE_THRESHOLD = 0.5;

export async function scorePlan(slug: string, plan: Plan): Promise<JevPlanScore> {
  const jev = fromEnv("openrouter");
  const acts = walk(plan.nodes).filter(
    (n): n is Extract<Node, { kind: "act" }> => n.kind === "act",
  );

  const questions: Questions = {
    achievable: {
      type: "score",
      instructions:
        "Could a browser agent that can only click, type, select, scroll and navigate " +
        "actually execute this plan on real websites?",
      criteria: [
        "no: steps assume abilities the agent does not have",
        "weak: several steps are vague or would get stuck",
        "ok: mostly executable, a step or two is underspecified",
        "strong: every step is concrete and executable",
      ],
    },
  };

  for (const [i, a] of acts.entries()) {
    questions[`obs_${i}`] = {
      type: "boolean",
      instructions:
        `Does this success criterion describe an OBSERVABLE state of a web page? ` +
        `Criterion: "${a.success}"`,
      criteria: {
        true: "it describes what would be visible on screen, so a model looking at the page could check it",
        false: "it merely restates the action taken, or is too vague to verify by looking at the page",
      },
    };
  }

  const r = await jev.evaluate({ goal: plan.goal, nodes: plan.nodes }, questions);

  const vague: JevPlanScore["vague"] = [];
  let observable = 0;
  for (const [i, a] of acts.entries()) {
    const ans = r.answers[`obs_${i}`];
    const p = ans && ans.type === "boolean" ? ans.probability : 0;
    if (p >= OBSERVABLE_THRESHOLD) observable++;
    else vague.push({ id: a.id, success: a.success, p });
  }

  const ach = r.answers.achievable;
  return {
    slug,
    observableRate: acts.length ? observable / acts.length : 1,
    vague,
    achievable: ach && ach.type === "score" ? ach.score : 0,
    costUsd: r.costUsd,
    latencyMs: r.latencyMs,
  };
}
