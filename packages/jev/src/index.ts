import { openrouter } from "./openrouter.js";
import type { JevProvider } from "./types.js";
import { vercel } from "./vercel.js";

export * from "./types.js";
export { openrouter, vercel };

export type ProviderName = "openrouter" | "vercel";

/**
 * Builds a provider from env. The key never leaves the server side — in phase 1 that
 * means it is read only by Node processes, never bundled into anything browser-bound.
 */
export function fromEnv(which: ProviderName = "openrouter"): JevProvider {
  if (which === "vercel") {
    const apiKey = process.env.AI_GATEWAY_API_KEY;
    if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is not set (needed for --provider vercel)");
    return vercel({ apiKey });
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set — copy .env.example to .env");
  return openrouter({ apiKey, model: process.env.JEV_MODEL ?? "jev-1.13" });
}
