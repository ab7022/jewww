import type { JevProvider } from "@jev-browser/jev";
import { compose, explain, extract } from "@jev-browser/planner";
import { decide, fieldText, mapFields } from "@jev-browser/policy";
import type { Capabilities } from "./run.js";

/**
 * Capabilities backed directly by the models, bound to ONE run.
 *
 * This is the only place a model call is wired to a run's context. The goal and the
 * user's standing instructions are supplied here, once; no call site passes them, so
 * no call site can forget them. Before this, compose received the goal and extract did
 * not — in the CLI and the extension both — because each was wired by hand.
 *
 * Used by the CLI directly and by the server per request (with the run's own goal from
 * the database). Imported from `@jev-browser/runtime/models` so that the extension,
 * which imports the root entry, never bundles a model client.
 */
export interface RunBinding {
  apiKey: string;
  jev: JevProvider;
  goal: string;
  /** Standing instructions from the user's saved details. Trusted, like the goal. */
  instructions?: string | undefined;
  /** Called with the cost of every model call, e.g. to meter credits. Awaited. */
  onCost?: (kind: ModelCall, costUsd: number) => void | Promise<void>;
}

export type ModelCall = "decide" | "text" | "extract" | "compose" | "explain" | "fields";

export function bindModels(b: RunBinding): Capabilities {
  const charge = async (kind: ModelCall, costUsd: number) => {
    await b.onCost?.(kind, costUsd);
  };
  const instructions = b.instructions?.trim() || undefined;

  return {
    async decide(request) {
      const { nodeId: _nodeId, ...rest } = request;
      const d = await decide(b.jev, { ...rest, goal: b.goal, instructions });
      await charge("decide", d.costUsd);
      return d;
    },

    async text(request) {
      const r = await fieldText(
        { ...request, goal: b.goal, recent: [], instructions },
        { apiKey: b.apiKey },
      );
      await charge("text", r.costUsd);
      return r.text;
    },

    async extract(request) {
      const r = await extract({ apiKey: b.apiKey, ...request, goal: b.goal, instructions });
      await charge("extract", r.costUsd);
      return r.value;
    },

    async compose(request) {
      const r = await compose({ apiKey: b.apiKey, ...request, goal: b.goal, instructions });
      await charge("compose", r.costUsd);
      return r.value;
    },

    async explain(request) {
      const { costUsd, latencyMs: _latency, ...explanation } = await explain({
        apiKey: b.apiKey,
        request,
        goal: b.goal,
        instructions,
      });
      await charge("explain", costUsd);
      return explanation;
    },

    async mapFields(request) {
      const r = await mapFields(b.jev, request);
      await charge("fields", r.costUsd);
      return { mappings: r.mappings, costUsd: r.costUsd };
    },
  };
}
