
import type { Decision, DecideInput, FieldMapping, TextContext } from "@jev-browser/policy";
import { escalationReason } from "@jev-browser/policy";
import { DEFAULT_CAP, rankedSnapshot, toSnapshotElement } from "@jev-browser/sense";
import {
  BLOCKER,
  type Executor,
  FORBIDDEN_FIELD,
  type Node,
  type SnapshotElement,
  type Plan,
  SCRATCH_REF,
  StalePage,
  UnreachableTarget,
} from "@jev-browser/shared";
import type { Emit, RunStatus } from "./events.js";
import { Scratchpad } from "./scratchpad.js";

/**
 * Everything the loop needs a model for, injected rather than called directly.
 *
 * The CLI wires these straight to the model packages; the extension wires them to the
 * server, which is the only place an API key exists. Same loop either way — and it is
 * what lets the extension avoid bundling any model client at all.
 */
export interface Capabilities {
  decide(input: DecideInput): Promise<Decision>;
  /** Text for a TYPE_TEXT step, written with the page in front of the model. */
  text(ctx: TextContext): Promise<string>;
  extract(intent: string, schema: unknown, pageText: string): Promise<unknown>;
  compose(intent: string, inputs: Record<string, unknown>): Promise<unknown>;
  /** Maps every field of a form to a profile key in ONE call. */
  mapFields(input: {
    page: { url: string; title: string };
    fields: SnapshotElement[];
    available?: string[];
  }): Promise<{ mappings: FieldMapping[]; costUsd: number }>;
}

export interface RunOptions {
  capabilities: Capabilities;
  executor: Executor;
  plan: Plan;
  emit: Emit;
  profile?: Record<string, string>;
  maxSteps?: number;
  /** Called before anything irreversible. Returning false suspends the run. */
  approve?: (preview: string, risk: string) => Promise<boolean>;
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
      case "fill":
        status = await runFillNode(node, opts, pad, state);
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

