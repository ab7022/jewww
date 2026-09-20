import { PROFILE_FIELDS } from "@jev-browser/shared";
import { chat } from "./llm.js";

/**
 * Details the user stated in their own request.
 *
 * "Fill this in with name John Smith, email john@x.com" should work without anyone
 * having filled in a settings page first — requiring a stored profile before the
 * product does anything useful is a bad first run. These merge OVER the stored
 * profile, because something said in the request is more specific than a saved
 * default.
 */
const SYSTEM = `Extract personal details the user stated in their request, for filling in a form.

Return ONLY a JSON object using these keys, omitting any the user did not state:
${Object.entries(PROFILE_FIELDS)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join("\n")}

Take only what the user actually wrote. Never infer, complete or invent a value —
a wrong detail in someone's form submission is worse than a missing one. If they
stated nothing personal, return {}.`;

export async function extractDetails(opts: {
  apiKey: string;
  goal: string;
  model?: string;
}): Promise<{ fields: Record<string, string>; costUsd: number }> {
  const r = await chat({
    apiKey: opts.apiKey,
    ...(opts.model ? { model: opts.model } : {}),
    system: SYSTEM,
    user: JSON.stringify({ request: opts.goal }),
  });

  let parsed: unknown;
  try {
    const body = r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1);
    parsed = JSON.parse(body);
  } catch {
    return { fields: {}, costUsd: r.costUsd };
  }

  const fields: Record<string, string> = {};
  if (parsed && typeof parsed === "object") {
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      // Only keys we know, only non-empty strings — a hallucinated key would become
      // a candidate value the mapper could put into someone's form.
      if (!(key in PROFILE_FIELDS)) continue;
      if (typeof value !== "string" || !value.trim()) continue;
      fields[key] = value.trim();
    }
  }
  return { fields, costUsd: r.costUsd };
}
