import { runPlan } from "@jev-browser/runtime";
import type { MissingField, RunStatus } from "@jev-browser/runtime";
import { ExplainResult, explainText } from "@jev-browser/shared";
import { ApiError } from "@jev-browser/protocol";
import { API_BASE } from "../shared/config.js";
import { Api } from "./api.js";
import { canRunOn, TabExecutor } from "./executor.js";
import type { ToWorker } from "../shared/messages.js";
import { EMPTY_STATE, type PanelState, parseState, type TimelineStep } from "../shared/state.js";
import { applyEvent, stepTitle } from "../shared/timeline.js";

/**
 * The orchestrator.
 *
 * MV3 kills this worker after ~30s idle, mid-run. State is written to
 * chrome.storage.local after every event, an alarm keeps the worker warm while a run
 * is active, and the server holds the authoritative run record.
 */
const STATE = "panelState";
const KEEPALIVE = "jev-keepalive";
/** Enough to find last week's run, not enough to make the panel a filing cabinet. */
const HISTORY_MAX = 25;

const api = new Api(API_BASE);

// The conformance gauntlet drives the real TabExecutor from here. Present only in the
// test build; Vite removes this branch from the shipped one.
if (import.meta.env.MODE === "test") {
  (globalThis as unknown as { __jevTest: unknown }).__jevTest = { TabExecutor };
}

/** The run in flight, if any. One at a time. */
let active: {
  controller: AbortController;
  approval: ((approved: boolean) => void) | null;
  answers: ((values: Record<string, string>) => void) | null;
} | null = null;

// --- state ------------------------------------------------------------------

/** Read storage from any build into a valid state. See shared/state.ts. */
async function getState(): Promise<PanelState> {
  const stored = (await chrome.storage.local.get(STATE))[STATE];
  return stored === undefined ? { ...EMPTY_STATE } : parseState(stored);
}

/**
 * The ONLY way state changes: a function of the current state, run inside a
 * serialised queue.
 *
 * Events arrive faster than a storage round trip. The previous `record` read the state
 * outside the queue and then wrote a patch, so two quick events both read the same
 * steps and the second overwrote the first — the lost update the queue existed to
 * prevent. Reading inside the queue is what makes it actually serial.
 */
let writes: Promise<unknown> = Promise.resolve();

function update(fn: (state: PanelState) => Partial<PanelState>): Promise<PanelState> {
  const run = writes.then(async () => {
    const current = await getState();
    const state = parseState({ ...current, ...fn(current) });
    await chrome.storage.local.set({ [STATE]: state });
    chrome.runtime.sendMessage({ kind: "state", state }).catch(() => {});
    return state;
  });
  writes = run.catch(() => {});
  return run;
}

const patch = (next: Partial<PanelState>) => update(() => next);

// --- run ------------------------------------------------------------------------

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.alarms.onAlarm.addListener(() => {
  // Exists only to keep the worker alive while a run is in flight.
});

/**
 * What the run actually produced, for the panel to show. A correct summary that was
 * computed and never displayed is the same as no summary.
 */
function describeResult(data: Record<string, unknown>): string | undefined {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === "profile" || key === "answers") continue;
    const explained = ExplainResult.safeParse(value);
    parts.push(
      explained.success ? explainText(explained.data) : typeof value === "string" ? value : JSON.stringify(value, null, 2),
    );
  }
  const text = parts.join("\n\n").trim();
  return text ? text.slice(0, 4000) : undefined;
}

function explain(err: unknown): string {
  if (err instanceof ApiError && err.status === 402) return "You're out of credits.";
  return err instanceof Error ? err.message : String(err);
}

