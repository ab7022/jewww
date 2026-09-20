import { type Capabilities, runPlan } from "@jev-browser/runtime";
import type { RunEvent } from "@jev-browser/runtime";
import { Api } from "./api.js";
import { hasHostPermission, TabExecutor } from "./executor.js";
import type { PanelState, ToWorker } from "../shared/messages.js";
import { humanize, phrase, stepTitle, type TimelineStep } from "../shared/timeline.js";

/**
 * The orchestrator.
 *
 * MV3 kills this worker after ~30s idle, mid-run. Three things make that survivable:
 * state is written to chrome.storage.local (not session — these runs outlive the
 * browser) after every event, an alarm keeps the worker warm while a run is active,
 * and the server holds the authoritative run record.
 */
const API_BASE = "http://localhost:8787";
const STATE = "panelState";
const KEEPALIVE = "jev-keepalive";

const api = new Api(API_BASE);

let pendingApproval: ((approved: boolean) => void) | null = null;
let aborted = false;

const empty: PanelState = { signedIn: false, running: false, steps: [], history: [] };

/** Enough to find last week's run, not enough to make the panel a filing cabinet. */
const HISTORY_MAX = 25;

/**
 * Read the persisted panel state, tolerating a shape written by an older build.
 *
 * chrome.storage survives an extension update, so a state saved before `steps`
 * existed came back without it and the panel crashed on `state.steps.map` — a blank
 * side panel with no clue why. Anything unrecognised is dropped rather than trusted.
 */
async function getState(): Promise<PanelState> {
  const stored = (await chrome.storage.local.get(STATE))[STATE] as Partial<PanelState> | undefined;
  if (!stored) return empty;
  return {
    ...empty,
    ...stored,
    steps: Array.isArray(stored.steps)
      ? stored.steps.filter((s) => s && typeof s.id === "string" && Array.isArray(s.actions))
      : [],
    history: Array.isArray(stored.history)
      ? stored.history.filter((h) => h && typeof h.goal === "string").slice(0, HISTORY_MAX)
      : [],
  };
}

/**
 * Serialised, because patch() reads then writes.
 *
 * Run events arrive faster than a storage round trip, so two concurrent patches both
 * read the same state and the second overwrote the first — which is how a step's
 * failure reason vanished and left a bare ✕ with no explanation.
 */
let writes: Promise<unknown> = Promise.resolve();

async function patch(next: Partial<PanelState>): Promise<PanelState> {
  const run = writes.then(async () => {
    const state = { ...(await getState()), ...next };
    await chrome.storage.local.set({ [STATE]: state });
    chrome.runtime.sendMessage({ kind: "state", state }).catch(() => {});
    return state;
  });
  writes = run.catch(() => {});
  return run;
}

async function record(e: RunEvent): Promise<void> {
  const state = await getState();
  await patch({ steps: applyEvent(state.steps, e) });
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.alarms.onAlarm.addListener(() => {
  // Existing purely to keep the worker alive while a run is in flight.
});

/**
 * What the run actually produced, for the panel to show.
 *
 * A run that reads a page and composes an answer puts it in the scratchpad — and the
 * first real session ended with a correct summary that was never displayed, which
 * makes the whole thing pointless however well it ran.
 */
function describeResult(data: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === "profile" || key === "answers") continue;
    parts.push(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  }
  const text = parts.join("\n\n").trim();
  return text ? text.slice(0, 4000) : undefined;
}

/**
 * Fold run events into the timeline the panel renders.
 *
 * Every event belongs to a step, and the panel only ever needs the current shape of
 * those steps — so this is a reducer over the plan, not a transcript. Returning the
 * steps array lets the worker persist exactly what the UI will draw.
 */
