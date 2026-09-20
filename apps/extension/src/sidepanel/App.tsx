import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelState, ToWorker } from "../shared/messages.js";
import { elapsed, type TimelineStep } from "../shared/timeline.js";

const send = <T,>(msg: ToWorker): Promise<T> => chrome.runtime.sendMessage(msg) as Promise<T>;

const EMPTY: PanelState = { signedIn: false, running: false, steps: [] };

const SUGGESTIONS = [
  "Summarise this page",
  "Find the pricing and tell me what the top plan costs",
  "Fill in this form with my details, but don't submit it",
];

export function App(): JSX.Element {
  const [state, setState] = useState<PanelState>(EMPTY);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await send<PanelState>({ kind: "state" });
    // Belt and braces against a state shape this build does not know: a panel that
    // throws renders nothing at all, with no indication of why.
    setState({ ...EMPTY, ...next, steps: Array.isArray(next?.steps) ? next.steps : [] });
  }, []);

  useEffect(() => {
    void refresh();
    // The worker pushes after every event, but MV3 can restart it at any moment, so
    // a slow poll keeps the panel honest rather than stuck on a stale view.
    const listener = (msg: { kind?: string; state?: PanelState }) => {
      if (msg?.kind === "state" && msg.state) {
        const s = msg.state;
        setState({ ...EMPTY, ...s, steps: Array.isArray(s.steps) ? s.steps : [] });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    const timer = setInterval(() => void refresh(), 1200);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearInterval(timer);
    };
  }, [refresh]);

  const signIn = async (kind: "signIn" | "signInDev") => {
    setBusy(true);
    setError(null);
    try {
      await send({ kind });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!goal.trim() || state.running) return;
    setError(null);
    setBusy(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? "";
      if (!tab?.id || !/^https?:/.test(url)) {
        setError("Open a normal web page in this tab first.");
        return;
      }
      // Asked here, synchronously in the click: chrome.permissions.request only works
      // during a user gesture, never from the worker after an await.
      const origin = `${new URL(url).origin}/*`;
      const granted =
        (await chrome.permissions.contains({ origins: [origin] })) ||
        (await chrome.permissions.request({ origins: [origin] }));
      if (!granted) {
        setError(`Access to ${new URL(url).host} was declined.`);
        return;
      }
      await send({ kind: "start", goal: goal.trim(), tabId: tab.id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!state.signedIn) return <SignIn state={state} busy={busy} error={error} onSignIn={signIn} />;

  return (
    <div className="app">
      <Header email={state.email} credits={state.credits} />

      <div className="composer">
        <textarea
          placeholder="What should I do on this page?"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run();
          }}
          disabled={state.running}
          rows={2}
        />
        <div className="composer-row">
          <button className="primary" onClick={() => void run()} disabled={busy || state.running || !goal.trim()}>
            {state.running ? "Running" : "Run"}
          </button>
          {state.running && (
            <button className="ghost" onClick={() => void send({ kind: "abort" }).then(refresh)}>
              Stop
            </button>
          )}
          <span className="hint">⌘↵</span>
        </div>
      </div>

      {error && <Banner tone="bad">{error}</Banner>}
      {state.error && <Banner tone="bad">{state.error}</Banner>}

      <div className="stream">
        {!state.steps.length && !state.running && <Empty onPick={setGoal} />}
        {state.status === "planning" && <Planning />}

        {state.steps.length > 0 && (
          <ol className="timeline">
            {state.steps.map((step) => (
              <Step key={step.id} step={step} onAnswer={(ok) => void send({ kind: "approve", approved: ok }).then(refresh)} />
            ))}
          </ol>
        )}

        {state.result && <Result text={state.result} />}
        {state.queued?.length ? <Queued items={state.queued} /> : null}
        {state.summary && !state.running && <Summary {...state.summary} status={state.status} />}
      </div>
    </div>
  );
}

// --- pieces ---------------------------------------------------------------

function Header({ email, credits }: { email?: string; credits?: number }) {
  return (
    <header>
      <div className="brand">
        <span className="dot" />
        <div>
          <strong>Jev</strong>
          <div className="sub">{email}</div>
        </div>
      </div>
      <div className="credits" title="1 credit ≈ $0.001 of model usage">
        <strong>{credits === undefined ? "—" : Math.floor(credits)}</strong>
        <span>credits</span>
      </div>
    </header>
  );
}

const ICON: Record<TimelineStep["status"], string> = {
  pending: "○",
  running: "◐",
  done: "●",
  failed: "✕",
  waiting: "❚",
};

function Step({ step, onAnswer }: { step: TimelineStep; onAnswer: (ok: boolean) => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (step.status === "running" || step.status === "waiting") {
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [step.status]);

  const time = elapsed(step);
  // Completed steps collapse to their last line: the detail matters while it is
  // happening, and the outcome is what matters afterwards.
  const visible =
    step.status === "done" && step.actions.length > 2 ? step.actions.slice(-1) : step.actions;

  return (
    <li ref={ref} className={`step ${step.status}`}>
      <span className="marker" aria-hidden>{ICON[step.status]}</span>
      <div className="step-body">
        <div className="step-head">
          <span className="step-title">{step.title}</span>
          {time && <span className="time">{time}</span>}
        </div>

        {visible.length > 0 && (
          <ul className="actions">
            {step.actions.length !== visible.length && (
              <li className="action note faded">…{step.actions.length - visible.length} earlier</li>
            )}
            {visible.map((a, i) => (
              <li key={`${a.text}-${i}`} className={`action ${a.kind}`} title={a.detail}>
                {a.text}
              </li>
            ))}
          </ul>
        )}

        {step.prompt && (
          <div className="prompt">
            <div className="prompt-head">
              {step.prompt.reason === "handoff" ? "Needs you" : "Approve this?"}
              {step.prompt.risk !== "none" && <span className="risk">{step.prompt.risk}</span>}
            </div>
            <p>{step.prompt.preview}</p>
            {step.prompt.reason === "confirm" ? (
              <div className="prompt-row">
                <button className="primary" onClick={() => onAnswer(true)}>Approve</button>
                <button className="ghost" onClick={() => onAnswer(false)}>Skip</button>
              </div>
            ) : (
              <div className="prompt-row">
                <span className="hint">Handle it in the page, then run again.</span>
                <button className="ghost" onClick={() => onAnswer(false)}>Dismiss</button>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function Result({ text }: { text: string }) {
  return (
    <section className="result">
      <h2>Result</h2>
      <div className="result-body">{text}</div>
      <button className="ghost small" onClick={() => void navigator.clipboard.writeText(text)}>
        Copy
      </button>
    </section>
  );
}

function Queued({ items }: { items: { preview: string; risk: string }[] }) {
  return (
    <section className="queued">
      <h2>Held back for you · {items.length}</h2>
      <p className="sub">Nothing here was carried out.</p>
      <ul>
        {items.map((q, i) => (
          <li key={`${q.preview}-${i}`}>
            {q.preview}
            {q.risk !== "none" && <span className="risk">{q.risk}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

const OUTCOME: Record<string, string> = {
  done: "Finished",
  blocked: "Stopped early",
  suspended: "Waiting on you",
  budget: "Hit the step limit",
  error: "Failed",
};

function Summary({
  steps, credits, seconds, status,
}: { steps: number; credits: number; seconds: number; status?: string }) {
  return (
    <div className={`summary ${status ?? ""}`}>
      <strong>{OUTCOME[status ?? ""] ?? "Finished"}</strong>
      <span>{steps} steps</span>
      <span>{seconds}s</span>
      <span>{credits.toFixed(1)} credits</span>
    </div>
  );
}

function Planning() {
  return (
    <div className="planning">
      <span className="spinner" aria-hidden />
      Working out how to do this
    </div>
  );
}

function Empty({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="empty">
      <p>Give it a goal for the page you're on.</p>
      <div className="chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip" onClick={() => onPick(s)}>{s}</button>
        ))}
      </div>
      <p className="fine">
        It asks before anything it cannot undo — unless you tell it not to. It never types a
        password.
      </p>
    </div>
  );
}

function Banner({ tone, children }: { tone: "bad" | "warn"; children: React.ReactNode }) {
  return <div className={`banner ${tone}`}>{children}</div>;
}

function SignIn({
  state, busy, error, onSignIn,
}: {
  state: PanelState;
  busy: boolean;
  error: string | null;
  onSignIn: (k: "signIn" | "signInDev") => void;
}) {
  return (
    <div className="app">
      <Header />
      <div className="signin">
        <h1>Browse by asking</h1>
        <p>
          Describe what you want done on a page and it does it, showing every step. Usage is
          billed against your credits.
        </p>
        {error && <Banner tone="bad">{error}</Banner>}
        {state.auth?.google !== false && (
          <button className="primary block" disabled={busy} onClick={() => onSignIn("signIn")}>
            Continue with Google
          </button>
        )}
        {state.auth?.dev && (
          <>
            <button className="ghost block" disabled={busy} onClick={() => onSignIn("signInDev")}>
              Continue as dev user
            </button>
            <p className="fine">
              Google sign-in isn't configured on this server, so a local account is offered
              instead. It's refused in production.
            </p>
          </>
        )}
        {!state.auth && <p className="fine">Can't reach the server on localhost:8787.</p>}
      </div>
    </div>
  );
}
