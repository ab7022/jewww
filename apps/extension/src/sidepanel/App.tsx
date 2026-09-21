import { useCallback, useEffect, useRef, useState } from "react";
import { API_HOST } from "../shared/config.js";
import { Details } from "./Details.js";
import { useVoice } from "./voice.js";
import type { ToWorker } from "../shared/messages.js";
import { EMPTY_STATE, type HistoryEntry, type PanelState, parseState, type Question } from "../shared/state.js";
import { elapsed, type TimelineStep } from "../shared/timeline.js";

const send = <T,>(msg: ToWorker): Promise<T> => chrome.runtime.sendMessage(msg) as Promise<T>;

const SUGGESTIONS = [
  "Summarise this page",
  "Find the pricing and tell me what the top plan costs",
  "Fill in this form with my details, but don't submit it",
  "Where do I change my password here?",
];

export function App() {
  const [state, setState] = useState<PanelState>(EMPTY_STATE);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const runRef = useRef<(text?: string, source?: "click" | "voice") => Promise<void>>(async () => {});

  // Not `loaded` until storage answers, so listen-on-open never acts on the defaults.
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>({ ...VOICE_DEFAULTS, loaded: false });
  useEffect(() => {
    void chrome.storage.local.get(VOICE_KEY).then((v) => {
      setVoiceSettings({ ...VOICE_DEFAULTS, ...((v[VOICE_KEY] as Partial<VoiceSettings>) ?? {}), loaded: true });
    });
  }, []);
  const saveVoice = (next: VoiceSettings) => {
    setVoiceSettings(next);
    void chrome.storage.local.set({ [VOICE_KEY]: next });
  };

  // Phrases append rather than replace, so speaking after typing adds to the box.
  // A complete spoken request — after "Hey Jev", or a pause in talk-to-run — runs.
  const voice = useVoice({
    onPhrase: useCallback((phrase: string) => {
      setGoal((g) => (g.trim() ? `${g.trim()} ${phrase}` : phrase));
    }, []),
    onCommand: useCallback((request: string) => {
      setGoal(request);
      void runRef.current(request, "voice");
    }, []),
    // Never listen for the wake phrase while a task is running.
    wake: voiceSettings.wake && !state.running,
  });

  // The page shows a "Listening…" pill whenever the microphone is taking a request.
  useEffect(() => {
    void send({ kind: "listening", on: voice.state === "dictating" || voice.state === "armed" }).catch(() => {});
  }, [voice.state]);

  // ⌥J then talk: when enabled, opening the panel starts listening straight away.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !voiceSettings.loaded || !state.signedIn || state.running) return;
    opened.current = true;
    if (voiceSettings.listenOnOpen && voice.supported) voice.dictate(true);
  }, [voiceSettings, state.signedIn, state.running, voice]);

  const refresh = useCallback(async () => {
    // Parsed, not trusted: a shape this build does not know is repaired field by field
    // rather than rendered — a panel that throws shows nothing at all.
    setState(parseState(await send<unknown>({ kind: "state" })));
  }, []);

  useEffect(() => {
    void refresh();
    // The worker pushes after every event, but MV3 can restart it at any moment, so
    // a slow poll keeps the panel honest rather than stuck on a stale view.
    const listener = (msg: { kind?: string; state?: unknown }) => {
      if (msg?.kind === "state" && msg.state) setState(parseState(msg.state));
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

  const run = async (text = goal, source: "click" | "voice" = "click") => {
    const request = text.trim();
    if (!request || state.running) return;
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
      const already = await chrome.permissions.contains({ origins: [origin] });
      // Chrome only shows the permission prompt in response to a click. A spoken
      // request has no click behind it, so for a site not yet granted, the request
      // waits in the box for one press of Run rather than failing obscurely.
      if (!already && source === "voice") {
        setError(`Press Run once to let Jev work on ${new URL(url).host} — after that, voice alone is enough.`);
        return;
      }
      const granted = already || (await chrome.permissions.request({ origins: [origin] }));
      if (!granted) {
        setError(`Access to ${new URL(url).host} was declined.`);
        return;
      }
      await send({ kind: "start", goal: request, tabId: tab.id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  runRef.current = run;

  if (!state.signedIn) return <SignIn state={state} busy={busy} error={error} onSignIn={signIn} />;

  if (showDetails) {
    return (
      <div className="app">
        <Header email={state.email} credits={state.credits} />
        <div className="stream">
          <Details onClose={() => setShowDetails(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header email={state.email} credits={state.credits} onDetails={() => setShowDetails(true)} />

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
          {voice.supported && (
            <button
              className={voice.state === "dictating" ? "mic listening" : "mic"}
              onClick={() => voice.dictate(false)}
              disabled={state.running}
              title={voice.state === "dictating" ? "Stop dictating" : "Dictate"}
              aria-label={voice.state === "dictating" ? "Stop dictating" : "Dictate"}
            >
              <MicIcon />
            </button>
          )}
          <span className="hint">⌘ ↵</span>
        </div>
      </div>

      {voice.supported && voice.state !== "dictating" && (voice.state === "wake" || voice.state === "armed") && (
        <p className="wake">
          <span className="wake-dot" />
          {voice.state === "armed" ? "Yes? I'm listening…" : "Listening for \u201cHey Jev\u201d"}
        </p>
      )}
      {voice.interim && <p className="interim">{voice.interim}</p>}
      {voice.error && <Banner tone="bad">{voice.error}</Banner>}
      {error && <Banner tone="bad">{error}</Banner>}
      {state.error && <Banner tone="bad">{state.error}</Banner>}

      <div className="stream">
        {!state.steps.length && !state.running && (
          <Empty
            onPick={setGoal}
            voice={voice.supported ? voiceSettings : null}
            onVoice={saveVoice}
          />
        )}
        {state.status === "planning" && <Planning />}
        {state.questions?.length ? (
          <Questions
            items={state.questions}
            onSubmit={(values) => void send({ kind: "answer", values }).then(refresh)}
          />
        ) : null}

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

        {!state.running && (state.steps.length > 0 || state.history?.length) ? (
          <div className="tray">
            {state.history?.length ? (
              <button className="ghost small" onClick={() => setShowHistory((v) => !v)}>
                {showHistory ? "Hide history" : `History (${state.history.length})`}
              </button>
            ) : null}
            {state.steps.length > 0 && (
              <button
                className="ghost small"
                onClick={() => {
                  setGoal("");
                  setError(null);
                  setShowHistory(false);
                  void send<PanelState>({ kind: "reset" }).then(refresh);
                }}
              >
                Reset
              </button>
            )}
          </div>
        ) : null}

        {showHistory && state.history?.length ? (
          <History items={state.history} onPick={(g) => { setGoal(g); setShowHistory(false); }} />
        ) : null}
      </div>
    </div>
  );
}

// --- pieces ---------------------------------------------------------------

function Header({
  email, credits, onDetails,
}: { email?: string | undefined; credits?: number | undefined; onDetails?: () => void }) {
  return (
    <header>
      <div className="brand">
        <span className="dot" />
        <div>
          <strong>Jev</strong>
          <div className="sub">{email}</div>
        </div>
      </div>
      <div className="header-right">
        {onDetails && (
          <button className="ghost small" onClick={onDetails} title="Details used to fill forms">
            Details
          </button>
        )}
        <div className="credits" title="1 credit ≈ $0.001 of model usage">
          <strong>{credits === undefined ? "—" : Math.floor(credits)}</strong>
          <span>credits</span>
        </div>
      </div>
    </header>
  );
}

/**
 * Distinct at a glance and at 13px. A filled dot for "done" and a half dot for
 * "running" were nearly identical in the panel, so several finished steps read as
 * still in progress.
 */
/** What a risk class means, rather than its internal name. */
const RISK_WORDS: Record<string, string> = {
  money: "Spends money",
  message: "Sends something",
  destroy: "Deletes data",
  settings: "Changes settings",
  auth: "Signs in or out",
  paywall: "Requires payment",
};

const ICON: Record<TimelineStep["status"], string> = {
  pending: "○",
  running: "●",
  done: "✓",
  failed: "✕",
  waiting: "!",
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
          {step.iteration !== undefined && step.status === "running" && (
            <span className="iteration">Item {Number(step.iteration.split(".").pop()) + 1}</span>
          )}
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
              {step.prompt.reason === "handoff" ? "Needs you" : "Needs your approval"}
              {step.prompt.risk !== "none" && (
              <span className="risk">{RISK_WORDS[step.prompt.risk] ?? step.prompt.risk}</span>
            )}
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
      <h2>Held back · {items.length}</h2>
      <p className="fine">Nothing here was carried out.</p>
      <ul>
        {items.map((q, i) => (
          <li key={`${q.preview}-${i}`}>
            {q.preview}
            {q.risk !== "none" && <span className="risk">{RISK_WORDS[q.risk] ?? q.risk}</span>}
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
  aborted: "Stopped",
  error: "Failed",
};

function Summary({
  steps, credits, seconds, status,
}: { steps: number; credits: number; seconds: number; status?: string | undefined }) {
  return (
    <div className={`summary ${status ?? ""}`}>
      <strong>{OUTCOME[status ?? ""] ?? "Finished"}</strong>
      <span>{steps} steps</span>
      <span>{seconds}s</span>
      <span>{credits.toFixed(1)} credits</span>
    </div>
  );
}

/**
 * Questions a form asked that only the person can answer. Answered once: the agent
 * keeps the answers for the rest of the run, so the next nine applications that ask
 * the same thing are filled without asking again.
 */
function Questions({
  items, onSubmit,
}: { items: Question[]; onSubmit: (values: Record<string, string>) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <form
      className="questions"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      <h2>A few things only you know</h2>
      <p className="fine">Leave anything blank to skip it. Your answers are reused for the rest of this task.</p>
      {items.map((q) => (
        <label key={q.key}>
          <span>
            {q.label}
            {q.required && <em> · required</em>}
          </span>
          <input
            value={values[q.key] ?? ""}
            onChange={(e) => setValues({ ...values, [q.key]: e.target.value })}
            autoComplete="off"
          />
        </label>
      ))}
      <div className="prompt-row">
        <button className="primary" type="submit">Continue</button>
        <button className="ghost" type="button" onClick={() => onSubmit({})}>Skip all</button>
      </div>
    </form>
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

interface VoiceSettings {
  loaded: boolean;
  /** Start listening as soon as the panel opens — ⌥J, then just talk. */
  listenOnOpen: boolean;
  /** Listen for "Hey Jev" while the panel is open. */
  wake: boolean;
}
const VOICE_KEY = "voiceSettings";
// Both off until the person turns them on: a microphone prompt the first time someone
// opens a side panel is a bad first impression, and always-on listening is a choice.
const VOICE_DEFAULTS: VoiceSettings = { loaded: true, listenOnOpen: false, wake: false };

function Empty({
  onPick, voice, onVoice,
}: { onPick: (s: string) => void; voice: VoiceSettings | null; onVoice: (v: VoiceSettings) => void }) {
  return (
    <div className="empty">
      <p>Give it a goal for the page you're on — or ask it where something is.</p>
      <div className="chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip" onClick={() => onPick(s)}>
            {s}
          </button>
        ))}
      </div>
      {voice && (
        <div className="voice-settings">
          <h3>Talk to Jev</h3>
          <label className="toggle">
            <input
              type="checkbox"
              checked={voice.listenOnOpen}
              onChange={(e) => onVoice({ ...voice, listenOnOpen: e.target.checked })}
            />
            <span>
              <span className="toggle-title">Listen when I open Jev <kbd>⌥J</kbd></span>
              <small>Open, say what you want, pause — it runs.</small>
            </span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={voice.wake} onChange={(e) => onVoice({ ...voice, wake: e.target.checked })} />
            <span>
              <span className="toggle-title">Answer to “Hey Jev”</span>
              <small>Only while this panel is open. The microphone stays on, and says so.</small>
            </span>
          </label>
        </div>
      )}
      <p className="fine">
        It asks before anything it cannot undo — unless you tell it not to. It never types a
        password. To fill forms, add your details from the header.
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
        {!state.auth && <p className="fine">Can't reach the Jev server ({API_HOST}).</p>}
      </div>
    </div>
  );
}

/**
 * Past runs. Tapping one puts its wording back in the box rather than re-running it:
 * the page is almost never the one it ran against, so replaying blind would act on
 * whatever happens to be open.
 */
function History({ items, onPick }: { items: HistoryEntry[]; onPick: (goal: string) => void }) {
  return (
    <ul className="history">
      {items.map((h) => (
        <li key={h.id}>
          <button onClick={() => onPick(h.goal)} title="Put this back in the box">
            <span className={`pip ${h.status === "done" ? "ok" : "bad"}`} />
            <span className="history-goal">{h.goal}</span>
            <span className="history-meta">{ago(h.at)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Coarse on purpose: the exact second a run finished is never the question. */
function ago(at: number): string {
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}
