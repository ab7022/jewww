import type { Action, Risk } from "@jev-browser/shared";

/**
 * Everything the loop emits. The CLI prints these; the extension renders them in the
 * side panel; the server writes them to the step log. One vocabulary for all three.
 */
export type RunEvent =
  | { type: "plan"; nodes: number; sites: string[]; costUsd: number }
  | { type: "node:start"; id: string; kind: string; intent: string }
  | { type: "node:done"; id: string; detail?: string }
  | { type: "step"; nodeId: string; action: Action; operation: string; target?: string; confidence?: number; risk: Risk; latencyMs: number; costUsd: number }
  | { type: "text"; field: string; value: string; latencyMs: number; costUsd: number }
  | { type: "escalate"; nodeId: string; reason: string }
  | { type: "suspend"; nodeId: string; reason: "confirm" | "handoff"; preview: string; risk?: Risk }
  | { type: "warn"; message: string }
  | { type: "finish"; status: RunStatus; steps: number; costUsd: number; elapsedMs: number };

export type RunStatus = "done" | "blocked" | "suspended" | "budget";

export type Emit = (event: RunEvent) => void;
