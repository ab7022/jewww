
import type { Autonomy, Decision, FieldMapping } from "@jev-browser/policy";
import { escalationReason } from "@jev-browser/policy";
import { DEFAULT_CAP, rankedSnapshot, toSnapshotElement } from "@jev-browser/sense";
import {
  BLOCKER,
  type ComposeRequest,
  type DecideRequest,
  DEFAULT_EXPLAIN_CAP,
  type Explanation,
  type ExplainRequest,
  type ExplainResult,
  MAX_NOTES,
  type Executor,
  type ExtractRequest,
  FORBIDDEN_FIELD,
  type MapFieldsRequest,
  type Node,
  NO_FIELD,
  PHYSICALLY_UNREACHABLE,
  TASK_FIELD,
  PROFILE_FIELDS,
  type ProfileKey,
  type Plan,
  type RawSnapshot,
  type RecentAction,
  SCRATCH_REF,
  StalePage,
  type TextRequest,
  UnreachableTarget,
  walk,
} from "@jev-browser/shared";
import type { Ask, Emit, GatedAction, MissingField, RunEvent, RunStatus } from "./events.js";
import { Scratchpad, scratchKey } from "./scratchpad.js";

/**
 * Everything the loop needs a model for, injected rather than called directly.
 *
 * The CLI binds these to the model packages (`@jev-browser/runtime/models`); the
 * extension binds them to the server, which is the only place an API key exists.
 * Same loop either way — and it is what lets the extension avoid bundling any model
 * client at all.
 *
 * A set of capabilities is BOUND TO ONE RUN: the goal and the user's standing
 * instructions are supplied when it is built, never passed per call. They used to be
 * positional arguments, and each time one was added some caller did not forward it —
 * compose got the goal and extract did not, in both the CLI and the extension. The
 * request types are the wire schemas in `@jev-browser/shared`, so the server parses
 * exactly what the runtime sends.
 */
export interface Capabilities {
  decide(request: DecideRequest): Promise<Decision>;
  /** Text for a TYPE_TEXT step, written with the page in front of the model. */
  text(request: TextRequest): Promise<string | null>;
  extract(request: ExtractRequest): Promise<unknown>;
  compose(request: ComposeRequest): Promise<unknown>;
  /** Which elements answer the intent, and a short note for each. */
  explain(request: ExplainRequest): Promise<Explanation>;
  /** Maps every field of a form to a profile key in ONE call. */
  mapFields(request: MapFieldsRequest): Promise<{ mappings: FieldMapping[]; costUsd: number }>;
}

export interface RunOptions {
  capabilities: Capabilities;
  executor: Executor;
  plan: Plan;
  emit: Emit;
  profile?: Record<string, string>;
  maxSteps?: number;
  /**
   * How much authority the user's own words granted, read from the goal.
   *
   * "full" means carry the task out without interrupting — the default when someone
   * describes a task and says nothing about review. "confirm" asks. "never" refuses
   * outright, and no flag can override it, because it is an instruction the user gave.
   */
  autonomy?: Autonomy;
  /** Called before anything irreversible, when autonomy is "confirm". */
  approve?: (preview: string, risk: string) => Promise<boolean>;
  /** Called when a form asks something the agent cannot answer from what it knows. */
  ask?: Ask;
  /**
   * Queue irreversible steps instead of asking about each one, and carry on.
   *
   * Nothing gated is ever executed in this mode — the work that is safe gets done,
   * and the rest is handed back as a single review. This is what makes a ten-item
   * run possible at all: suspending on the first gate abandons the other nine.
   */
  batchApprovals?: boolean;
  /**
   * Stop means stop. Checked before every node and every step, and before anything
   * touches the page — Stop used to reject only a pending approval while the loop went
   * on clicking and typing in the user's tab.
   */
  signal?: AbortSignal;
  /**
   * "do" carries the task out. "show" makes the same decisions but, instead of acting,
   * points the cursor at each target and waits for the person to do it — how someone
   * learns a tool. Read from the user's own words on the server.
   */
  mode?: "do" | "show";
  /** Show mode: how long to wait for the person before treating the point as the answer. */
  showWaitMs?: number;
}

export interface RunResult {
  status: RunStatus;
  steps: number;
  costUsd: number;
  elapsedMs: number;
  data: Record<string, unknown>;
  /** Irreversible steps awaiting a human, when batching. */
  pending: GatedAction[];
}

const MAX_STEPS_PER_NODE = 25;

export async function runPlan(options: RunOptions): Promise<RunResult> {
  const started = performance.now();
  const pad = new Scratchpad(options.profile ? { profile: options.profile } : {});
  const state: LoopState = {
    steps: 0,
    cost: 0,
    budget: options.maxSteps ?? 120,
    pending: [],
    currentItem: undefined,
    iteration: undefined,
    finished: false,
    skipNext: false,
  };

  // The ONE place events get their time and loop position. Call sites emit bare
  // payloads and cannot stamp them wrongly, because they cannot stamp them at all.
  const opts: Ctx = {
    ...options,
    emit: (e) =>
      options.emit({
        ...e,
        at: Date.now(),
        ...(state.iteration !== undefined ? { iteration: state.iteration } : {}),
      }),
  };

  const status = await runNodes(opts.plan.nodes, opts, pad, state);

  const result: RunResult = {
    status,
    steps: state.steps,
    costUsd: state.cost,
    elapsedMs: Math.round(performance.now() - started),
    data: pad.snapshot(),
    pending: state.pending,
  };
  opts.emit({ type: "finish", status, steps: result.steps, costUsd: result.costUsd, elapsedMs: result.elapsedMs });
  return result;
}

