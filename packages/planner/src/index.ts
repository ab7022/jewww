import { Plan } from "@jev-browser/shared";
import { type ChatResult, chat, DEFAULT_PLANNER_MODEL } from "./llm.js";
import { SYSTEM_PROMPT, userPrompt } from "./prompt.js";

export { SYSTEM_PROMPT, DEFAULT_PLANNER_MODEL };
export type { ChatResult };

export interface PlanResult {
  plan: Plan;
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
}): Promise<PlanResult> {
  const model = opts.model ?? DEFAULT_PLANNER_MODEL;
  const first = await chat({
    apiKey: opts.apiKey,
    model,
    system: SYSTEM_PROMPT,
    user: userPrompt(opts.goal, opts.start),
  });

  const parsed = Plan.safeParse(tryExtract(first.text));
  if (parsed.success) {
    return { ...toResult(first), plan: parsed.data, repaired: false };
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

  const retry = Plan.parse(tryExtract(second.text));
  return {
    plan: retry,
    raw: second.text,
    usage: {
      inputTokens: first.usage.inputTokens + second.usage.inputTokens,
      outputTokens: first.usage.outputTokens + second.usage.outputTokens,
    },
    costUsd: first.costUsd + second.costUsd,
    model: second.model,
    latencyMs: first.latencyMs + second.latencyMs,
    repaired: true,
  };
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