    const profile = (pad.get("profile") ?? {}) as Record<string, string>;
    const d = await opts.capabilities.decide({
      goal: opts.plan.goal,
      subgoal: node.intent,
      success: node.success,
      snapshot: capped,
      nodes,
      recent: [],
      // ATTACH only exists as an option when the user has actually offered a file.
      ...(profile.resumeFile ? { attachable: profile.resumeFile } : {}),
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
    const shaky = escalationReason(d);
    if (shaky) {
      opts.emit({ type: "escalate", nodeId: node.id, reason: shaky });
      // Phase 2a surfaces the escalation rather than re-planning; the server owns
      // re-planning once it can meter the call.
    }

    // Something on the page needs a human — an account, a sign-in, a CAPTCHA, a
    // payment. Classified by the model from the page rather than matched against a
    // word list, so it works on sites nobody anticipated.
    if (d.mustHandOff) {
      opts.emit({
        type: "suspend",
        nodeId: node.id,
        reason: "handoff",
        preview: `this page needs you: ${BLOCKER[d.blocker]}`,
      });
      return "suspended";
    }

    // The one check that is not a judgement call, kept here as well as in decide()
    // and again in the content script: a secret must not be typed even if every
    // layer above this one says to.
    const label = d.target?.label ?? "";
    if (d.action.kind === "type" && FORBIDDEN_FIELD.test(label)) {
      opts.emit({
        type: "suspend",
        nodeId: node.id,
        reason: "handoff",
        preview: `refused to type into a credential field: ${label}`,
      });
      return "suspended";
    }

    if (d.requiresConfirmation) {
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
        const started = Date.now();
        text = await opts.capabilities.text({
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
        });
        opts.emit({
          type: "text",
          field: d.target?.label ?? "",
          value: text,
          latencyMs: Date.now() - started,
          costUsd: 0,
        });
      }
    }

    // Guard is taken AFTER text generation, so the freshness check inside act()
    // compares against the moment we are actually about to touch the page.
    const fp = raw.elements.find((e) => e.eid === d.target?.eid)?.fp;
    const guard = await opts.executor.guardFor(d.node ?? null, fp);
    try {
      await opts.executor.act(d.action, d.node ?? null, guard, text, fp);
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

/**
 * Things the agent must never do itself, detected from what is on the page.
 *
 * These are correct outcomes, not failures. Roughly half of enterprise ATS postings
 * require creating an account, and a run that stops there and hands the browser back
 * is behaving properly — a run that tries to get past it is not.
 */
/**
 * Fill a whole form in one batched call.
 *
 * Only fields the model maps confidently are filled. A field it declines, or is
 * unsure about, is reported and left blank — a wrong value in someone's job
 * application is worse than a missing one, and the human is about to review it anyway.
 */
/** Profile entries that name a file rather than carry a value. */
const NOT_TYPEABLE = new Set(["resumeFile"]);

async function runFillNode(
  node: Extract<Node, { kind: "fill" }>,
  opts: RunOptions,
  pad: Scratchpad,
  state: LoopState,
): Promise<RunStatus> {
  const raw = await opts.executor.snapshot();

  // Empty, enabled, non-credential inputs only.
  const fields = raw.elements.filter(
    (e) =>
      e.fillable &&
      !e.value &&
      !e.st?.includes("disabled") &&
      e.role !== "password" &&
      !FORBIDDEN_FIELD.test(e.name),
  );
  if (!fields.length) {
    opts.emit({ type: "node:done", id: node.id, detail: "no empty fields to fill" });
    return "done";
  }

  const profile = (pad.get("profile") ?? {}) as Record<string, string>;
  if (!Object.keys(profile).length) {
    // Without a profile there is nothing to map fields ONTO, and every answer comes
    // back __none. Saying so beats reporting "filled 0/26" as if the model failed.
    opts.emit({
      type: "warn",
      message: `${node.id}: no profile loaded, so no field can be filled`,
    });
    return "blocked";
  }
  // `resumeFile` is a path on disk, not a value to type. Offering it as a mapping
  // target put "/Users/…/resume.txt" into two text boxes on a real application.
  // Files are attached through ATTACH, which is a separate operation for this reason.
  const typeable = Object.keys(profile).filter((k) => !NOT_TYPEABLE.has(k));
  const mapped = await opts.capabilities.mapFields({
    page: { url: raw.url, title: raw.title },
    fields: fields.map(toSnapshotElement),
    available: typeable,
  });
  const mappings = mapped.mappings;
  state.steps += 1;
  state.cost += mapped.costUsd;

  const byEid = new Map(raw.elements.map((e) => [e.eid, e]));
  let filled = 0;
  const skipped: string[] = [];

  for (const m of mappings) {
    const element = byEid.get(m.eid);
    if (!element) continue;
    if (m.skipped) {
      skipped.push(m.label);
      continue;
    }
    const value = node.extras?.[m.key] ? String(pad.resolve(node.extras[m.key] as string) ?? "") : profile[m.key];
    if (!value) {
      skipped.push(m.label);
      continue;
    }

    const guard = await opts.executor.guardFor(element.node, element.fp);
    try {
      await opts.executor.act(
        { kind: "type", eid: m.eid, text: value },
        element.node,
        guard,
        value,
        element.fp,
      );
      filled += 1;
      opts.emit({
        type: "text",
        field: m.label,
        value,
        latencyMs: 0,
        costUsd: 0,
      });
    } catch (err) {
      if (err instanceof StalePage || err instanceof UnreachableTarget) {
        skipped.push(`${m.label} (${err.message})`);
        continue;
      }
      throw err;
    }
    await opts.executor.settle(element.node, false);
  }

  opts.emit({
    type: "node:done",
    id: node.id,
    detail: `filled ${filled}/${fields.length}${skipped.length ? `, left for you: ${skipped.slice(0, 6).join(", ")}` : ""}`,
  });
  return filled > 0 || fields.length === 0 ? "done" : "blocked";
}

async function runReadNode(
  node: Extract<Node, { kind: "read" }>,
  opts: RunOptions,
  pad: Scratchpad,
): Promise<RunStatus> {
  const raw = await opts.executor.snapshot();
  const body = await opts.executor.pageText();
  const value = await opts.capabilities.extract(node.intent, node.schema, `${raw.title}\n${raw.url}\n\n${body}`);
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
  const inputs = Object.fromEntries(node.from.map((k) => [k, pad.get(k)]));
  pad.set(node.into, await opts.capabilities.compose(node.intent, inputs));
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
