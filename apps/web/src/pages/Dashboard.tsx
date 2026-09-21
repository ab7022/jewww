import type { LedgerEntry, Profile, RunSummary } from "@jev-browser/protocol";
import { useEffect, useState } from "react";
import { Logo } from "../components/Nav.js";
import { Link, navigate } from "../router.js";
import { api, signOut, useSession } from "../session.js";
import { Billing } from "./Billing.js";

const DETAIL_FIELDS: [key: string, label: string, placeholder: string][] = [
  ["fullName", "Full name", "Abdul Bayees"],
  ["email", "Email", "you@example.com"],
  ["phone", "Phone", "+91 …"],
  ["city", "City", "Bengaluru"],
  ["country", "Country", "India"],
  ["currentTitle", "Job title", "Frontend Engineer"],
  ["currentCompany", "Company", "Dolze"],
  ["linkedin", "LinkedIn", "https://linkedin.com/in/…"],
];

const OUTCOME: Record<string, { text: string; tone: string }> = {
  done: { text: "Finished", tone: "good" },
  running: { text: "Running", tone: "" },
  blocked: { text: "Stopped early", tone: "warn" },
  suspended: { text: "Waited on you", tone: "warn" },
  budget: { text: "Step limit", tone: "warn" },
  aborted: { text: "Stopped", tone: "" },
  error: { text: "Failed", tone: "bad" },
};

export function Dashboard() {
  const session = useSession();

  useEffect(() => {
    if (session.status === "signedOut") navigate("/signin");
  }, [session.status]);

  if (session.status !== "signedIn") {
    return (
      <div className="auth-page">
        <p className="muted">Loading your account…</p>
      </div>
    );
  }
  const { me } = session;

  return (
    <div className="dash">
      <header className="dash-top">
        <Logo />
        <div className="dash-who">
          <span className="muted">{me.email}</span>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              void signOut().then(() => navigate("/"));
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="dash-main">
        <section className="dash-hello">
          <div>
            <p className="kicker">Your account</p>
            <h1>Hi{me.name && me.name !== "Dev User" ? `, ${me.name.split(" ")[0]}` : ""}.</h1>
          </div>
          <div className="credits-card">
            <strong>{Math.floor(me.credits).toLocaleString()}</strong>
            <span>credits · about {me.approxTasks} tasks</span>
            <Link className="credits-top" href="/account#billing">
              Add credits
            </Link>
          </div>
        </section>

        <div className="dash-grid">
          <Billing onCredits={session.refresh} />
          <Install />
          <Instructions />
          <Details />
          <Runs />
          <Usage />
        </div>
      </main>
    </div>
  );
}

function Install() {
  return (
    <section className="panel span-2">
      <h2>Get the extension</h2>
      <ol className="steps">
        <li>
          Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong>.
        </li>
        <li>
          Choose <strong>Load unpacked</strong> and pick <code>apps/extension/dist</code>.
        </li>
        <li>
          Press <kbd>⌥ J</kbd> on any page and sign in — same account as here.
        </li>
      </ol>
      <p className="fine">
        It starts with access to no sites. The first time you run a task somewhere, Chrome asks whether Jev may
        work on that site.
      </p>
    </section>
  );
}

function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .call("getProfile")
      .then(setProfile)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  return { profile, setProfile, error };
}

function Instructions() {
  const { profile, error } = useProfile();
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const value = text ?? profile?.instructions ?? "";

  return (
    <section className="panel">
      <h2>Always do this</h2>
      <p className="fine">Loaded on every task — when it plans, when it writes, and at every step.</p>
      {error && <p className="banner bad">{error}</p>}
      <textarea
        rows={6}
        value={value}
        disabled={!profile}
        placeholder={"Keep replies short and plain.\nNever submit a form without asking me first.\nSign off as Abdul."}
        onChange={(e) => {
          setText(e.target.value);
          setState("idle");
        }}
      />
      <button
        type="button"
        className="btn primary"
        disabled={!profile || state === "saving" || text === null}
        onClick={async () => {
          setState("saving");
          // Instructions only: the details saved elsewhere are left exactly as they are.
          await api.call("putProfile", { instructions: value });
          setState("saved");
        }}
      >
        {state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "Save"}
      </button>
    </section>
  );
}

function Details() {
  const { profile, setProfile, error } = useProfile();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  return (
    <section className="panel">
      <h2>Your details</h2>
      <p className="fine">Used to fill forms. Anything blank, it asks for when a form needs it.</p>
      {error && <p className="banner bad">{error}</p>}
      <div className="fields">
        {DETAIL_FIELDS.map(([key, label, placeholder]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              value={edits[key] ?? profile?.fields[key] ?? ""}
              placeholder={placeholder}
              disabled={!profile}
              onChange={(e) => {
                setEdits({ ...edits, [key]: e.target.value });
                setState("idle");
              }}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="btn primary"
        disabled={!profile || state === "saving" || !Object.keys(edits).length}
        onClick={async () => {
          if (!profile) return;
          setState("saving");
          // The FULL map, with these edits applied: saving only the keys shown here
          // would delete every other detail saved from the extension.
          const fields = { ...profile.fields, ...edits };
          await api.call("putProfile", { fields });
          setProfile({ ...profile, fields });
          setEdits({});
          setState("saved");
        }}
      >
        {state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "Save details"}
      </button>
    </section>
  );
}

function Runs() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  useEffect(() => {
    api
      .call("listRuns")
      .then((r) => setRuns(r.runs))
      .catch(() => setRuns([]));
  }, []);

  return (
    <section className="panel span-2">
      <h2>Recent tasks</h2>
      {runs === null ? (
        <p className="muted">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="muted">
          Nothing yet. Press <kbd>⌥ J</kbd> on any page and give Jev something to do.
        </p>
      ) : (
        <ul className="runs">
          {runs.map((r) => {
            const o = OUTCOME[r.status] ?? { text: r.status, tone: "" };
            return (
              <li key={r.id}>
                <div className="run-goal">
                  <strong>{r.goal}</strong>
                  <span className="muted">
                    {host(r.startUrl)} · {when(r.createdAt)}
                  </span>
                </div>
                <span className={`status ${o.tone}`}>{o.text}</span>
                <span className="muted num">{r.steps} steps</span>
                <span className="muted num">{r.creditsSpent.toFixed(1)} cr</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Usage() {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  useEffect(() => {
    api
      .call("ledger")
      .then((r) => setEntries(r.entries.slice(0, 8)))
      .catch(() => setEntries([]));
  }, []);
  if (!entries?.length) return null;
  return (
    <section className="panel span-2">
      <h2>Credit activity</h2>
      <ul className="ledger">
        {entries.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <span>{e.kind === "topup" ? "Added" : KIND[e.kind] ?? e.kind}</span>
            <span className="muted">{when(e.at)}</span>
            <span className={`num ${e.credits > 0 ? "good" : ""}`}>
              {e.credits > 0 ? "+" : ""}
              {e.credits.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
      <p className="fine">
        <Link href="/#pricing">How credits work</Link>
      </p>
    </section>
  );
}

const KIND: Record<string, string> = {
  plan: "Planned a task",
  decide: "Decided a step",
  text: "Wrote into a field",
  extract: "Read a page",
  compose: "Wrote something",
  fields: "Matched a form",
};

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