interface LoopState {
  steps: number;
  cost: number;
  budget: number;
  pending: GatedAction[];
  /** The foreach item being processed, for attributing a queued action. */
  currentItem: unknown;
  /** Loop position stamped onto events; see `Stamp.iteration`. */
  iteration: string | undefined;
  /** Set when the run has reached its answer early (show mode, pointing done). */
  finished: boolean;
  /**
   * The step right after a gate the user closed ("don't submit"). Skipped, not the
   * whole run: filling ten applications and submitting none must still fill ten.
   */
  skipNext: boolean;
}

/** Run options as the interpreter sees them: `emit` takes bare payloads. */
type Ctx = Omit<RunOptions, "emit"> & { emit(event: RunEvent): void };

async function runNodes(
  nodes: Node[],
  opts: Ctx,
  pad: Scratchpad,
  state: LoopState,
): Promise<RunStatus> {
  for (const node of nodes) {
    if (state.finished) return "done";
    if (state.skipNext) {
      state.skipNext = false;
      opts.emit({ type: "node:start", id: node.id, kind: node.kind, intent: node.intent });
      opts.emit({ type: "node:done", id: node.id, detail: "held back — you asked for this not to be done" });
      continue;
    }
    if (opts.signal?.aborted) return "aborted";
    if (state.steps >= state.budget) return "budget";
    opts.emit({ type: "node:start", id: node.id, kind: node.kind, intent: node.intent });

    let status: RunStatus = "done";
    try {
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
        case "explain":
          status = await runExplainNode(node, opts, pad, state);
          break;
        case "confirm":
          status = await runConfirmNode(node, opts, pad, state);
          break;
        case "foreach":
          status = await runForeachNode(node, opts, pad, state);
          break;
      }
    } catch (err) {
      // A step that throws for a reason the loop did not anticipate should end THAT
      // step, not the run — the work already done still stands, and a batch of ten
      // must not be lost to one bad page.
      opts.emit({
        type: "warn",
        nodeId: node.id,
        message: err instanceof Error ? err.message : String(err),
      });
      status = "blocked";
    }

    if (status !== "done") return status;
    opts.emit({ type: "node:done", id: node.id });
  }
  return "done";
}

