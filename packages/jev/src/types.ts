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

/** A fault worth trying again: the request never got a considered answer. */
export function isTransient(err: unknown): boolean {
  if (err instanceof JevError) return !err.status || err.status >= 500;
  if (!(err instanceof Error)) return false;
  // Undici surfaces connect failures and DNS problems as a bare "fetch failed" with
  // the real reason on `cause`, and an aborted request as TimeoutError.
  return (
    err.name === "TimeoutError" ||
    err.name === "AbortError" ||
    err.message.includes("fetch failed") ||
    err.message.includes("ETIMEDOUT") ||
    err.message.includes("ECONNRESET") ||
    err.message.includes("ENOTFOUND")
  );
}

/**
 * POST with retries on anything transient — 5xx, timeouts, and connection failures.
 *
 * Connection faults were not retried at all, and a single Cloudflare connect timeout
 * to the provider killed a whole run with an unexplained 500. Never retried on 4xx:
 * those are our bug and repeating them only wastes the user's credits.
 */
export async function postWithRetry(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  attempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1)));
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 500) {
        lastErr = new JevError(`upstream ${res.status}`, res.status, await res.text());
        continue;
      }
      if (!res.ok) throw new JevError(`request failed ${res.status}`, res.status, await res.text());
      return res;
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) throw err;
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new JevError(`model provider unreachable after ${attempts} attempts: ${detail}`, 504);
}
