import type { AnswersFor, Questions } from "@jev-browser/shared";

export interface EvaluateResult<Q extends Questions> {
  answers: AnswersFor<Q>;
  usage: { inputTokens: number; outputTokens: number };
  /** USD for this call, as reported by the provider. */
  costUsd: number;
  /** The exact build that ran, e.g. "typesafe/jev-1.13-20260917". */
  model: string;
  latencyMs: number;
}

export interface JevProvider {
  readonly name: "openrouter" | "vercel";
  evaluate<Q extends Questions>(state: unknown, questions: Q): Promise<EvaluateResult<Q>>;
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "JevError";
  }
}

/** One retry on transport faults and 5xx. Never on 4xx — those are our bug. */
export async function postWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 500 && attempt === 0) {
        lastErr = new JevError(`upstream ${res.status}`, res.status, await res.text());
        continue;
      }
      if (!res.ok) throw new JevError(`request failed ${res.status}`, res.status, await res.text());
      return res;
    } catch (err) {
      lastErr = err;
      if (err instanceof JevError && err.status && err.status < 500) throw err;
      if (attempt === 1) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new JevError(String(lastErr));
}
