import {
  type Executor,
  StalePage,
  UnreachableTarget,
} from "@jev-browser/executor";
import type { JevProvider } from "@jev-browser/jev";
import { buildActionSpace, decide, fieldText, shouldEscalate } from "@jev-browser/policy";
import { DEFAULT_CAP, rankedSnapshot } from "@jev-browser/sense";
import {
  FORBIDDEN_FIELD,
  IRREVERSIBLE_NAME,
  type Node,
  type Plan,
  SCRATCH_REF,
} from "@jev-browser/shared";
import type { Emit, RunStatus } from "./events.js";
import { Scratchpad } from "./scratchpad.js";

export interface RunOptions {
  jev: JevProvider;
  executor: Executor;
  plan: Plan;
  emit: Emit;
  /** Produces text/data for read, compose and TYPE_TEXT. */
  apiKey: string;
  profile?: Record<string, string>;
  maxSteps?: number;
  /** Called at a confirm node. Returning false suspends the run. */
  approve?: (preview: string, risk: string) => Promise<boolean>;
  /** Per-node extraction; injected so the server can meter it. */
  extract?: (intent: string, schema: unknown, pageText: string) => Promise<unknown>;
  compose?: (intent: string, inputs: Record<string, unknown>) => Promise<unknown>;
}

export interface RunResult {
  status: RunStatus;
  steps: number;
  costUsd: number;
  elapsedMs: number;
  data: Record<string, unknown>;
}

const MAX_STEPS_PER_NODE = 25;

export async function runPlan(opts: RunOptions): Promise<RunResult> {
  const started = performance.now();
  const pad = new Scratchpad(opts.profile ? { profile: opts.profile } : {});
  const state = { steps: 0, cost: 0, budget: opts.maxSteps ?? 120 };

  const status = await runNodes(opts.plan.nodes, opts, pad, state);

  const result: RunResult = {
    status,
    steps: state.steps,
    costUsd: state.cost,
    elapsedMs: Math.round(performance.now() - started),
    data: pad.snapshot(),
  };
  opts.emit({ type: "finish", status, steps: result.steps, costUsd: result.costUsd, elapsedMs: result.elapsedMs });
  return result;
}

interface LoopState {
  steps: number;
  cost: number;
  budget: number;
}

async function runNodes(
  nodes: Node[],
  opts: RunOptions,
  pad: Scratchpad,
  state: LoopState,
): Promise<RunStatus> {
  for (const node of nodes) {
    if (state.steps >= state.budget) return "budget";
    opts.emit({ type: "node:start", id: node.id, kind: node.kind, intent: node.intent });

    let status: RunStatus = "done";
    switch (node.kind) {
      case "act":
        status = await runActNode(node, opts, pad, state);
        break;
      case "read":
        status = await runReadNode(node, opts, pad);
        break;
      case "compose":
        status = await runComposeNode(node, opts, pad);
        break;
      case "confirm":
        status = await runConfirmNode(node, opts, pad);
        break;
      case "foreach":
        status = await runForeachNode(node, opts, pad, state);
        break;
    }

    if (status !== "done") return status;
    opts.emit({ type: "node:done", id: node.id });
  }
  return "done";
}

