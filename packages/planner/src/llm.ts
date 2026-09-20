import { postWithRetry } from "@jev-browser/jev";

/** Minimal OpenRouter chat client, sharing the retry policy of the JEV client. */
export interface ChatResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  model: string;
  latencyMs: number;
}

export const DEFAULT_PLANNER_MODEL = "openai/gpt-5.6-luna";

export async function chat(opts: {
  apiKey: string;
  model?: string;
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<ChatResult> {
  const model = opts.model ?? DEFAULT_PLANNER_MODEL;
  const started = performance.now();

  const res = await postWithRetry(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        response_format: { type: "json_object" },
        usage: { include: true },
      }),
    },
    opts.timeoutMs ?? 120_000,
  );
  const json = (await res.json()) as {
    model: string;
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };

  return {
    text: json.choices?.[0]?.message?.content ?? "",
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
    costUsd: json.usage?.cost ?? 0,
    model: json.model,
    latencyMs: Math.round(performance.now() - started),
  };
}
