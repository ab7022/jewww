import { type Capabilities, runPlan } from "@jev-browser/runtime";
import type { RunEvent } from "@jev-browser/runtime";
import { Api } from "./api.js";
import { ensureHostPermission, TabExecutor } from "./executor.js";
import type { PanelState, ToWorker } from "../shared/messages.js";

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

const empty: PanelState = { signedIn: false, running: false, log: [] };

async function getState(): Promise<PanelState> {
  const stored = await chrome.storage.local.get(STATE);
  return (stored[STATE] as PanelState | undefined) ?? empty;
}

async function patch(next: Partial<PanelState>): Promise<PanelState> {
  const state = { ...(await getState()), ...next };
  await chrome.storage.local.set({ [STATE]: state });
  chrome.runtime.sendMessage({ kind: "state", state }).catch(() => {});
  return state;
}

async function log(line: string): Promise<void> {
  const state = await getState();
  await patch({ log: [...state.log, line].slice(-200) });
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.alarms.onAlarm.addListener(() => {
  // Existing purely to keep the worker alive while a run is in flight.
});

function describe(e: RunEvent): string | null {
  switch (e.type) {
    case "node:start":
      return `${e.kind}  ${e.intent}`;
    case "step":
      return `  ${e.operation}${e.target ? ` "${e.target}"` : ""}${
        e.confidence !== undefined ? `  p=${e.confidence.toFixed(2)}` : ""
      }${e.risk !== "none" ? `  risk=${e.risk}` : ""}`;
    case "text":
      return `  typed "${e.value.slice(0, 60)}"`;
    case "escalate":
      return `  ~~ low confidence on ${e.nodeId}`;
    case "warn":
      return `  !! ${e.message}`;
    case "suspend":
      return `SUSPENDED (${e.reason}) ${e.preview}`;
    case "finish":
      return `${e.status.toUpperCase()} — ${e.steps} steps in ${(e.elapsedMs / 1000).toFixed(1)}s`;
    default:
      return null;
  }
}

/** Blocks the run until the user answers in the side panel. */
function askApproval(preview: string, risk: string): Promise<boolean> {
  return new Promise((resolve) => {
    pendingApproval = resolve;
    void patch({ pending: { preview, risk } });
  });
}

async function start(goal: string, tabId: number): Promise<void> {
  aborted = false;
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? "";
  if (!url.startsWith("http")) throw new Error("open a normal web page first");

  if (!(await ensureHostPermission(url))) {
    await log("permission for this site was declined");
    return;
  }

  await chrome.alarms.create(KEEPALIVE, { periodInMinutes: 0.5 });
  await patch({ running: true, goal, log: [`goal: ${goal}`], status: "planning" });

  const { runId, plan, balance } = await api.createRun(goal, url);
  await patch({ credits: balance, status: "running" });
  await log(`plan: ${plan.nodes.length} nodes`);

  const capabilities: Capabilities = {
    decide: (input) => api.decide(runId, input.subgoal, input),
    text: (ctx) => api.text(runId, ctx),
    extract: (intent, schema, pageText) => api.extract(runId, intent, schema, pageText),
    compose: (intent, inputs) => api.compose(runId, intent, inputs),
    mapFields: async (input) => ({ mappings: await api.mapFields(runId, input), costUsd: 0 }),
  };

  try {
    const result = await runPlan({
      capabilities,
      executor: new TabExecutor(tabId),
      plan,
      emit: (e) => {
        const line = describe(e);
        if (line) void log(line);
      },
      approve: async (preview, risk) => {
        if (aborted) return false;
        return askApproval(preview, risk);
      },
    });
    await api.finish(runId, result.status).catch(() => {});
    const me = await api.me().catch(() => null);
    await patch({
      running: false,
      status: result.status,
      ...(me ? { credits: me.credits } : {}),
    });
  } finally {
    await chrome.alarms.clear(KEEPALIVE);
    pendingApproval = null;
    await patch({ running: false, pending: undefined });
  }
}

chrome.runtime.onMessage.addListener((msg: ToWorker, _sender, sendResponse) => {
  (async () => {
    switch (msg.kind) {
      case "state": {
        const state = await getState();
        const tokens = await api.tokens();
        if (!tokens) return sendResponse({ ...state, signedIn: false });
        const me = await api.me().catch(() => null);
        return sendResponse({
          ...state,
          signedIn: true,
          ...(me ? { email: me.email, credits: me.credits } : {}),
        });
      }
      case "signIn":
        await api.signIn();
        return sendResponse(await patch({ signedIn: true }));
      case "signOut":
        await api.signOut();
        return sendResponse(await patch({ ...empty }));
      case "approve": {
        const resolve = pendingApproval;
        pendingApproval = null;
        await patch({ pending: undefined });
        resolve?.(msg.approved);
        return sendResponse({ ok: true });
      }
      case "abort":
        aborted = true;
        pendingApproval?.(false);
        pendingApproval = null;
        await patch({ running: false, pending: undefined, status: "aborted" });
        return sendResponse({ ok: true });
      case "start":
        start(msg.goal, msg.tabId).catch(async (err: unknown) => {
          await log(`error: ${err instanceof Error ? err.message : String(err)}`);
          await patch({ running: false, status: "error" });
        });
        return sendResponse({ ok: true });
    }
  })().catch((err: unknown) =>
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});