/** JEV-driven step loop until the node's success criteria hold. */
async function runActNode(
  node: Extract<Node, { kind: "act" }>,
  opts: Ctx,
  pad: Scratchpad,
  state: LoopState,
  form?: FormPass,
): Promise<RunStatus> {
  await arrive(node, urlSlot(node.slots, pad), opts);

  let lastHash = "";
  let repeats = 0;
  /**
   * What just happened, fed back into the next decision.
   *
   * This was an empty array on every call, so the model had NO memory within a node:
   * a click refused because a modal covered the target looked identical to a click
   * never attempted, and it chose the same covered element over and over until the
   * loop guard killed the run. Telling it what failed and why is what lets it try
   * dismissing the overlay instead.
   */
  const recent: RecentAction[] = [];

  /**
   * Targets that are physically covered on the page as it stands.
   *
   * Telling the model why a click failed was not enough on its own: AWS' console has
   * two "AWS Amplify" links, one of them underneath the open services menu, and it
   * kept choosing the buried one because that is still the best-named match for the
   * goal. A covered element is not a judgement call — the hit test already proved it
   * cannot be clicked — so it is withdrawn from the choices until the page changes.
   * Keyed by fingerprint, since eids are only stable within one snapshot.
   */
  const covered = new Set<string>();

  /**
   * Approvals already given in this node, keyed by (element, operation).
   *
   * An approved click that is then blocked — a dialog in the way — comes straight back
   * as the same decision once the dialog is gone. Asking again for something the
   * person just said yes to is the gate malfunctioning, not the gate working.
   */
  const approved = new Set<string>();

  for (let i = 0; i < MAX_STEPS_PER_NODE; i++) {
    if (opts.signal?.aborted) return "aborted";
    if (state.steps >= state.budget) return "budget";

    const raw = await opts.executor.snapshot();
    // A page that moved may have uncovered things, so the evidence expires with it.
    if (raw.contentHash !== lastHash) covered.clear();

    // A fill node: fields that appeared since the last look are batch-filled before
    // anything is decided about them, then the page is looked at afresh.
    if (form && batchable(raw, form.seen).length) {
      const stopped = await batchFill(form, raw, opts, pad, state);
      if (stopped) return stopped;
      continue;
    }

    const fpByEid = new Map(raw.elements.map((e) => [e.eid, e.fp]));
    const ranked = rankedSnapshot(raw, node.intent, DEFAULT_CAP);
    const capped = covered.size
      ? {
          ...ranked,
          elements: ranked.elements.filter((e) => {
            const fp = fpByEid.get(e.eid);
            return !fp || !covered.has(fp);
          }),
        }
      : ranked;
    const nodes = Object.fromEntries(raw.elements.map((e) => [e.eid, e.node]));

    // Identical page two steps running means the last action silently did nothing.
    // Free to detect, and it is the most common failure mode.
    if (raw.contentHash === lastHash && ++repeats >= 3) {
      opts.emit({ type: "warn", nodeId: node.id, message: "page unchanged for 3 steps, giving up" });
      return "blocked";
    }
    if (raw.contentHash !== lastHash) repeats = 0;
    const last = recent[recent.length - 1];
    if (last && last.pageChanged === undefined) {
      last.pageChanged = raw.contentHash !== lastHash;
      // Said in words as well as the flag. A click that "succeeded" with no visible
      // effect is the most common silent failure there is (Google's tiles ignored a
      // synthetic click for exactly this reason), and the model has to treat it as a
      // failure to try something else.
      if (!last.pageChanged) last.action = `${last.action} — had no visible effect on the page`;
    }
    lastHash = raw.contentHash;

    const profile = (pad.get("profile") ?? {}) as Record<string, string>;
    const d = await opts.capabilities.decide({
      nodeId: node.id,
      subgoal: withItem(node.intent, state),
      success: node.success,
      snapshot: capped,
      nodes,
      recent: recent.slice(-5),
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
      opts.emit({ type: "warn", nodeId: node.id, message: d.action.reason });
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
      // In a batch, one site demanding an account must not end the other nine.
      // The item is abandoned and the loop moves on.
      return opts.batchApprovals ? "blocked" : "suspended";
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

    // Show mode: the same decision, but the person acts. Nothing on the page is
    // touched, so no approval applies.
    if (opts.mode === "show" && d.node !== undefined && isPointable(d.action)) {
      const targetFp = raw.elements.find((e) => e.eid === d.target?.eid)?.fp;
      const message = showMessage(d.action, label);
      const refusal = await opts.executor.point(d.node, message, targetFp);
      if (refusal) {
        if (targetFp && PHYSICALLY_UNREACHABLE.test(refusal)) covered.add(targetFp);
        recent.push({ action: `point at "${label}" FAILED: ${refusal}`, pageChanged: false });
        opts.emit({ type: "warn", nodeId: node.id, message: `${refusal}, re-observing` });
        continue;
      }
      opts.emit({ type: "point", nodeId: node.id, message, ...(label ? { target: label } : {}) });
      const acted = await waitForPerson(opts, raw.contentHash);
      if (acted === "aborted") return "aborted";
      if (!acted) {
        // They looked and did not click: for "where is…" the pointing WAS the answer.
        state.finished = true;
        return "done";
      }
      recent.push({ action: `showed the person "${label}" and they did it`, pageChanged: true });
      continue;
    }

    const autonomy = opts.autonomy ?? "confirm";
    if (d.requiresConfirmation && autonomy !== "full") {
      const preview = `${d.operation} "${label}"`;

      // The user said not to finalise anything. That is an instruction, not a
      // preference, so it outranks every approval path including --auto-approve.
      if (autonomy === "never") {
        state.pending.push({
          nodeId: node.id,
          url: capped.url,
          operation: d.operation,
          target: label,
          risk: d.risk,
          ...(state.currentItem !== undefined ? { item: state.currentItem } : {}),
        });
        opts.emit({ type: "queued", nodeId: node.id, preview, risk: d.risk });
        return "done";
      }
      if (opts.batchApprovals) {
        // Queued, never executed. The run continues with the work that is safe.
        state.pending.push({
          nodeId: node.id,
          url: capped.url,
          operation: d.operation,
          target: label,
          risk: d.risk,
          ...(state.currentItem !== undefined ? { item: state.currentItem } : {}),
        });
        opts.emit({ type: "queued", nodeId: node.id, preview, risk: d.risk });
        return "done";
      }
      // Never ask a person to approve something that cannot happen right now.
      const targetFp = raw.elements.find((e) => e.eid === d.target?.eid)?.fp;
      const refusal = await opts.executor.preflight(d.action, d.node ?? null, targetFp);
      if (refusal) {
        if (targetFp && PHYSICALLY_UNREACHABLE.test(refusal)) covered.add(targetFp);
        recent.push({ action: `${d.operation}${label ? ` "${label}"` : ""} FAILED: ${refusal}`, pageChanged: false });
        opts.emit({ type: "warn", nodeId: node.id, message: `${refusal}, re-observing` });
        continue;
      }

      const approvalKey = `${targetFp ?? label}|${d.operation}`;
      const ok = approved.has(approvalKey)
        ? true
        : await (async () => {
            opts.emit({
              type: "approval",
              nodeId: node.id,
              preview,
              risk: d.risk,
              action: d.action,
              ...(label ? { target: label } : {}),
            });
            return opts.approve ? opts.approve(preview, d.risk) : false;
          })();
      if (ok) approved.add(approvalKey);
      if (!ok) {
        opts.emit({
          type: "suspend",
          nodeId: node.id,
          reason: "confirm",
          preview,
          risk: d.risk,
          action: d.action,
          ...(label ? { target: label } : {}),
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
        const written = await opts.capabilities.text({
          subgoal: withItem(node.intent, state),
          field: {
            label: d.target?.label ?? "",
            role: d.target?.role ?? "textbox",
            ...(d.target?.value ? { value: d.target.value } : {}),
          },
          page: { title: capped.title, text: capped.text.slice(0, 8000) },
          ...(opts.profile ? { profile: opts.profile } : {}),
          ...draftsIn(pad),
        });

        if (written === null) {
          // The model declined rather than invent a value. Ask the person, once, and
          // keep the answer for the rest of the run.
          const field = d.target?.label ?? "this field";
          const key = stableKey(field);
          const answers = (pad.get("answers") ?? {}) as Record<string, { question: string; value: string }>;
          const known = answers[key]?.value;
          const given = known
            ? { [key]: known }
            : opts.ask
              ? await opts.ask([{ key, label: field, role: d.target?.role ?? "textbox", required: false }])
              : {};
          const answer = given[key];
          if (!answer?.trim()) {
            recent.push({ action: `type into "${field}" skipped: no value available`, pageChanged: false });
            opts.emit({ type: "warn", nodeId: node.id, message: `nothing to put in “${field}”` });
            continue;
          }
          if (!known) pad.set("answers", { ...answers, [key]: { question: field, value: answer } });
          text = answer;
        } else {
          text = written;
        }

        opts.emit({
          type: "text",
          field: d.target?.label ?? "",
          value: text,
          latencyMs: Date.now() - started,
          costUsd: 0,
        });
      }
    }

    // A model call can take seconds; Stop pressed during it must still win.
    if (opts.signal?.aborted) return "aborted";

    // Guard is taken AFTER text generation, so the freshness check inside act()
    // compares against the moment we are actually about to touch the page.
    const fp = raw.elements.find((e) => e.eid === d.target?.eid)?.fp;
    const guard = await opts.executor.guardFor(d.node ?? null, fp);
    const describe = `${d.operation}${label ? ` "${label}"` : ""}`;
    try {
      await opts.executor.act(d.action, d.node ?? null, guard, text, fp);
      recent.push({ action: describe, ...(text !== undefined ? { text } : {}) });
    } catch (err) {
      if (err instanceof StalePage || err instanceof UnreachableTarget) {
        // Recorded as a FAILURE with its reason. "covered by a modal" is actionable —
        // the model can dismiss the overlay — but only if it is told.
        // Covered is a fact the hit test established, not an opinion to re-litigate.
        if (fp && PHYSICALLY_UNREACHABLE.test(err.message)) covered.add(fp);
        recent.push({ action: `${describe} FAILED: ${err.message}`, pageChanged: false });
        opts.emit({ type: "warn", nodeId: node.id, message: `${err.message}, re-observing` });
        continue; // never retried; we go back and decide again from a fresh page
      }
      throw err;
    }

    await opts.executor.settle(d.node ?? null, d.target?.role === "combobox");

    // An attach is terminal and its outcome is known: the driver either uploaded the
    // file or threw. Sending the model back to confirm it visually was worse than
    // useless — sites replace the input with a filename display, so there is often
    // nothing left that looks like an upload field, and the model concluded it had
    // failed at something that had plainly worked.
    if (d.action.kind === "attach") {
      opts.emit({ type: "node:done", id: node.id, detail: `attached ${d.action.file.split("/").pop()}` });
      return "done";
    }
  }

  opts.emit({ type: "warn", nodeId: node.id, message: `exhausted ${MAX_STEPS_PER_NODE} steps` });
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
/** Complete a fill node through the general loop after its batch pass. */

/**
 * A step's intent, plus the loop item it is working on.
 *
 * Inside a loop the plan says "open the application for the selected role", and the
 * item that says WHICH role sat in the scratchpad where the model never saw it — so
 * every iteration picked the most plausible role, which was always the first, and
 * "apply to two jobs" applied to one of them twice.
 */
function withItem(intent: string, state: LoopState): string {
  if (state.currentItem === undefined) return intent;
  const item = typeof state.currentItem === "string" ? state.currentItem : JSON.stringify(state.currentItem);
  return `${intent}\n\nThe item this step is working on: ${item.slice(0, 600)}`;
}

/** Scratchpad keys some foreach iterates over. */
function loopsOver(nodes: Node[]): Set<string> {
  const keys = new Set<string>();
  for (const n of walk(nodes)) if (n.kind === "foreach") keys.add(scratchKey(n.over));
  return keys;
}

/** Prose prepared earlier in the run, for the text step to use rather than rewrite. */
function draftsIn(pad: Scratchpad): { drafts?: Record<string, string> } {
  const drafts: Record<string, string> = {};
  for (const [key, value] of Object.entries(pad.snapshot())) {
    if (key === "profile" || key === "answers") continue;
    if (typeof value === "string" && value.trim()) drafts[key] = value.slice(0, 8000);
    else if (value && typeof value === "object" && !Array.isArray(value)) {
      // A compose node often returns { subject, body }: offer each string part.
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === "string" && v.trim()) drafts[`${key}.${k}`] = v.slice(0, 8000);
      }
    }
  }
  return Object.keys(drafts).length ? { drafts } : {};
}

/** Run a fill node through the general act loop, keeping its intent and success. */

/** Profile entries that name a file rather than carry a value. */
const NOT_TYPEABLE = new Set(["resumeFile"]);

/**
 * A key for an answer, derived from the question itself so the same question on the
 * same site reuses it directly. Differently-worded questions across sites are matched
 * by the model instead, which is why this only has to be stable, not clever.
 */
function stableKey(label: string): string {
  return `ans_${label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 48)}`;
}

async function runFillNode(
  node: Extract<Node, { kind: "fill" }>,
  opts: Ctx,
  pad: Scratchpad,
  state: LoopState,
): Promise<RunStatus> {
  // One loop, with the batch pass attached to it. The batch pass used to run once, on
  // arrival: a form still behind "Easy Apply" had no fields then, so every field the
  // button revealed was typed one decision at a time — and a question only the user
  // could answer ("Why do you want to join?") ended the node BLOCKED, because only the
  // batch pass can ask. Now whenever the page shows fillable fields this node has not
  // yet seen — on arrival, behind a button, on a wizard's next page — they are mapped,
  // asked about and filled in one pass, and the loop carries on around them.
  // Batch filling maps fields to facts about THE USER; a recipient, a subject or a
  // message body is task content the loop writes from the goal, and it is the loop
  // that decides the node is done.
  return runActNode(
    { kind: "act", id: node.id, intent: node.intent, success: node.success, ...(node.site ? { site: node.site } : {}) },
    opts,
    pad,
    state,
    { node, seen: new Set() },
  );
}

/** Fields a fill node can batch: empty, enabled, never a credential. */
function batchable(raw: RawSnapshot, seen: Set<string>): RawSnapshot["elements"] {
  return raw.elements.filter(
    (e) =>
      e.fillable &&
      !e.value &&
      !e.st?.includes("disabled") &&
      e.role !== "password" &&
      !FORBIDDEN_FIELD.test(e.name) &&
      !seen.has(e.fp),
  );
}

/**
 * The batch pass over the fields visible now that this node has not seen before:
 * map them all to what is known in ONE call, ask the user once for what is not, fill.
 * Every field it considers is marked seen, filled or not, so a field is mapped and
 * asked about once per node however many times the loop comes back.
 */
async function batchFill(
  form: FormPass,
  raw: RawSnapshot,
  opts: Ctx,
  pad: Scratchpad,
  state: LoopState,
): Promise<RunStatus | null> {
  const { node } = form;
  const fields = batchable(raw, form.seen);
  for (const f of fields) form.seen.add(f.fp);

  const profile = (pad.get("profile") ?? {}) as Record<string, string>;
  // `resumeFile` is a path on disk, not a value to type. Offering it as a mapping
  // target put "/Users/…/resume.txt" into two text boxes on a real application.
  // Files are attached through ATTACH, which is a separate operation for this reason.
  // Everything the agent can offer a field: profile facts, plus answers the user
  // has already given during this run. One keyspace, so a question worded
  // differently on the next site still matches what was answered on the last one.
  // `resumeFile` is excluded: it names a path, and files go through ATTACH.
  const answers = (pad.get("answers") ?? {}) as Record<string, { question: string; value: string }>;
  const criteria: Record<string, string> = {};
  for (const key of Object.keys(profile)) {
    if (NOT_TYPEABLE.has(key)) continue;
    criteria[key] = PROFILE_FIELDS[key as ProfileKey] ?? key;
  }
  for (const [key, a] of Object.entries(answers)) {
    criteria[key] = `the user's own answer to: "${a.question}"`;
  }

  // Nothing to map onto means nothing to ask the model about.
  const mapped = Object.keys(criteria).length
    ? await opts.capabilities.mapFields({
        page: { url: raw.url, title: raw.title },
        fields: fields.map(toSnapshotElement),
        criteria,
      })
    : { mappings: [], costUsd: 0 };
  const mappings = mapped.mappings;
  state.steps += 1;
  state.cost += mapped.costUsd;

  const valueFor = (key: string): string | undefined =>
    profile[key] ?? answers[key]?.value ?? undefined;

  // Anything still unanswered goes to the user ONCE, as a batch. Their answers are
  // stored so the next nine applications fill them without asking again.
  const unknown: MissingField[] = [];
  // With nothing known, every field comes back __none and there is nothing to map
  // onto — so ask about the fields themselves rather than reporting "filled 0/26"
  // as though the model had failed.
  const nothingKnown = !Object.keys(criteria).length;
  for (const m of nothingKnown ? fields.map((f) => ({ eid: f.eid, label: f.name, key: NO_FIELD, confidence: 0, skipped: true })) : mappings) {
    // Content the request supplies (a recipient, a message) is not the user's to be
    // asked: the finishing loop writes it from the goal.
    if (m.key === TASK_FIELD) continue;
    if (!m.skipped && valueFor(m.key)) continue;
    // Already answered once. The model matches a differently-worded question to the
    // stored answer through `criteria`; this catches the identical wording, which is
    // what the same form on the next posting actually presents.
    if (answers[stableKey(m.label)]) continue;
    const el = raw.elements.find((e) => e.eid === m.eid);
    if (!el) continue;
    unknown.push({
      key: stableKey(m.label),
      label: m.label,
      role: el.role,
      required: el.st?.includes("required") ?? false,
    });
  }

  if (unknown.length && opts.ask) {
    const given = await opts.ask(unknown);
    const next = { ...answers };
    for (const [key, value] of Object.entries(given)) {
      if (!value?.trim()) continue;
      const asked = unknown.find((u) => u.key === key);
      next[key] = { question: asked?.label ?? key, value };
    }
    pad.set("answers", next);
    opts.emit({
      type: "asked",
      nodeId: node.id,
      count: unknown.length,
      answered: Object.keys(given).length,
    });
    Object.assign(answers, next);
  }

  const byEid = new Map(raw.elements.map((e) => [e.eid, e]));
  let filled = 0;
  const skipped: string[] = [];

  // After asking, a field the user just answered is fillable even though the mapper
  // never saw a candidate for it.
  const fillable = mappings.length
    ? mappings
    : fields
        .map((f) => ({ eid: f.eid, label: f.name, key: stableKey(f.name), confidence: 1, skipped: false }))
        .filter((m) => answers[m.key]);

  for (const m of fillable) {
    if (opts.signal?.aborted) return "aborted";
    const element = byEid.get(m.eid);
    if (!element) continue;

    // Straight from the profile, from an answer given earlier, or from what the user
    // has just typed for this exact question.
    const extra = node.extras?.[m.key];
    const value =
      (extra ? String(pad.resolve(extra) ?? "") : "") ||
      valueFor(m.key) ||
      answers[stableKey(m.label)]?.value ||
      "";
    if (!value) {
      skipped.push(m.label);
      continue;
    }
    const reused = !profile[m.key] ? answers[m.key] : undefined;
    if (reused) opts.emit({ type: "reused", field: m.label, from: reused.question });

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
      opts.emit({ type: "text", field: m.label, value, latencyMs: 0, costUsd: 0 });
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
    type: "warn",
    nodeId: node.id,
    message: `filled ${filled}/${fields.length}${skipped.length ? `, left blank: ${skipped.slice(0, 5).join(", ")}` : ""}`,
  });
  return null;
}

/** A fill node's batch pass, riding along with the step loop that finishes the node. */
interface FormPass {
  node: Extract<Node, { kind: "fill" }>;
  /** Fingerprints of fields already mapped (or asked about) in this node. */
  seen: Set<string>;
}

async function runReadNode(
  node: Extract<Node, { kind: "read" }>,
  opts: Ctx,
  pad: Scratchpad,
): Promise<RunStatus> {
  await arrive(node, null, opts);
  const raw = await opts.executor.snapshot();
  const body = await opts.executor.pageText();
  // A list that a loop will walk needs each item's link, or the loop cannot reach the
  // items: ask for it whatever shape the planner sketched.
  const feedsLoop = loopsOver(opts.plan.nodes).has(scratchKey(node.into));
  const value = await opts.capabilities.extract({
    intent: feedsLoop
      ? `${node.intent}\n\nFor every item, include "url": the absolute link that opens that item, taken from the page's links.`
      : node.intent,
    schema: node.schema,
    pageText: `${raw.title}\n${raw.url}\n\n${body}`.slice(0, 60_000),
  });
  pad.set(node.into, value);
  opts.emit({
    type: "node:done",
    id: node.id,
    detail: `-> ${node.into} (${body.length} chars from ${new URL(raw.url).pathname})`,
  });
  return "done";
}

/**
 * Draw the answer on the page. The model is shown the ranked elements and may only
 * mark those — an id it was not shown is dropped, not guessed at — and the marks are
 * numbered in the order it gave them, which is the order the person should read.
 */
async function runExplainNode(
  node: Extract<Node, { kind: "explain" }>,
  opts: Ctx,
  pad: Scratchpad,
  state: LoopState,
): Promise<RunStatus> {
  await arrive(node, null, opts);
  const raw = await opts.executor.snapshot();
  const ranked = rankedSnapshot(raw, node.intent, DEFAULT_EXPLAIN_CAP);
  const text = await opts.executor.pageText(12_000);
  const answer = await opts.capabilities.explain({
    intent: withItem(node.intent, state),
    page: { url: raw.url, title: raw.title },
    elements: ranked.elements,
    text,
  });

  const shown = new Set(ranked.elements.map((e) => e.eid));
  const byEid = new Map(raw.elements.map((e) => [e.eid, e]));
  const seen = new Set<string>();
  const notes = answer.notes
    .filter((n) => shown.has(n.eid) && !seen.has(n.eid) && Boolean(seen.add(n.eid)))
    .slice(0, MAX_NOTES)
    .flatMap((n) => {
      const el = byEid.get(n.eid);
      return el ? [{ el, note: n.note.trim() }] : [];
    });

  const drawn = await opts.executor.annotate(
    notes.map((n, i) => ({ node: n.el.node, fp: n.el.fp, n: i + 1, note: n.note })),
  );
  for (const r of drawn.refused) opts.emit({ type: "warn", nodeId: node.id, message: `could not mark ${r}` });

  const result: ExplainResult = {
    summary: answer.summary,
    notes: notes.map((n, i) => ({ n: i + 1, note: n.note, target: n.el.name })),
  };
  // Stored even without `into`: for "what am I looking at" the explanation IS the result.
  pad.set(node.into ?? node.id, result);
  opts.emit({ type: "explain", nodeId: node.id, ...result });
  opts.emit({ type: "node:done", id: node.id, detail: `marked ${drawn.drawn} on the page` });
  return "done";
}

async function runComposeNode(
  node: Extract<Node, { kind: "compose" }>,
  opts: Ctx,
  pad: Scratchpad,
): Promise<RunStatus> {
  const inputs = Object.fromEntries(node.from.map((k) => [k, pad.get(k)]));
  // The goal is not passed here: capabilities are bound to the run and carry it. It
  // used to be an argument, and the model once answered "I don't have enough
  // information" because a caller had not forwarded it.
  pad.set(node.into, await opts.capabilities.compose({ intent: node.intent, inputs }));
  return "done";
}

async function runConfirmNode(
  node: Extract<Node, { kind: "confirm" }>,
  opts: Ctx,
  pad: Scratchpad,
  state: LoopState,
): Promise<RunStatus> {
  const preview = SCRATCH_REF.test(node.preview)
    ? String(pad.resolve(node.preview) ?? node.preview)
    : node.preview;
  const risk = node.risk ?? "none";

  // A hand-off is not an approval: sign-ins, credentials, CAPTCHAs need the person to
  // act, whatever authority they granted — "go ahead" cannot mean "type my password".
  const handoff = risk === "auth";

  // Otherwise the plan says WHERE the gates are and the user's words say whether to
  // ask. Confirm nodes used to ask unconditionally, so "email Sam to say the build is
  // ready" still stopped for approval — the same policy the act loop already applied,
  // missing here.
  const autonomy = opts.autonomy ?? "confirm";
  if (!handoff && autonomy === "full") {
    opts.emit({ type: "warn", nodeId: node.id, message: `went ahead without asking — you asked for it to be done` });
    return "done";
  }
  if (!handoff && (autonomy === "never" || opts.batchApprovals)) {
    // Held for the person: the gated step is skipped, and everything else goes on.
    state.pending.push({
      nodeId: node.id,
      url: await opts.executor.url(),
      operation: "CONFIRM",
      target: preview,
      risk,
      ...(state.currentItem !== undefined ? { item: state.currentItem } : {}),
    });
    opts.emit({ type: "queued", nodeId: node.id, preview, risk });
    state.skipNext = true;
    return "done";
  }

  opts.emit({ type: "approval", nodeId: node.id, preview, risk });
  const ok = !handoff && opts.approve ? await opts.approve(preview, risk) : false;
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

/**
 * Coerce whatever a `read` node produced into the list a foreach wants.
 *
 * An extraction asked for a list of jobs comes back as `{ jobs: [...] }` about as
 * often as a bare array — it is the natural shape for a JSON object — and the plan
 * then points `over` at the container. Refusing that reported "the collection is
 * empty" while the collection was plainly sitting in the scratchpad.
 */
function asCollection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const arrays = Object.values(value).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0] as unknown[];
  }
  return [];
}

