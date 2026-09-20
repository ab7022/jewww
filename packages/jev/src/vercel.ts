import type { Answer, Questions } from "@jev-browser/shared";
import { type EvaluateResult, type JevProvider, postWithRetry } from "./types.js";

const URL = "https://ai-gateway.vercel.sh/v1/evaluate";

/**
 * Vercel's gateway uses its own dialect: boolean stays "boolean", and cost hides in
 * providerMetadata. Kept as a cross-check on OpenRouter's answers and pricing.
 */
export function vercel(opts: { apiKey: string; model?: string; timeoutMs?: number }): JevProvider {
  const model = opts.model ?? "typesafe-ai/jev";
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return {
    name: "vercel",
    async evaluate<Q extends Questions>(state: unknown, questions: Q) {
      const started = performance.now();
      const res = await postWithRetry(
        URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            state,
            questions,
            providerOptions: { gateway: { zeroDataRetention: true } },
          }),
        },
        timeoutMs,
      );
      const json = (await res.json()) as {
        model: string;
        answers: Record<string, Answer>;
        usage: { inputTokens: number; outputTokens: number };
        providerMetadata?: { gateway?: { cost?: string } };
      };

      return {
        answers: json.answers,
        usage: {
          inputTokens: json.usage?.inputTokens ?? 0,
          outputTokens: json.usage?.outputTokens ?? 0,
        },
        costUsd: Number(json.providerMetadata?.gateway?.cost ?? 0),
        model: json.model,
        latencyMs: Math.round(performance.now() - started),
      } as EvaluateResult<Q>;
    },
  };
}