function applyEvent(steps: TimelineStep[], e: RunEvent): TimelineStep[] {
  const next = steps.map((s) => ({ ...s, actions: [...s.actions] }));
  const current = () => next.find((s) => s.status === "running") ?? next[next.length - 1];

  switch (e.type) {
    case "node:start": {
      // The interpreter is sequential, so anything still marked running when the
      // next step begins has in fact finished — several completed steps were
      // showing as in progress at once.
      for (const s of next) {
        if (s.status === "running" && s.id !== e.id) {
          s.status = "done";
          s.endedAt ??= Date.now();
        }
      }
      const existing = next.find((s) => s.id === e.id);
      const step: TimelineStep = {
        id: e.id,
        title: stepTitle(e.intent),
        kind: e.kind,
        status: "running",
        actions: existing?.actions ?? [],
        startedAt: Date.now(),
      };
      // A foreach re-enters the same node ids on every iteration; keep one step and
      // let its actions accumulate rather than drawing the plan ten times over.
      if (existing) Object.assign(existing, { ...step, actions: existing.actions });
      else next.push(step);
      return next;
    }

    case "node:done": {
      const step = next.find((s) => s.id === e.id);
      if (step) {
        step.status = step.status === "waiting" ? "waiting" : "done";
        step.endedAt = Date.now();
        if (e.detail) step.actions.push(humanize(e.detail));
      }
      return next;
    }

    case "step": {
      const step = current();
      if (step && e.action.kind !== "done") {
        step.actions.push(phrase(e.operation, e.action, e.target));
      }
      return next;
    }

    case "text": {
      const step = current();
      // Replace the bare "Typed into X" with what was actually typed: seeing the
      // value is the entire point of watching a form being filled.
      if (step) {
        const last = step.actions[step.actions.length - 1];
        const line = { kind: "type" as const, text: `Typed ${JSON.stringify(e.value.slice(0, 40))} into “${e.field}”` };
        if (last?.kind === "type") step.actions[step.actions.length - 1] = line;
        else step.actions.push(line);
      }
      return next;
    }

    case "reused": {
      current()?.actions.push({ kind: "note", text: `Reused your earlier answer for “${e.field}”` });
      return next;
    }

    case "queued": {
      current()?.actions.push({ kind: "note", text: `Held back for you: ${e.preview}` });
      return next;
    }

    case "warn": {
      current()?.actions.push(humanize(e.message));
      return next;
    }

    case "approval": {
      const step = next.find((s) => s.id === e.nodeId) ?? current();
      if (step) {
        step.status = "waiting";
        step.prompt = {
          preview: e.action ? phrase("", e.action, e.target).text : e.preview,
          risk: e.risk,
          reason: "confirm",
        };
      }
      return next;
    }

    case "suspend": {
      const step = current();
      if (step) {
        step.status = "waiting";
        // Worded from the action itself where we have it, so the prompt reads like a
        // question rather than a log line.
        const preview = e.action ? phrase("", e.action, e.target).text : e.preview;
        step.prompt = { preview, risk: e.risk ?? "none", reason: e.reason };
      }
      return next;
    }

    case "escalate":
      return next; // internal; not something a person needs to see

    default:
      return next;
  }
}

/** Blocks the run until the user answers in the side panel. */
function askApproval(): Promise<boolean> {
  // The prompt is rendered on the step it belongs to, which the suspend event has
  // already marked — nothing extra to store here.
  return new Promise((resolve) => {
    pendingApproval = resolve;
  });
}

async function start(goal: string, tabId: number): Promise<void> {
  aborted = false;
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? "";
  if (!/^https?:/.test(url)) throw new Error(`this tab is on ${url || "an internal page"}`);
  if (!(await hasHostPermission(url))) {
    throw new Error(`No access to ${new URL(url).host}. Grant it when asked, then run again.`);
  }

  // Before anything else: the tab must be able to answer. Doing this up front turns
  // "Receiving end does not exist" into a message that says what is actually wrong.
  const executor = new TabExecutor(tabId);
  await executor.ensureContentScript();

  await chrome.alarms.create(KEEPALIVE, { periodInMinutes: 0.5 });
  await patch({
    running: true,
    goal,
    steps: [],
    status: "planning",
    result: undefined,
    error: undefined,
    summary: undefined,
    queued: undefined,
  });

  const { runId, plan, stated, balance } = await api.createRun(goal, url);

  // Draw the whole plan immediately, greyed out. Seeing what it intends to do before
  // it does any of it is most of the reassurance this interface has to provide.
  const planned: TimelineStep[] = plan.nodes.map((n, i) => ({
    id: n.id ?? `node-${i}`,
    title: stepTitle(n.intent),
    kind: n.kind,
    status: "pending",
    actions: [],
  }));
  await patch({ credits: balance, status: "running", steps: planned });

  // Saved details, overlaid with anything the user stated in the request — what
  // they just typed is more specific than a saved default.
  const saved = await api.profile().catch(() => ({}));
  const profile = { ...saved, ...(stated ?? {}) };

  const capabilities: Capabilities = {
    decide: (input) => api.decide(runId, input.subgoal, input),
    text: (ctx) => api.text(runId, ctx),
    extract: (intent, schema, pageText) => api.extract(runId, intent, schema, pageText),
    compose: (intent, inputs, goal) => api.compose(runId, intent, inputs, goal),
    mapFields: async (input) => ({ mappings: await api.mapFields(runId, input), costUsd: 0 }),
  };

  try {
    const result = await runPlan({
      capabilities,
      executor,
      plan,
      emit: (e) => {
        void record(e);
      },
      ...(Object.keys(profile).length ? { profile } : {}),
      approve: async () => {
        if (aborted) return false;
        return askApproval();
      },
    });
    executor.detach();
    await api.finish(runId, result.status).catch(() => {});
    const me = await api.me().catch(() => null);
    const state = await getState();
    await patch({
      running: false,
      status: result.status,
      result: describeResult(result.data),
      summary: {
        steps: result.steps,
        credits: Math.max(0, (balance ?? 0) - (me?.credits ?? balance ?? 0)),
        seconds: Math.round(result.elapsedMs / 100) / 10,
      },
      ...(result.pending.length
        ? {
            queued: result.pending.map((p) => ({
              preview: `${p.operation === "CLICK" ? "Click" : p.operation.toLowerCase()} “${p.target}”`,
              risk: p.risk,
            })),
          }
        : {}),
      // Anything still running when the loop ends did not finish.
      steps: state.steps.map((s) => (s.status === "running" ? { ...s, status: "failed" as const } : s)),
      ...(me ? { credits: me.credits } : {}),
      history: [
        {
          id: runId,
          goal,
          status: result.status,
          steps: result.steps,
          credits: Math.max(0, (balance ?? 0) - (me?.credits ?? balance ?? 0)),
          seconds: Math.round(result.elapsedMs / 100) / 10,
          at: Date.now(),
        },
        ...(state.history ?? []),
      ].slice(0, HISTORY_MAX),
    });
  } finally {
    executor.detach();
    await chrome.alarms.clear(KEEPALIVE);
    pendingApproval = null;
    await patch({ running: false });
  }
}

