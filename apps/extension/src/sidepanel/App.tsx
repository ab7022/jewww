import { useCallback, useEffect, useState } from "react";
import type { PanelState, ToWorker } from "../shared/messages.js";

const send = <T,>(msg: ToWorker): Promise<T> =>
  chrome.runtime.sendMessage(msg) as Promise<T>;

const EMPTY: PanelState = { signedIn: false, running: false, log: [] };

export function App(): JSX.Element {
  const [state, setState] = useState<PanelState>(EMPTY);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setState(await send<PanelState>({ kind: "state" }));
  }, []);

  useEffect(() => {
    void refresh();
    // The worker pushes state after every run event, and may be restarted at any
    // time by MV3 — so also poll, or the panel can sit on a stale view forever.
    const listener = (msg: { kind?: string; state?: PanelState }) => {
      if (msg?.kind === "state" && msg.state) setState(msg.state);
    };
    chrome.runtime.onMessage.addListener(listener);
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearInterval(timer);
    };
  }, [refresh]);

  const start = async () => {
    if (!goal.trim()) return;
    setBusy(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await send({ kind: "start", goal: goal.trim(), tabId: tab.id });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!state.signedIn) {
    return (
      <div className="wrap">
        <header>
          <h1>Jev Browser Agent</h1>
        </header>
        <div className="body">
          <p className="muted">
            Sign in to run tasks. Your model usage is billed against your credit balance.
          </p>
          <button
            className="primary"
            onClick={async () => {
              setBusy(true);
              try {
                await send({ kind: "signIn" });
                await refresh();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>Jev Browser Agent</h1>
          <div className="muted">{state.email}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="muted">{state.credits?.toFixed(0) ?? "—"} credits</div>
          <button onClick={() => void send({ kind: "signOut" }).then(refresh)}>Sign out</button>
        </div>
      </header>

      <div className="body">
        <textarea
          placeholder="What should it do on this tab?  e.g. find the pricing page and tell me what the pro plan costs"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          disabled={state.running}
        />
        <div className="row">
          <button className="primary" onClick={() => void start()} disabled={busy || state.running}>
            {state.running ? "Running…" : "Run"}
          </button>
          {state.running && (
            <button className="danger" onClick={() => void send({ kind: "abort" }).then(refresh)}>
              Stop
            </button>
          )}
          {state.status && <span className="muted">{state.status}</span>}
        </div>

        {state.pending && (
          <div className="approve">
            <span className="risk">
              needs your approval{state.pending.risk !== "none" ? ` · ${state.pending.risk}` : ""}
            </span>
            <strong>{state.pending.preview}</strong>
            <span className="muted">
              This cannot be undone. Nothing happens until you approve it.
            </span>
            <div className="row">
              <button
                className="primary"
                onClick={() => void send({ kind: "approve", approved: true }).then(refresh)}
              >
                Approve
              </button>
              <button onClick={() => void send({ kind: "approve", approved: false }).then(refresh)}>
                Skip
              </button>
            </div>
          </div>
        )}

        <div className="log">{state.log.join("\n") || "no activity yet"}</div>
      </div>
    </div>
  );
}