/** `min` counts SUCCESSES, not attempts — a failing site must not reduce the count. */
async function runForeachNode(
  node: Extract<Node, { kind: "foreach" }>,
  opts: Ctx,
  pad: Scratchpad,
  state: LoopState,
): Promise<RunStatus> {
  const items = asCollection(pad.resolve(node.over));
  if (!items.length) {
    opts.emit({ type: "warn", nodeId: node.id, message: `"${node.over}" is empty or missing` });
    return "blocked";
  }

  const seen = new Set<string>();
  let succeeded = 0;
  const max = node.max ?? items.length;

  const outer = state.iteration;
  // Every iteration is independent and starts in the same place: at the item's own
  // link when it has one, otherwise where the loop began (the list). The second of two
  // job applications once "started" on the first job's page, and applied there again.
  const home = await opts.executor.url();
  for (const [index, item] of items.entries()) {
    if (succeeded >= max) break;
    if (state.steps >= state.budget) return "budget";

    if (node.distinctBy && item && typeof item === "object") {
      const key = String((item as Record<string, unknown>)[node.distinctBy] ?? "");
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
    }

    pad.set(node.as, item);
    const previousItem = state.currentItem;
    state.currentItem = item;
    state.iteration = outer === undefined ? String(index) : `${outer}.${index}`;
    const at = itemUrl(item) ?? home;
    if (at && at !== (await opts.executor.url())) await navigateTo(at, node.id, opts);
    const status = await runNodes(node.do, opts, pad, state).finally(() => {
      state.iteration = outer;
    });
    state.currentItem = previousItem;
    if (status === "suspended" || status === "budget" || status === "aborted") return status;
    if (status === "done") succeeded += 1;
    else opts.emit({ type: "warn", nodeId: node.id, message: "one iteration did not complete" });
  }

  if (node.min !== undefined && succeeded < node.min) {
    opts.emit({
      type: "warn",
      nodeId: node.id,
      message: `only ${succeeded} of ${node.min} required iterations succeeded`,
    });
    return "blocked";
  }
  return "done";
}