chrome.runtime.onMessage.addListener((msg: ToWorker, _sender, sendResponse) => {
  (async () => {
    switch (msg.kind) {
      case "state": {
        const state = await getState();
        const auth = await api.config().catch(() => undefined);
        const tokens = await api.tokens();
        if (!tokens) return sendResponse({ ...state, signedIn: false, ...(auth ? { auth } : {}) });
        const me = await api.me().catch(() => null);
        return sendResponse({
          ...state,
          signedIn: true,
          ...(auth ? { auth } : {}),
          ...(me ? { email: me.email, credits: me.credits } : {}),
        });
      }
      case "signIn":
        await api.signIn();
        return sendResponse(await patch({ signedIn: true }));
      case "signInDev":
        await api.signInDev();
        return sendResponse(await patch({ signedIn: true }));
      case "signOut":
        await api.signOut();
        return sendResponse(await patch({ ...empty }));
      case "getProfile":
        return sendResponse(
          await api.profile().catch(() => ({ fields: {}, instructions: "" })),
        );
      case "saveProfile":
        await api.saveProfile(msg.fields, msg.instructions);
        return sendResponse({ ok: true });
      case "approve": {
        const resolve = pendingApproval;
        pendingApproval = null;
        const state = await getState();
        await patch({
          steps: state.steps.map((s) =>
            s.status === "waiting"
              ? {
                  ...s,
                  status: msg.approved ? ("running" as const) : ("failed" as const),
                  prompt: undefined,
                  actions: [
                    ...s.actions,
                    { kind: "note" as const, text: msg.approved ? "You approved this" : "You skipped this" },
                  ],
                }
              : s,
          ),
        });
        resolve?.(msg.approved);
        return sendResponse({ ok: true });
      }
      case "reset": {
        // Clear the run, keep the account and the record of past runs. The point is
        // to unwedge a stuck run or clear a stale view — signing the user out would
        // mean the whole OAuth dance again, and wiping history would make history
        // pointless, since a reset is exactly what you do after a run.
        const { signedIn, auth, email, credits, history } = await getState();
        await chrome.storage.local.set({
          [STATE]: { ...empty, signedIn, auth, email, credits, history },
        });
        await chrome.alarms.clear(KEEPALIVE).catch(() => {});
        const cleared = await getState();
        chrome.runtime.sendMessage({ kind: "state", state: cleared }).catch(() => {});
        return sendResponse(cleared);
      }
      case "abort":
        aborted = true;
        pendingApproval?.(false);
        pendingApproval = null;
        await patch({ running: false, status: "blocked" });
        return sendResponse({ ok: true });
      case "start":
        start(msg.goal, msg.tabId).catch(async (err: unknown) => {
          await patch({
            running: false,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        });
        return sendResponse({ ok: true });
    }
  })().catch((err: unknown) =>
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});