/** JEV-driven step loop until the node's success criteria hold. */
async function runActNode(
  node: Extract<Node, { kind: "act" }>,
  opts: RunOptions,
  pad: Scratchpad,
  state: LoopState,
): Promise<RunStatus> {
  let lastHash = "";
  let repeats = 0;

  for (let i = 0; i < MAX_STEPS_PER_NODE; i++) {
    if (state.steps >= state.budget) return "budget";

    const raw = await opts.executor.snapshot();
    const capped = rankedSnapshot(raw, node.intent, DEFAULT_CAP);
    const nodes = Object.fromEntries(raw.elements.map((e) => [e.eid, e.node]));

    // Identical page two steps running means the last action silently did nothing.
    // Free to detect, and it is the most common failure mode.
    if (raw.contentHash === lastHash && ++repeats >= 3) {
      opts.emit({ type: "warn", message: `${node.id}: page unchanged for 3 steps, giving up` });
      return "blocked";
    }
    if (raw.contentHash !== lastHash) repeats = 0;
    lastHash = raw.contentHash;

    const space = buildActionSpace(capped.elements, nodes, {
      canScrollDown: raw.viewport.scrollY < raw.viewport.maxScrollY,
      canScrollUp: raw.viewport.scrollY > 0,
    });

    const d = await decide(opts.jev, {
      goal: opts.plan.goal,
      subgoal: node.intent,
      success: node.success,
      snapshot: capped,
      space,
      recent: [],
    });
    state.cost += d.costUsd;
    state.steps += 1;

    opts.emit({
      type: "step",
      nodeId: node.id,
      action: d.action,
      operation: d.operation,
      ...(d.target ? { target: d.target.label } : {}),
      ...(d.targetConfidence !== undefined ? { confidence: d.targetConfidence } : {}),
      risk: d.risk,
      latencyMs: d.latencyMs,
      costUsd: d.costUsd,
    });

    if (d.action.kind === "done") return "done";
    if (d.action.kind === "blocked") {
      opts.emit({ type: "warn", message: `${node.id}: ${d.action.reason}` });
      return "blocked";
    }
    if (shouldEscalate(d)) {
      opts.emit({ type: "escalate", nodeId: node.id, reason: "confidence below threshold" });
      // Phase 2a surfaces the escalation rather than re-planning; the server owns
      // re-planning once it can meter the call.
    }

    // The interlock. Runs before anything executes, on OUR constants, so neither the
    // model's answer nor the page's text can route around it.
    const label = d.target?.label ?? "";
    if (d.action.kind === "type" && FORBIDDEN_FIELD.test(label)) {
      opts.emit({ type: "suspend", nodeId: node.id, reason: "handoff", preview: `credential field: ${label}` });
      return "suspended";
    }
    if (d.requiresConfirmation || IRREVERSIBLE_NAME.test(label)) {
      const ok = opts.approve
        ? await opts.approve(`${d.operation} "${label}"`, d.risk)
        : false;
      if (!ok) {
        opts.emit({
          type: "suspend",
          nodeId: node.id,
          reason: "confirm",
          preview: `${d.operation} "${label}"`,
          risk: d.risk,
        });
        return "suspended";
      }
    }

    // Text is produced now, with the page in front of the model — never predicted at
    // plan time. Slots supply only references to composed data and profile facts.
    let text: string | undefined;
    if (d.action.kind === "type") {
      const slotted = resolveSlot(node.slots, d.target?.label ?? "", pad);
      if (slotted !== undefined) {
        text = slotted;
      } else {
        const t = await fieldText(
          {
            goal: opts.plan.goal,
            subgoal: node.intent,
            field: {
              label: d.target?.label ?? "",
              role: d.target?.role ?? "textbox",
              ...(d.target?.value ? { value: d.target.value } : {}),
            },
            page: { title: capped.title, text: capped.text },
            recent: [],
            ...(opts.profile ? { profile: opts.profile } : {}),
          },
          { apiKey: opts.apiKey },
        );
        text = t.text;
        state.cost += t.costUsd;
        opts.emit({ type: "text", field: d.target?.label ?? "", value: t.text, latencyMs: t.latencyMs, costUsd: t.costUsd });
      }
    }

    // Guard is taken AFTER text generation, so the freshness check inside act()
    // compares against the moment we are actually about to touch the page.
    const guard = await opts.executor.guardFor(d.node ?? null);
    try {
      await opts.executor.act(d.action, d.node ?? null, guard, text);
    } catch (err) {
      if (err instanceof StalePage || err instanceof UnreachableTarget) {
        opts.emit({ type: "warn", message: `${node.id}: ${err.message}, re-observing` });
        continue; // never retried; we go back and decide again from a fresh page
      }
      throw err;
    }

    await opts.executor.settle(d.node ?? null, d.target?.role === "combobox");
  }

  opts.emit({ type: "warn", message: `${node.id}: exhausted ${MAX_STEPS_PER_NODE} steps` });
  return "blocked";
}