function isPointable(action: { kind: string }): boolean {
  return action.kind === "click" || action.kind === "type" || action.kind === "select";
}

/** What the cursor says in show mode: an instruction to the person, not a log line. */
function showMessage(action: { kind: string; option?: string }, label: string): string {
  const quoted = label ? `\u201c${label}\u201d` : "";
  if (action.kind === "type") return quoted ? `Type in ${quoted}` : "Type here";
  if (action.kind === "select") return `Choose \u201c${action.option ?? ""}\u201d${quoted ? ` in ${quoted}` : ""}`;
  return quoted ? `Click ${quoted}` : "Click here";
}

/**
 * Show mode: wait for the person to do what the cursor points at — the page changing
 * is how we know. Polls rather than listening, so it works the same in both executors.
 */
async function waitForPerson(opts: Ctx, before: string): Promise<boolean | "aborted"> {
  const deadline = Date.now() + (opts.showWaitMs ?? 45_000);
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return "aborted";
    await new Promise((r) => setTimeout(r, Math.min(800, opts.showWaitMs ?? 800)));
    const now = await opts.executor.snapshot().catch(() => null);
    if (now && now.contentHash !== before) return true;
  }
  return false;
}

/**
 * Go where a node happens before doing it.
 *
 * ONE rule for every node that touches a page — act, fill and read alike. It used to
 * live inside the act node only, so a fill or read node marked with a `site` simply
 * ran on whatever page happened to be open: a job application's form was "filled" on
 * the listings page, found nothing, and reported success.
 *
 * A step that already carries a URL is a navigation, not a decision: asking the model
 * instead left every iteration of a loop on the previous item's page.
 */
