import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Logo } from "../components/Nav.js";
import { Link, navigate } from "../router.js";
import { api, signOut, useSession } from "../session.js";
const DETAIL_FIELDS = [
    ["fullName", "Full name", "Abdul Bayees"],
    ["email", "Email", "you@example.com"],
    ["phone", "Phone", "+91 …"],
    ["city", "City", "Bengaluru"],
    ["country", "Country", "India"],
    ["currentTitle", "Job title", "Frontend Engineer"],
    ["currentCompany", "Company", "Dolze"],
    ["linkedin", "LinkedIn", "https://linkedin.com/in/…"],
];
const OUTCOME = {
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
        if (session.status === "signedOut")
            navigate("/signin");
    }, [session.status]);
    if (session.status !== "signedIn") {
        return (_jsx("div", { className: "auth-page", children: _jsx("p", { className: "muted", children: "Loading your account\u2026" }) }));
    }
    const { me } = session;
    return (_jsxs("div", { className: "dash", children: [_jsxs("header", { className: "dash-top", children: [_jsx(Logo, {}), _jsxs("div", { className: "dash-who", children: [_jsx("span", { className: "muted", children: me.email }), _jsx("button", { type: "button", className: "btn small ghost", onClick: () => {
                                    void signOut().then(() => navigate("/"));
                                }, children: "Sign out" })] })] }), _jsxs("main", { className: "dash-main", children: [_jsxs("section", { className: "dash-hello", children: [_jsxs("div", { children: [_jsx("p", { className: "kicker", children: "Your account" }), _jsxs("h1", { children: ["Hi", me.name && me.name !== "Dev User" ? `, ${me.name.split(" ")[0]}` : "", "."] })] }), _jsxs("div", { className: "credits-card", children: [_jsx("strong", { children: Math.floor(me.credits).toLocaleString() }), _jsxs("span", { children: ["credits \u00B7 about ", me.approxTasks, " tasks"] })] })] }), _jsxs("div", { className: "dash-grid", children: [_jsx(Install, {}), _jsx(Instructions, {}), _jsx(Details, {}), _jsx(Runs, {}), _jsx(Usage, {})] })] })] }));
}
function Install() {
    return (_jsxs("section", { className: "panel span-2", children: [_jsx("h2", { children: "Get the extension" }), _jsxs("ol", { className: "steps", children: [_jsxs("li", { children: ["Open ", _jsx("code", { children: "chrome://extensions" }), " and turn on ", _jsx("strong", { children: "Developer mode" }), "."] }), _jsxs("li", { children: ["Choose ", _jsx("strong", { children: "Load unpacked" }), " and pick ", _jsx("code", { children: "apps/extension/dist" }), "."] }), _jsxs("li", { children: ["Press ", _jsx("kbd", { children: "\u2325 J" }), " on any page and sign in \u2014 same account as here."] })] }), _jsx("p", { className: "fine", children: "It starts with access to no sites. The first time you run a task somewhere, Chrome asks whether Jev may work on that site." })] }));
}
function useProfile() {
    const [profile, setProfile] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        api
            .call("getProfile")
            .then(setProfile)
            .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, []);
    return { profile, setProfile, error };
}
function Instructions() {
    const { profile, error } = useProfile();
    const [text, setText] = useState(null);
    const [state, setState] = useState("idle");
    const value = text ?? profile?.instructions ?? "";
    return (_jsxs("section", { className: "panel", children: [_jsx("h2", { children: "Always do this" }), _jsx("p", { className: "fine", children: "Loaded on every task \u2014 when it plans, when it writes, and at every step." }), error && _jsx("p", { className: "banner bad", children: error }), _jsx("textarea", { rows: 6, value: value, disabled: !profile, placeholder: "Keep replies short and plain.\nNever submit a form without asking me first.\nSign off as Abdul.", onChange: (e) => {
                    setText(e.target.value);
                    setState("idle");
                } }), _jsx("button", { type: "button", className: "btn primary", disabled: !profile || state === "saving" || text === null, onClick: async () => {
                    setState("saving");
                    // Instructions only: the details saved elsewhere are left exactly as they are.
                    await api.call("putProfile", { instructions: value });
                    setState("saved");
                }, children: state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "Save" })] }));
}
function Details() {
    const { profile, setProfile, error } = useProfile();
    const [edits, setEdits] = useState({});
    const [state, setState] = useState("idle");
    return (_jsxs("section", { className: "panel", children: [_jsx("h2", { children: "Your details" }), _jsx("p", { className: "fine", children: "Used to fill forms. Anything blank, it asks for when a form needs it." }), error && _jsx("p", { className: "banner bad", children: error }), _jsx("div", { className: "fields", children: DETAIL_FIELDS.map(([key, label, placeholder]) => (_jsxs("label", { children: [_jsx("span", { children: label }), _jsx("input", { value: edits[key] ?? profile?.fields[key] ?? "", placeholder: placeholder, disabled: !profile, onChange: (e) => {
                                setEdits({ ...edits, [key]: e.target.value });
                                setState("idle");
                            } })] }, key))) }), _jsx("button", { type: "button", className: "btn primary", disabled: !profile || state === "saving" || !Object.keys(edits).length, onClick: async () => {
                    if (!profile)
                        return;
                    setState("saving");
                    // The FULL map, with these edits applied: saving only the keys shown here
                    // would delete every other detail saved from the extension.
                    const fields = { ...profile.fields, ...edits };
                    await api.call("putProfile", { fields });
                    setProfile({ ...profile, fields });
                    setEdits({});
                    setState("saved");
                }, children: state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "Save details" })] }));
}
function Runs() {
    const [runs, setRuns] = useState(null);
    useEffect(() => {
        api
            .call("listRuns")
            .then((r) => setRuns(r.runs))
            .catch(() => setRuns([]));
    }, []);
    return (_jsxs("section", { className: "panel span-2", children: [_jsx("h2", { children: "Recent tasks" }), runs === null ? (_jsx("p", { className: "muted", children: "Loading\u2026" })) : runs.length === 0 ? (_jsxs("p", { className: "muted", children: ["Nothing yet. Press ", _jsx("kbd", { children: "\u2325 J" }), " on any page and give Jev something to do."] })) : (_jsx("ul", { className: "runs", children: runs.map((r) => {
                    const o = OUTCOME[r.status] ?? { text: r.status, tone: "" };
                    return (_jsxs("li", { children: [_jsxs("div", { className: "run-goal", children: [_jsx("strong", { children: r.goal }), _jsxs("span", { className: "muted", children: [host(r.startUrl), " \u00B7 ", when(r.createdAt)] })] }), _jsx("span", { className: `status ${o.tone}`, children: o.text }), _jsxs("span", { className: "muted num", children: [r.steps, " steps"] }), _jsxs("span", { className: "muted num", children: [r.creditsSpent.toFixed(1), " cr"] })] }, r.id));
                }) }))] }));
}
function Usage() {
    const [entries, setEntries] = useState(null);
    useEffect(() => {
        api
            .call("ledger")
            .then((r) => setEntries(r.entries.slice(0, 8)))
            .catch(() => setEntries([]));
    }, []);
    if (!entries?.length)
        return null;
    return (_jsxs("section", { className: "panel span-2", children: [_jsx("h2", { children: "Credit activity" }), _jsx("ul", { className: "ledger", children: entries.map((e, i) => (_jsxs("li", { children: [_jsx("span", { children: e.kind === "topup" ? "Added" : KIND[e.kind] ?? e.kind }), _jsx("span", { className: "muted", children: when(e.at) }), _jsxs("span", { className: `num ${e.credits > 0 ? "good" : ""}`, children: [e.credits > 0 ? "+" : "", e.credits.toFixed(2)] })] }, `${e.at}-${i}`))) }), _jsx("p", { className: "fine", children: _jsx(Link, { href: "/#pricing", children: "How credits work" }) })] }));
}
const KIND = {
    plan: "Planned a task",
    decide: "Decided a step",
    text: "Wrote into a field",
    extract: "Read a page",
    compose: "Wrote something",
    fields: "Matched a form",
};
function host(url) {
    try {
        return new URL(url).host.replace(/^www\./, "");
    }
    catch {
        return url;
    }
}
function when(iso) {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1)
        return "just now";
    if (mins < 60)
        return `${mins}m ago`;
    if (mins < 60 * 24)
        return `${Math.round(mins / 60)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
//# sourceMappingURL=Dashboard.js.map