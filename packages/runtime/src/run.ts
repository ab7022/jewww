
import type { Autonomy, Decision, FieldMapping } from "@jev-browser/policy";
import { escalationReason } from "@jev-browser/policy";
import { DEFAULT_CAP, rankedSnapshot, toSnapshotElement } from "@jev-browser/sense";
import {
  BLOCKER,
  type ComposeRequest,
  type DecideRequest,
  type Executor,
  type ExtractRequest,
  FORBIDDEN_FIELD,
  type MapFieldsRequest,
  type Node,
  NO_FIELD,
  PHYSICALLY_UNREACHABLE,
  PROFILE_FIELDS,
  type ProfileKey,
  type Plan,
  type RecentAction,
  SCRATCH_REF,
  StalePage,
  type TextRequest,
  UnreachableTarget,
} from "@jev-browser/shared";
import type { Ask, Emit, GatedAction, MissingField, RunEvent, RunStatus } from "./events.js";
import { Scratchpad } from "./scratchpad.js";

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
        case "confirm":
          status = await runConfirmNode(node, opts, pad);
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
): Promise<RunStatus> {
  // A step that already carries a URL is a navigation, not a decision. Asking the
  // model what to do instead left every iteration of a loop on the previous item's
  // page — eight applications in a row were filled against the same company,
  // because "an application form is visible" was true of the page it never left.
  const here = await opts.executor.url();
  const destination = urlSlot(node.slots, pad) ?? siteUrl(node.site, here);
  if (destination && destination !== here) {
    await opts.executor.act({ kind: "navigate", url: destination }, null, {
      pageKey: null,
      nodeGuard: null,
    });
    await opts.executor.settle(null, false);
    // Progress, not completion: emitting node:done here marked the step finished in
    // the UI after 38ms, before it had done any of the work it was for.
    opts.emit({
      type: "step",
      nodeId: node.id,
      action: { kind: "navigate", url: destination },
      operation: "NAVIGATE",
      risk: "none",
      latencyMs: 0,
      costUsd: 0,
    });
  }

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
      subgoal: node.intent,
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
          subgoal: node.intent,
          field: {
            label: d.target?.label ?? "",
            role: d.target?.role ?? "textbox",
            ...(d.target?.value ? { value: d.target.value } : {}),
          },
          page: { title: capped.title, text: capped.text.slice(0, 8000) },
          ...(opts.profile ? { profile: opts.profile } : {}),
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
    type: "node:done",
    id: node.id,
    detail: `filled ${filled}/${fields.length}${skipped.length ? `, left blank: ${skipped.slice(0, 5).join(", ")}` : ""}`,
  });
  // Having filled nothing is only a failure when there was something to fill.
  return filled > 0 || fields.length === 0 ? "done" : "blocked";
}

async function runReadNode(
  node: Extract<Node, { kind: "read" }>,
  opts: Ctx,
  pad: Scratchpad,
): Promise<RunStatus> {
  const raw = await opts.executor.snapshot();
  const body = await opts.executor.pageText();
  const value = await opts.capabilities.extract({
    intent: node.intent,
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
): Promise<RunStatus> {
  const preview = SCRATCH_REF.test(node.preview)
    ? String(pad.resolve(node.preview) ?? node.preview)
    : node.preview;
  opts.emit({
    type: "approval",
    nodeId: node.id,
    preview,
    risk: node.risk ?? "none",
  });
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