async function arrive(
  node: { id: string; site?: string | undefined },
  explicit: string | null,
  opts: Ctx,
): Promise<void> {
  const here = await opts.executor.url();
  const destination = explicit ?? siteUrl(node.site, here);
  if (!destination || destination === here) return;
  await navigateTo(destination, node.id, opts);
}

async function navigateTo(url: string, nodeId: string, opts: Ctx): Promise<void> {
  await opts.executor.act({ kind: "navigate", url }, null, { pageKey: null, nodeGuard: null });
  await opts.executor.settle(null, false);
  // Progress, not completion: emitting node:done here marked the step finished in the
  // UI after 38ms, before it had done any of the work it was for.
  opts.emit({
    type: "step",
    nodeId,
    action: { kind: "navigate", url },
    operation: "NAVIGATE",
    risk: "none",
    latencyMs: 0,
    costUsd: 0,
  });
}

/**
 * Where a loop item lives, if it says. Items extracted from a list — jobs, products,
 * posts — usually carry their own link, and "process each one" starts THERE. A body
 * whose first node forgot to navigate otherwise processed the list page N times.
 */
function itemUrl(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
    if (!/url|link|href/i.test(key) || typeof value !== "string") continue;
    if (/^https?:\/\//.test(value)) return value;
  }
  return null;
}