async function start(goal: string, tabId: number): Promise<void> {
  if (active) throw new Error("A task is already running — stop it first.");
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? "";
  if (!/^https?:/.test(url)) throw new Error(`this tab is on ${url || "an internal page"}`);
  if (!(await canRunOn(tabId))) {
    throw new Error(`No access to ${new URL(url).host}. Grant it when asked, then run again.`);
  }

  // The tab must be able to answer before anything else happens.
  const executor = new TabExecutor(tabId);
  await executor.ensureContentScript();

  const controller = new AbortController();
  active = { controller, approval: null, answers: null };
  const started = Date.now();
  // Measured from before planning, so the plan's own cost is part of the total.
  const before = (await getState()).credits;
  let runId: string | undefined;

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
    questions: undefined,
  });

  let status: RunStatus | "error" = "error";
  let steps = 0;
  let result: string | undefined;
  let queued: PanelState["queued"];
  try {
    // Autonomy, profile and plan all come from the server — the client no longer
    // decides how much authority the user's words granted, or merges their details.
    const context = await api.createRun(goal, url);
    runId = context.runId;

    // Draw the whole plan at once, greyed out: seeing what it intends to do before it
    // does any of it is most of the reassurance this interface has to give.
    const planned: TimelineStep[] = context.plan.nodes.map((n) => ({
      id: n.id,
      title: stepTitle(n.intent),
      kind: n.kind,
      status: "pending",
      actions: [],
    }));
    await patch({ credits: context.balance, status: "running", steps: planned });

    const outcome = await runPlan({
      capabilities: api.capabilities(context.runId),
      executor,
      plan: context.plan,
      autonomy: context.autonomy,
      mode: context.mode,
      signal: controller.signal,
      emit: (e) => {
        void update((s) => ({ steps: applyEvent(s.steps, e) }));
      },
      ...(Object.keys(context.profile).length ? { profile: context.profile } : {}),
      approve: () =>
        new Promise<boolean>((resolve) => {
          if (controller.signal.aborted) return resolve(false);
          if (active) active.approval = resolve;
        }),
      ask: (missing: MissingField[]) =>
        new Promise<Record<string, string>>((resolve) => {
          if (controller.signal.aborted || !active) return resolve({});
          active.answers = resolve;
          void patch({ questions: missing });
        }),
    });

    status = outcome.status;
    steps = outcome.steps;
    result = describeResult(outcome.data);
    queued = outcome.pending.length
      ? outcome.pending.map((p) => ({
          preview: `${p.operation === "CLICK" ? "Click" : p.operation.toLowerCase()} “${p.target}”`,
          risk: p.risk,
        }))
      : undefined;
  } catch (err) {
    status = controller.signal.aborted ? "aborted" : "error";
    await patch({ error: explain(err) });
  } finally {
    await executor.hideCursor();
    executor.detach();
    await chrome.alarms.clear(KEEPALIVE).catch(() => {});
    active = null;

    if (runId) await api.finish(runId, status, steps, result).catch(() => {});
    const me = await api.me().catch(() => null);
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    await update((s) => {
      const credits = before !== undefined && me ? Math.round(Math.max(0, before - me.credits) * 10) / 10 : 0;
      return {
        running: false,
        status,
        result,
        queued,
        questions: undefined,
        summary: { steps, credits, seconds },
        ...(me ? { credits: me.credits } : {}),
        history: runId
          ? [{ id: runId, goal, status, steps, credits, seconds, at: Date.now() }, ...s.history].slice(0, HISTORY_MAX)
          : s.history,
      };
    });
  }
}

// --- messages -----------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg: ToWorker, _sender, sendResponse) => {
  (async () => {
    switch (msg.kind) {
      // Local only. The panel polls this every second or so to stay honest across
      // worker restarts; it used to make two server calls each time — thousands a day
      // from one idle panel, every one a chance for a network hiccup to show up.
      case "state":
        return sendResponse(await getState());
      // The account, from the server: when the panel opens, after signing in or out,
      // and when a run ends (credits changed). Stored, so `state` carries it.
      case "account": {
        const auth = await api.config().catch(() => undefined);
        const me = (await api.tokens()) ? await api.me().catch(() => null) : null;
        return sendResponse(
          await patch({
            signedIn: me !== null,
            ...(auth ? { auth } : {}),
            ...(me ? { email: me.email, credits: me.credits } : {}),
          }),
        );
      }
      case "signIn":
        await api.signIn();
        return sendResponse(await patch({ signedIn: true }));
      case "signInDev":
        await api.signInDev();
        return sendResponse(await patch({ signedIn: true }));
      case "signOut":
        await api.signOut();
        return sendResponse(await update(() => ({ ...EMPTY_STATE })));
      case "getProfile":
        return sendResponse(await api.profile().catch(() => ({ fields: {}, instructions: "" })));
      case "saveProfile":
        await api.saveProfile(msg.fields, msg.instructions);
        return sendResponse({ ok: true });

      case "approve": {
        const resolve = active?.approval;
        if (active) active.approval = null;
        await update((s) => ({
          steps: s.steps.map((step) => {
            if (step.status !== "waiting") return step;
            const { prompt: _prompt, ...rest } = step;
            return {
              ...rest,
              status: msg.approved ? ("running" as const) : ("failed" as const),
              actions: [...step.actions, { kind: "note" as const, text: msg.approved ? "You approved this" : "You skipped this" }],
            };
          }),
        }));
        resolve?.(msg.approved);
        return sendResponse({ ok: true });
      }

      case "answer": {
        const resolve = active?.answers;
        if (active) active.answers = null;
        await patch({ questions: undefined });
        resolve?.(msg.values);
        return sendResponse({ ok: true });
      }

      case "reset": {
        if (active) throw new Error("Stop the running task before resetting.");
        // Clear the run; keep the account and the record of past runs. Wiping history
        // would make it pointless, since a reset is exactly what you do after a run.
        const cleared = await update((s) => ({
          ...EMPTY_STATE,
          signedIn: s.signedIn,
          ...(s.auth ? { auth: s.auth } : {}),
          ...(s.email ? { email: s.email } : {}),
          ...(s.credits !== undefined ? { credits: s.credits } : {}),
          history: s.history,
        }));
        return sendResponse(cleared);
      }

      case "abort": {
        // Stop means stop: the runtime checks this signal before every step and before
        // touching the page. Anything waiting on the person is released as a "no".
        active?.controller.abort();
        active?.approval?.(false);
        active?.answers?.({});
        return sendResponse({ ok: true });
      }

      case "listening": {
        // Best effort: a tab we have no access to simply shows no pill.
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          await chrome.tabs.sendMessage(tab.id, { kind: "cursor", listening: msg.on }).catch(() => {});
        }
        return sendResponse({ ok: true });
      }

      case "start":
        start(msg.goal, msg.tabId).catch(async (err: unknown) => {
          await patch({ running: false, status: "error", error: explain(err) });
        });
        return sendResponse({ ok: true });
    }
  })().catch((err: unknown) => sendResponse({ ok: false, error: explain(err) }));
  return true;
});