async function runReadNode(
  node: Extract<Node, { kind: "read" }>,
  opts: RunOptions,
  pad: Scratchpad,
): Promise<RunStatus> {
  if (!opts.extract) {
    opts.emit({ type: "warn", message: `${node.id}: no extractor supplied` });
    return "blocked";
  }
  const raw = await opts.executor.snapshot();
  const body = await opts.executor.pageText();
  const value = await opts.extract(node.intent, node.schema, `${raw.title}\n${raw.url}\n\n${body}`);
  pad.set(node.into, value);
  opts.emit({
    type: "node:done",
    id: node.id,
    detail: `-> ${node.into} (${body.length} chars from ${new URL(raw.url).pathname})`,
  });
  return "done";
}

async function runComposeNode(
  node: Extract<Node, { kind: "compose" }>,
  opts: RunOptions,
  pad: Scratchpad,
): Promise<RunStatus> {
  if (!opts.compose) {
    opts.emit({ type: "warn", message: `${node.id}: no composer supplied` });
    return "blocked";
  }
  const inputs = Object.fromEntries(node.from.map((k) => [k, pad.get(k)]));
  pad.set(node.into, await opts.compose(node.intent, inputs));
  return "done";
}

async function runConfirmNode(
  node: Extract<Node, { kind: "confirm" }>,
  opts: RunOptions,
  pad: Scratchpad,
): Promise<RunStatus> {
  const preview = SCRATCH_REF.test(node.preview)
    ? String(pad.resolve(node.preview) ?? node.preview)
    : node.preview;
  const ok = opts.approve ? await opts.approve(preview, node.risk ?? "none") : false;
  if (ok) return "done";
  opts.emit({
    type: "suspend",
    nodeId: node.id,
    reason: "confirm",
    preview,
    ...(node.risk ? { risk: node.risk } : {}),
  });
  return "suspended";
}

/** `min` counts SUCCESSES, not attempts — a failing site must not reduce the count. */
async function runForeachNode(
  node: Extract<Node, { kind: "foreach" }>,
  opts: RunOptions,
  pad: Scratchpad,
  state: LoopState,
): Promise<RunStatus> {
  const collection = pad.resolve(node.over);
  const items = Array.isArray(collection) ? collection : [];
  if (!items.length) {
    opts.emit({ type: "warn", message: `${node.id}: "${node.over}" is empty or missing` });
    return "blocked";
  }

  const seen = new Set<string>();
  let succeeded = 0;
  const max = node.max ?? items.length;

  for (const item of items) {
    if (succeeded >= max) break;
    if (state.steps >= state.budget) return "budget";

    if (node.distinctBy && item && typeof item === "object") {
      const key = String((item as Record<string, unknown>)[node.distinctBy] ?? "");
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
    }

    pad.set(node.as, item);
    const status = await runNodes(node.do, opts, pad, state);
    if (status === "suspended" || status === "budget") return status;
    if (status === "done") succeeded += 1;
    else opts.emit({ type: "warn", message: `${node.id}: one iteration did not complete` });
  }

  if (node.min !== undefined && succeeded < node.min) {
    opts.emit({
      type: "warn",
      message: `${node.id}: only ${succeeded} of ${node.min} required iterations succeeded`,
    });
    return "blocked";
  }
  return "done";
}

/** A slot whose key matches the field supplies its value; everything else is inline. */
function resolveSlot(
  slots: Record<string, string> | undefined,
  label: string,
  pad: Scratchpad,
): string | undefined {
  if (!slots) return undefined;
  const normalised = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [key, value] of Object.entries(slots)) {
    if (key.toLowerCase().replace(/[^a-z0-9]/g, "") !== normalised) continue;
    if (!SCRATCH_REF.test(value)) return value;
    const resolved = pad.resolve(value);
    return typeof resolved === "string" ? resolved : undefined;
  }
  return undefined;
}
