import { postWithRetry } from "@jev-browser/jev";
import { TEXT_VALUE } from "./instructions.js";

/**
 * Inline text generation, called ONLY when the chosen operation is TYPE_TEXT.
 *
 * This replaces pre-materialising every typed string at plan time. Pre-materialising
 * cannot work in general: a search query refined from what the page showed, or a
 * value that only becomes knowable mid-run, does not exist when the plan is written.
 * A small fast model asked at the moment of typing handles both, and is only paid for
 * on steps that actually type.
 *
 * Scratchpad references ($.summary) are resolved BEFORE this is called — composed
 * prose still comes from the compose node, not from here.
 */
export interface TextContext {
  goal: string;
  subgoal: string;
  field: { label: string; role: string; value?: string };
  page: { title: string; text: string };
  recent: { action: string; text?: string | null }[];
  /** Known facts the value may legitimately be drawn from. */
  profile?: Record<string, string>;
}

export interface TextResult {
  text: string;
  model: string;
  latencyMs: number;
  costUsd: number;
}

export const DEFAULT_TEXT_MODEL = "inception/mercury-2.5";

export async function fieldText(
  ctx: TextContext,
  opts: { apiKey: string; model?: string; timeoutMs?: number },
): Promise<TextResult> {
  const model = opts.model ?? process.env.TEXT_MODEL ?? DEFAULT_TEXT_MODEL;
  const started = performance.now();

  const res = await postWithRetry(
    "https://openrouter.ai/api/v1/chat/completions",
    {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      response_format: { type: "json_object" },
      reasoning: { enabled: false },
      usage: { include: true },
      messages: [
        { role: "system", content: TEXT_VALUE },
        { role: "user", content: JSON.stringify(ctx) },
      ],
    }),
    },
    opts.timeoutMs ?? 30_000,
  );

  const json = (await res.json()) as {
    model: string;
    choices: { message: { content: string } }[];
    usage?: { cost?: number };
  };

  // The output must parse as exactly {text: string}. Anything else is discarded
  // rather than salvaged — we never scrape a quoted substring out of prose and type
  // it into someone's form.
  let value: unknown;
  try {
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "") as Record<string, unknown>;
    if (Object.keys(parsed).length !== 1 || !("text" in parsed)) throw new Error();
    value = parsed.text;
  } catch {
    throw new Error("text helper returned no valid value; nothing typed");
  }
  if (typeof value !== "string" || !value.trim() || value.length > 2000) {
    throw new Error("text helper returned no usable value; nothing typed");
  }

  return {
    text: value,
    model: json.model,
    latencyMs: Math.round(performance.now() - started),
    costUsd: json.usage?.cost ?? 0,
  };
}
