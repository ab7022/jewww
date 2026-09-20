import type { Answer, Questions } from "@jev-browser/shared";
import { type EvaluateResult, type JevProvider, postWithRetry } from "./types.js";

const URL = "https://openrouter.ai/api/v1/systemone";

/** OpenRouter follows TypeSafe's native wire format, where boolean is spelled "noul". */
const TO_WIRE = { boolean: "noul", choice: "choice", score: "score" } as const;

interface WireAnswer {
  type: "noul" | "choice" | "score";
  noul?: number;
  choice?: string;
  score?: number;
  probabilities?: Record<string, number>;
}

function fromWire(a: WireAnswer): Answer {
  if (a.type === "noul") return { type: "boolean", probability: a.noul ?? 0 };
  if (a.type === "choice")
    return { type: "choice", choice: a.choice ?? "", probabilities: a.probabilities };
  return { type: "score", score: a.score ?? 0, probabilities: a.probabilities };
}

export function openrouter(opts: {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}): JevProvider {
  const model = opts.model ?? "jev-1.13";
  const timeoutMs = opts.timeoutMs ?? 5000;

  return {
    name: "openrouter",
    async evaluate<Q extends Questions>(state: unknown, questions: Q) {
      const wire: Record<string, unknown> = {};
      for (const [id, q] of Object.entries(questions)) {
        wire[id] = { ...q, type: TO_WIRE[q.type] };
      }

      const started = performance.now();
      const res = await postWithRetry(
        URL,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, state, questions: wire }),
        },
        timeoutMs,
      );
      const json = (await res.json()) as {
        model: string;
        answers: Record<string, WireAnswer>;
        usage: { input_tokens: number; output_tokens: number; cost: number };
      };

      const answers: Record<string, Answer> = {};
      for (const [id, a] of Object.entries(json.answers)) answers[id] = fromWire(a);

      return {
        answers,
        usage: {
          inputTokens: json.usage?.input_tokens ?? 0,
          outputTokens: json.usage?.output_tokens ?? 0,
        },
        costUsd: json.usage?.cost ?? 0,
        model: json.model,
        latencyMs: Math.round(performance.now() - started),
      } as EvaluateResult<Q>;
    },
  };
}
