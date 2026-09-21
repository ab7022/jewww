import { Plan } from "@jev-browser/shared";
import type { JevProvider } from "@jev-browser/jev";
import { coerceNodes, type Normalisation, normalizePlan } from "./normalize.js";
import { type ChatResult, chat, DEFAULT_PLANNER_MODEL } from "./llm.js";
import { type Known, SYSTEM_PROMPT, userPrompt } from "./prompt.js";

export { SYSTEM_PROMPT, DEFAULT_PLANNER_MODEL };
export { compose, extract } from "./extract.js";
export { explain } from "./explain.js";
export { extractDetails } from "./details.js";
export { normalizePlan, type Normalisation } from "./normalize.js";
export type { ChatResult };

export interface PlanResult {
  plan: Plan;
  /** Canonicalisations applied after parsing. Reported, never silent. */
  normalised: Normalisation[];
  raw: string;
  usage: ChatResult["usage"];
  costUsd: number;
  model: string;
  latencyMs: number;
  /** True when the first response failed validation and was repaired. */
  repaired: boolean;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in response");
  return JSON.parse(body.slice(start, end + 1));
}

export async function makePlan(opts: {
  apiKey: string;
  goal: string;
  start: string;
  model?: string;
  /** When supplied, the plan is canonicalised by asking JEV what each step is. */
  jev?: JevProvider;
  /**
   * Standing instructions the user saved in their details: tone, defaults, things to
   * always or never do. Trusted — they are the user's own words, like the goal — and
   * loaded on every run, so they are the place a preference outlives one prompt.
   */
  instructions?: string | undefined;
  /** What the user has on file, so the plan does not rely on things that do not exist. */
  known?: Known | undefined;
}): Promise<PlanResult> {
  const model = opts.model ?? DEFAULT_PLANNER_MODEL;
  const first = await chat({
    apiKey: opts.apiKey,
    model,
    system: SYSTEM_PROMPT,
    user: userPrompt(opts.goal, opts.start, opts.instructions, opts.known),
  });

  const parsed = Plan.safeParse(coerceNodes(tryExtract(first.text)));
  if (parsed.success) {
    const norm = await canonicalise(parsed.data, opts.jev, opts.known?.resume ?? true);
    return {
      ...toResult(first),
      plan: norm.plan,
      normalised: norm.changes,
      costUsd: first.costUsd + norm.costUsd,
      repaired: false,
    };
  }

  // One repair attempt, handing back the exact validation errors.
  const second = await chat({
    apiKey: opts.apiKey,
    model,
    system: SYSTEM_PROMPT,
    user:
      `${userPrompt(opts.goal, opts.start)}\n\nYour previous answer failed validation:\n` +
      `${JSON.stringify(parsed.error.issues.slice(0, 12), null, 2)}\n\n` +
      `Previous answer:\n${first.text.slice(0, 4000)}\n\nReturn corrected JSON only.`,
  });

  const norm = await canonicalise(Plan.parse(coerceNodes(tryExtract(second.text))), opts.jev, opts.known?.resume ?? true);
  return {
    plan: norm.plan,
    normalised: norm.changes,
    raw: second.text,
    usage: {
      inputTokens: first.usage.inputTokens + second.usage.inputTokens,
      outputTokens: first.usage.outputTokens + second.usage.outputTokens,
    },
    costUsd: first.costUsd + second.costUsd + norm.costUsd,
    model: second.model,
    latencyMs: first.latencyMs + second.latencyMs,
    repaired: true,
  };
}

async function canonicalise(plan: Plan, jev: JevProvider | undefined, canAttach: boolean) {
  if (!jev) return { plan, changes: [] as Normalisation[], costUsd: 0 };
  // A failure here must not lose a usable plan — canonicalisation is an improvement,
  // not a precondition.
  return normalizePlan(jev, plan, canAttach).catch(() => ({ plan, changes: [] as Normalisation[], costUsd: 0 }));
}

function tryExtract(text: string): unknown {
  try {
    return extractJson(text);
  } catch {
    return null;
  }
}

function toResult(c: ChatResult) {
  return {
    raw: c.text,
    usage: c.usage,
    costUsd: c.costUsd,
    model: c.model,
    latencyMs: c.latencyMs,
  };
}