/**
 * A node that belongs to a different site, resolved to somewhere to go.
 *
 * The action space has no NAVIGATE operation — JEV chooses between options and
 * cannot invent a URL — so without this, "open BookMyShow and search for a film"
 * was simply unreachable from another site. The planner already marks these nodes
 * with `site`; nothing was acting on it.
 */
function siteUrl(site: string | undefined, currentUrl: string): string | null {
  if (!site) return null;
  const target = /^https?:\/\//.test(site) ? site : `https://${site.replace(/^\/+/, "")}`;
  try {
    const to = new URL(target);
    const here = currentUrl ? new URL(currentUrl) : null;
    // Already on that site: a same-origin `site` is a label, not an instruction, and
    // acting on it would throw away whatever page the user is actually on.
    if (here && here.origin === to.origin) return null;
    // A bare origin with no path is just "this site" — nothing more specific to go to.
    return to.toString();
  } catch {
    return null;
  }
}

/** The destination a node already knows, if any. */
function urlSlot(slots: Record<string, string> | undefined, pad: Scratchpad): string | null {
  if (!slots) return null;
  for (const [key, raw] of Object.entries(slots)) {
    if (!/\b(url|link|href|page|destination)\b/i.test(key)) continue;
    const value = SCRATCH_REF.test(raw) ? pad.resolve(raw) : raw;
    if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
  }
  return null;
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
