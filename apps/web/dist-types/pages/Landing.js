import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Agent, release, take } from "../landing/agent.js";
import { Count, HeroStage, Marquee } from "../landing/hero.js";
import "../landing/landing.css";
import { CheckoutScene, ConsoleScene, JobsScene, MailScene, NeverScene } from "../landing/scenes.js";
import { Link, navigate } from "../router.js";
import { useSession } from "../session.js";
/**
 * The landing page is a browser, and Jev is the one driving it.
 *
 * The tab strip is the navigation; the address bar takes requests ("show me the
 * pricing") and Jev's cursor goes and does them; each section is a different site the
 * cursor visits, doing one real thing the product does. Nothing here is a feature card.
 */
const TABS = [
    { id: "hello", title: "hello", url: "jev.app" },
    { id: "do", title: "jobs", url: "careers.northwind.dev" },
    { id: "draft", title: "inbox", url: "mail.example.com" },
    { id: "show", title: "console", url: "console.cloud.example" },
    { id: "never", title: "never", url: "bank.example.com" },
    { id: "talk", title: "talk", url: "jev.app/voice" },
    { id: "pricing", title: "checkout", url: "jev.app/checkout" },
    { id: "history", title: "history", url: "jev://history" },
];
/** Address-bar requests the page understands. A demo of the idea, not the agent. */
const INTENTS = [
    [/pric|cost|pay|plan|free|checkout/i, "pricing"],
    [/job|apply|resume|career/i, "do"],
    [/mail|reply|email|draft|inbox/i, "draft"],
    [/where|show|find|point|console|deploy/i, "show"],
    [/pass|login|log in|safe|never|secret|card/i, "never"],
    [/talk|voice|hey|speak|listen|mic|shortcut|key/i, "talk"],
];
const EXAMPLES = [
    "show me the pricing",
    "apply to ten jobs for me",
    "draft a reply, don't send it",
    "where do i see prod deploys?",
    "log in for me",
];
/** tone, site, request, mode — each a thing someone would rather not do themselves. */
const WALL = [
    ["jobs", "careers.northwind.dev", "apply to ten frontend roles with my resume", "do it"],
    ["mail", "mail.example.com", "reply to priya: friday works — don't send", "draft"],
    ["code", "code.example/pr/1842", "summarise this pull request in three bullets", "read"],
    ["flights", "flights.example/blr-del", "cheapest flight to delhi on the 22nd", "find"],
    ["shop", "shop.example/cart", "add these three to my cart, stop before paying", "do it"],
    ["console", "console.cloud.example", "is the prod app healthy?", "check"],
    ["form", "forms.example/new", "make a survey about sleep habits", "create"],
    ["bank", "bank.example/settings", "where do i download statements?", "show me"],
    ["cal", "calendar.example", "find thirty minutes with sam on friday", "find"],
    ["news", "news.example/story", "three bullets on this article", "read"],
    ["docs", "docs.example/new", "turn this thread into a page", "create"],
    ["tickets", "tickets.example/7pm", "two seats for the 7pm show", "do it"],
];
const HISTORY = [
    ["9:41", "does it see everything i browse?", "No. Jev only looks at a tab when you give it a task there, and only once you've allowed that site. It ships with access to nothing."],
    ["9:38", "is it always listening?", "No. Voice is off until you turn it on. “Hey Jev” only listens while the Jev panel is open, and says so the whole time. Speech recognition is Chrome's own."],
    ["9:30", "what does it do before something i can't undo?", "If you told it to go ahead, it goes ahead. If you asked to review, it asks — once, and only when the step can actually happen. If you said not to finalise, it never does."],
    ["9:22", "what happens when a site needs me?", "Sign-ins, CAPTCHAs, payments and new accounts come straight back to you, with one sentence saying why. Do that part, then run the task again."],
    ["9:15", "which sites does it work on?", "Ordinary pages, including ones built from web components and same-origin frames. Canvas-drawn apps, and card fields inside payment frames, it leaves to you."],
    ["9:02", "what's a credit?", "A thousandth of a dollar of model usage. A ten-step task is usually ten to twenty. You start with 500."],
];
export function Landing() {
    const session = useSession();
    const next = session.status === "signedIn" ? "/dashboard" : "/signin";
    const [active, setActive] = useState("hello");
    const [typed, setTyped] = useState("");
    const [focused, setFocused] = useState(false);
    const [example, setExample] = useState(0);
    const tabRefs = useRef({});
    // The active tab follows the section on screen.
    useEffect(() => {
        const io = new IntersectionObserver((entries) => {
            for (const e of entries)
                if (e.isIntersecting)
                    setActive(e.target.id);
        }, { rootMargin: "-45% 0px -50% 0px" });
        for (const t of TABS) {
            const el = document.getElementById(t.id);
            if (el)
                io.observe(el);
        }
        return () => io.disconnect();
    }, []);
    // The empty address bar cycles through things you could ask.
    useEffect(() => {
        const t = setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 2800);
        return () => clearInterval(t);
    }, []);
    /** Jev goes to the tab, clicks it, and the page follows. */
    const go = async (id) => {
        const s = take();
        try {
            await s.moveTo(tabRefs.current[id] ?? null, "on it");
            await s.click();
            document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
            await s.wait(900);
        }
        catch {
            // Someone else took the cursor — fine.
        }
        finally {
            release();
        }
    };
    const ask = (text) => {
        if (/sign|start|get|install|download|account/i.test(text))
            return navigate(next);
        const hit = INTENTS.find(([re]) => re.test(text));
        void go(hit?.[1] ?? "history");
    };
    const url = TABS.find((t) => t.id === active)?.url ?? "jev.app";
    return (_jsxs("div", { className: "jl", children: [_jsx(Agent, {}), _jsxs("header", { className: "chrome", children: [_jsxs("div", { className: "tabs", children: [_jsxs("span", { className: "lights", "aria-hidden": true, children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }), _jsx("nav", { className: "tab-list", "aria-label": "Sections", children: TABS.map((t) => (_jsxs("a", { ref: (el) => {
                                        tabRefs.current[t.id] = el;
                                    }, href: `#${t.id}`, className: `tab ${active === t.id ? "on" : ""}`, onClick: (e) => {
                                        e.preventDefault();
                                        document.getElementById(t.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                                    }, children: [_jsx("span", { className: `fav fav-${t.id}`, "aria-hidden": true }), t.title] }, t.id))) }), _jsx(Link, { className: "tab-cta", href: next, children: session.status === "signedIn" ? "your account" : "sign in" })] }), _jsxs("form", { className: "omni", onSubmit: (e) => {
                            e.preventDefault();
                            if (typed.trim())
                                ask(typed);
                            setTyped("");
                        }, children: [_jsx("span", { className: "omni-spark", "aria-hidden": true }), _jsx("input", { value: typed, onChange: (e) => setTyped(e.target.value), onFocus: () => setFocused(true), onBlur: () => setFocused(false), placeholder: focused ? "ask jev something…" : "", "aria-label": "Ask Jev" }), !typed && !focused && (_jsxs("span", { className: "omni-ghost", "aria-hidden": true, children: [_jsx("span", { className: "omni-url", children: url }), _jsxs("span", { className: "omni-try", children: ["try \u201C", EXAMPLES[example], "\u201D"] })] })), _jsx("kbd", { children: "\u21B5" })] })] }), _jsxs("main", { children: [_jsxs("section", { id: "hello", className: "hello", children: [_jsxs("div", { className: "hello-copy", children: [_jsx("p", { className: "tag reveal", children: "a browser assistant with a cursor of its own" }), _jsxs("h1", { children: ["you say it.", _jsx("br", {}), _jsx("em", { children: "i" }), " click it."] }), _jsx("p", { className: "hello-lede", children: "jev lives in chrome. tell it what you want done and watch its cursor do it on the page in front of you \u2014 or ask where something is, and it'll point. try the bar up there; it works on this page too." }), _jsxs("div", { className: "hello-cta", children: [_jsx(Link, { className: "ink-btn", href: next, children: "get jev \u2014 it's free" }), _jsxs("span", { className: "hello-keys", children: ["then press ", _jsx("kbd", { children: "\u2325" }), _jsx("kbd", { children: "J" }), " anywhere"] })] })] }), _jsx(HeroStage, {})] }), _jsx(Marquee, {}), _jsx(Chapter, { id: "do", log: [["0.0s", "opened the posting"], ["0.8s", "clicked “Easy Apply”"], ["1.9s", "typed your name and email"], ["2.6s", "attached resume.pdf"], ["3.4s", "submitted — 4 of 10 done"]], n: "01", title: "it does the clicking.", note: "applications, forms, checkouts \u2014 the tedious middle of everything.", children: _jsx(JobsScene, {}) }), _jsx(Chapter, { id: "draft", log: [["0.0s", "read priya's message"], ["0.6s", "clicked “Reply”"], ["1.4s", "wrote it in your voice"], ["3.1s", "held back “Send”", "you said don't"]], n: "02", title: "it listens to how you said it.", note: "\u201Cdon't send it\u201D means it doesn't. every run reads your words for how far it may go.", children: _jsx(MailScene, {}) }), _jsx(Chapter, { id: "show", log: [["0.0s", "read the console"], ["0.9s", "found “Deployments”"], ["1.1s", "pointed at it", "your turn"]], n: "03", title: "or it just shows you.", note: "ask \u201Cwhere\u201D or \u201Chow do i\u201D, and it points instead of clicking. walk through any tool one step at a time.", children: _jsx(ConsoleScene, {}) }), _jsx(Chapter, { id: "never", log: [["0.0s", "typed your email"], ["0.7s", "reached “Password”"], ["0.7s", "refused", "passwords are yours"]], n: "04", title: "some things stay yours.", note: "passwords, card numbers, one-time codes, CAPTCHAs, new accounts, payments. refused at the keystroke \u2014 even if the page, or the model, insists.", children: _jsx(NeverScene, {}) }), _jsxs("section", { className: "proof", children: [_jsx("p", { className: "proof-head", children: "measured, not promised \u2014 from this project's own test runs" }), _jsxs("div", { className: "proof-grid", children: [_jsxs("div", { className: "stat", children: [_jsxs("strong", { children: [_jsx(Count, { to: 13 }), _jsx("span", { className: "of", children: "/13" })] }), _jsx("p", { children: "times it picked the right thing to click on real sites \u2014 GitHub, Hacker News, job boards" })] }), _jsxs("div", { className: "stat", children: [_jsx("strong", { children: _jsx(Count, { to: 98.3, decimals: 1, suffix: "%" }) }), _jsx("p", { children: "of fields on five real job applications matched to the right detail, in one call per form" })] }), _jsxs("div", { className: "stat", children: [_jsxs("strong", { children: [_jsx(Count, { to: 30 }), _jsx("span", { className: "of", children: "/30" })] }), _jsx("p", { children: "behaviour checks passed by both engines \u2014 shadow DOM, iframes, modals, re-renders, new tabs" })] }), _jsxs("div", { className: "stat zero", children: [_jsx("strong", { children: "0" }), _jsx("p", { children: "passwords typed. the one rule that holds even when the model, or the page, is wrong" })] })] })] }), _jsxs("section", { id: "talk", className: "talk", children: [_jsx("p", { className: "chapter-n", children: "05" }), _jsxs("h2", { children: ["press two keys.", _jsx("br", {}), "or just say ", _jsx("em", { children: "\u201Chey jev.\u201D" })] }), _jsxs("div", { className: "talk-row", children: [_jsxs("div", { className: "keys", "aria-label": "Option J", children: [_jsx("span", { className: "key", children: "\u2325" }), _jsx("span", { className: "key", children: "J" })] }), _jsx("div", { className: "wave", "aria-hidden": true, children: Array.from({ length: 22 }, (_, i) => (
                                        // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
                                        _jsx("i", { style: { animationDelay: `${(i % 7) * 90}ms` } }, i))) }), _jsx("p", { className: "said", children: "\u201Chey jev, summarise this pull request\u201D" })] }), _jsx("p", { className: "talk-note", children: "\u2325J opens jev on the tab you're on. turn on \u201Clisten when i open jev\u201D and you can just talk. \u201Chey jev\u201D works while the panel is open \u2014 off until you switch it on, and visibly on when it is." })] }), _jsxs("section", { className: "wall", children: [_jsxs("h2", { className: "wall-title", children: ["the tedious middle of ", _jsx("em", { children: "everything." })] }), _jsx("div", { className: "wall-grid", children: WALL.map(([tone, url, task, kind]) => (_jsxs("article", { className: `tile tone-${tone}`, children: [_jsxs("div", { className: "tile-bar", children: [_jsx("i", {}), url] }), _jsx("p", { className: "tile-task", children: task }), _jsx("span", { className: `tile-kind ${kind === "show me" ? "accent" : ""}`, children: kind })] }, url))) })] }), _jsx(Chapter, { id: "pricing", log: [["0.0s", "picked the plan"], ["0.4s", "reached “Pay”"], ["0.4s", "stopped", "you pay, never jev"]], n: "06", title: _jsxs(_Fragment, { children: ["it gets you to checkout.", _jsx("br", {}), "you pay."] }), note: "start free. that's the whole plan, for now.", children: _jsx(CheckoutScene, { onFree: () => navigate(next) }) }), _jsxs("section", { id: "history", className: "history", children: [_jsx("p", { className: "chapter-n", children: "07" }), _jsx("h2", { children: "things people have asked." }), _jsxs("div", { className: "hist", children: [_jsx("p", { className: "hist-day", children: "Today \u2014 jev://history" }), HISTORY.map(([time, q, a]) => (_jsxs("details", { className: "hist-row", children: [_jsxs("summary", { children: [_jsx("span", { className: "hist-time", children: time }), _jsx("span", { className: "fav fav-hello", "aria-hidden": true }), _jsx("span", { className: "hist-q", children: q }), _jsx("span", { className: "hist-host", children: "jev.app" })] }), _jsx("p", { children: a })] }, q)))] })] }), _jsxs("section", { className: "bye", children: [_jsxs("h2", { children: ["give it something ", _jsx("em", { children: "boring" }), " to do."] }), _jsx(Link, { className: "ink-btn big", href: next, children: "get jev \u2014 it's free" })] })] }), _jsxs("footer", { className: "status", children: [_jsxs("span", { children: [_jsx("span", { className: "dot" }), " jev.app \u2014 done"] }), _jsx("span", { children: "\u00A9 2026 jev" }), _jsxs("nav", { children: [_jsx("a", { href: "#never", children: "safety" }), _jsx("a", { href: "#pricing", children: "pricing" }), _jsx("a", { href: "#history", children: "questions" }), _jsx(Link, { href: "/signin", children: "sign in" })] })] })] }));
}
function Chapter({ id, n, title, note, log, children, }) {
    return (_jsxs("section", { id: id, className: "chapter", children: [_jsxs("div", { className: "chapter-head", children: [_jsx("p", { className: "chapter-n", children: n }), _jsx("h2", { className: "reveal", children: title }), _jsx("p", { className: "chapter-note reveal", children: note }), _jsx("ol", { className: "log", children: log.map(([t, what, why]) => (_jsxs("li", { className: why ? "held" : "", children: [_jsx("span", { className: "log-t", children: t }), _jsx("span", { className: "log-mark", children: why ? "!" : "✓" }), _jsxs("span", { className: "log-what", children: [what, why && _jsx("em", { children: why })] })] }, `${t}-${what}`))) })] }), _jsx("div", { className: "chapter-stage", children: children })] }));
}
//# sourceMappingURL=Landing.js.map