import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { HeroDemo } from "../components/HeroDemo.js";
import { Nav } from "../components/Nav.js";
import { Link } from "../router.js";
const USES = [
    { title: "Apply to jobs", ask: "Apply to ten frontend roles with my resume, don't submit until I check", tag: "Forms" },
    { title: "Draft and reply", ask: "Draft a reply to this thread saying we'll ship Friday", tag: "Writing" },
    { title: "Check a dashboard", ask: "Open Amplify and tell me if the prod app is healthy", tag: "Ops" },
    { title: "Summarise anything", ask: "Summarise this pull request in three bullets", tag: "Reading" },
    { title: "Find it for you", ask: "Find flights to Delhi on the 22nd under ₹6,000", tag: "Search" },
    { title: "Fill the boring parts", ask: "Fill this form with my details, I'll submit", tag: "Forms" },
    { title: "Compare across sites", ask: "Compare this laptop's price on three stores", tag: "Research" },
    { title: "Learn a tool", ask: "Where do I turn on two-factor here?", tag: "Show me" },
];
const NEVER = [
    ["Types a password, card number, CVV, OTP or PIN", "Refused at the keystroke, even if the page or the model insists."],
    ["Solves a CAPTCHA", "It stops and hands the browser back to you."],
    ["Creates an account for you", "Signing up is yours to do."],
    ["Enters payment details", "It gets you to checkout. You pay."],
    ["Finalises anything you said not to", "“Don't submit” holds for the whole task — no setting overrides it."],
];
const FAQ = [
    [
        "Does it see everything I browse?",
        "No. Jev only looks at a tab when you give it a task there, and only after you've allowed that site. It ships with access to nothing.",
    ],
    [
        "Is it always listening?",
        "No. Voice is off until you turn it on. “Hey Jev” only listens while the Jev panel is open, and the panel shows it the whole time. Speech recognition is Chrome's own.",
    ],
    [
        "What does it do before something I can't undo?",
        "If you told it to go ahead, it goes ahead. If you asked to review, it asks — once, before the step, and only when the step can actually happen. If you said not to finalise, it never does.",
    ],
    [
        "What happens when a site needs me?",
        "Sign-ins, CAPTCHAs, payments and new accounts are handed back to you with one sentence saying why. Once you've done that part, run the task again.",
    ],
    [
        "Which sites does it work on?",
        "Ordinary web pages — including ones built with web components and same-origin frames. Pages drawn on a canvas, and card fields inside payment frames, it leaves to you.",
    ],
    [
        "What's a credit?",
        "A thousandth of a dollar of model usage. A typical ten-step task costs ten to twenty. You start with 500.",
    ],
];
export function Landing() {
    return (_jsxs("div", { className: "site", children: [_jsx(Nav, {}), _jsxs("header", { className: "hero", children: [_jsx("p", { className: "kicker", children: "An assistant for Chrome" }), _jsxs("h1", { children: ["Ask for it.", _jsx("br", {}), "Watch it happen."] }), _jsx("p", { className: "lede", children: "Tell Jev what you want done and watch its cursor do it on the page in front of you \u2014 apply, fill, draft, check, compare. Or ask where something is, and it points." }), _jsxs("div", { className: "cta-row", children: [_jsx(Link, { className: "btn primary", href: "/signin", children: "Get started \u2014 it's free" }), _jsx(Link, { className: "btn ghost", href: "/#how", children: "How it works" })] }), _jsx(HeroDemo, {})] }), _jsxs("section", { id: "how", className: "band", children: [_jsxs("div", { className: "section-head", children: [_jsx("p", { className: "kicker", children: "Two ways to use it" }), _jsx("h2", { children: "Have it done. Or be shown." })] }), _jsxs("div", { className: "two", children: [_jsxs("article", { className: "card big", children: [_jsx("span", { className: "chip", children: "Do it" }), _jsx("h3", { children: "\u201CDraft a reply saying we'll ship Friday.\u201D" }), _jsx("p", { children: "Jev plans the task, then works through it where you can see it: the cursor glides to each thing before it clicks or types, and says what it's doing." })] }), _jsxs("article", { className: "card big", children: [_jsx("span", { className: "chip accent", children: "Show me" }), _jsx("h3", { children: "\u201CWhere do I turn on two-factor?\u201D" }), _jsx("p", { children: "Same understanding, different ending. Jev finds the setting, points at it and outlines it \u2014 then waits for you to click. Walk through a whole tool one step at a time." })] })] })] }), _jsxs("section", { className: "band", children: [_jsxs("div", { className: "section-head", children: [_jsx("p", { className: "kicker", children: "Start it however you like" }), _jsx("h2", { children: "Press a key. Or just say it." })] }), _jsxs("div", { className: "starts", children: [_jsxs("div", { className: "start", children: [_jsx("kbd", { children: "\u2325 J" }), _jsx("h4", { children: "Open Jev" }), _jsx("p", { children: "The panel opens on the tab you're on, ready to type." })] }), _jsxs("div", { className: "start", children: [_jsx("kbd", { children: "\u2325 J" }), _jsx("span", { className: "then", children: "then talk" }), _jsx("h4", { children: "Say what you want" }), _jsx("p", { children: "Turn on \u201CListen when I open Jev\u201D. Speak, pause \u2014 it runs." })] }), _jsxs("div", { className: "start", children: [_jsx("kbd", { children: "\u201CHey Jev\u201D" }), _jsx("h4", { children: "Hands-free" }), _jsx("p", { children: "While the panel is open, say the words and the request. Off until you turn it on." })] })] })] }), _jsxs("section", { id: "uses", className: "band", children: [_jsxs("div", { className: "section-head", children: [_jsx("p", { className: "kicker", children: "What people ask it" }), _jsx("h2", { children: "Thousands of small jobs you'd rather not do." })] }), _jsx("div", { className: "uses", children: USES.map((u) => (_jsxs("article", { className: "use", children: [_jsx("span", { className: `chip ${u.tag === "Show me" ? "accent" : ""}`, children: u.tag }), _jsx("h4", { children: u.title }), _jsxs("p", { children: ["\u201C", u.ask, "\u201D"] })] }, u.title))) })] }), _jsxs("section", { id: "trust", className: "band", children: [_jsxs("div", { className: "section-head", children: [_jsx("p", { className: "kicker", children: "Safety" }), _jsx("h2", { children: "What it will never do." }), _jsx("p", { className: "sub", children: "One rule is built so deep it holds even when everything above it is wrong: no secret is ever typed. The rest follows your words, not the page's." })] }), _jsx("ul", { className: "never", children: NEVER.map(([what, why]) => (_jsxs("li", { children: [_jsx("span", { className: "x", "aria-hidden": true, children: "\u2715" }), _jsxs("div", { children: [_jsx("strong", { children: what }), _jsx("p", { children: why })] })] }, what))) })] }), _jsxs("section", { id: "pricing", className: "band", children: [_jsxs("div", { className: "section-head", children: [_jsx("p", { className: "kicker", children: "Pricing" }), _jsx("h2", { children: "Start free. Pay for what it does." })] }), _jsxs("div", { className: "plans", children: [_jsxs("article", { className: "plan", children: [_jsx("h3", { children: "Free" }), _jsxs("p", { className: "price", children: ["$0", _jsx("span", { children: "forever" })] }), _jsxs("ul", { children: [_jsx("li", { children: "500 credits when you sign up" }), _jsx("li", { children: "About thirty everyday tasks" }), _jsx("li", { children: "Voice, show-me mode, everything" })] }), _jsx(Link, { className: "btn primary block", href: "/signin", children: "Get started" })] }), _jsxs("article", { className: "plan featured", children: [_jsx("h3", { children: "Pro" }), _jsxs("p", { className: "price", children: ["$20", _jsx("span", { children: "/ month" })] }), _jsxs("ul", { children: [_jsx("li", { children: "20,000 credits a month" }), _jsx("li", { children: "Long multi-site tasks" }), _jsx("li", { children: "Priority model capacity" })] }), _jsx("span", { className: "btn ghost block disabled", "aria-disabled": "true", children: "Coming soon" })] }), _jsxs("article", { className: "plan", children: [_jsx("h3", { children: "Max" }), _jsxs("p", { className: "price", children: ["$100", _jsx("span", { children: "/ month" })] }), _jsxs("ul", { children: [_jsx("li", { children: "120,000 credits a month" }), _jsx("li", { children: "Batch runs across many sites" }), _jsx("li", { children: "Early features" })] }), _jsx("span", { className: "btn ghost block disabled", "aria-disabled": "true", children: "Coming soon" })] })] }), _jsx("p", { className: "fine center", children: "1 credit is a thousandth of a dollar of model usage. Paid plans open soon." })] }), _jsxs("section", { id: "faq", className: "band narrow", children: [_jsxs("div", { className: "section-head", children: [_jsx("p", { className: "kicker", children: "Questions" }), _jsx("h2", { children: "The honest answers." })] }), FAQ.map(([q, a]) => (_jsxs("details", { className: "faq", children: [_jsx("summary", { children: q }), _jsx("p", { children: a })] }, q)))] }), _jsxs("section", { className: "closing", children: [_jsx("h2", { children: "Give it something to do." }), _jsx(Link, { className: "btn primary", href: "/signin", children: "Get started \u2014 it's free" })] }), _jsxs("footer", { className: "foot", children: [_jsx("span", { children: "\u00A9 2026 Jev" }), _jsxs("nav", { children: [_jsx(Link, { href: "/#trust", children: "Safety" }), _jsx(Link, { href: "/#pricing", children: "Pricing" }), _jsx(Link, { href: "/#faq", children: "FAQ" }), _jsx(Link, { href: "/signin", children: "Sign in" })] })] })] }));
}
//# sourceMappingURL=Landing.js.map