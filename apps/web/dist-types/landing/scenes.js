import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { Asked, Site, useScene } from "./scene.js";
/**
 * The sites Jev visits on the landing page. Each is one real behaviour of the product,
 * acted out — not a feature card: it applies, it drafts but does not send when told
 * not to, it points instead of clicking when asked "where", and it will not type a
 * password however it is asked.
 */
export function JobsScene() {
    const root = useRef(null);
    const apply = useRef(null);
    const nameEl = useRef(null);
    const emailEl = useRef(null);
    const submit = useRef(null);
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [sent, setSent] = useState(false);
    const [count, setCount] = useState(3);
    useScene(root, async (s) => {
        await s.moveTo(apply.current, "applying for you…");
        await s.click();
        setOpen(true);
        await s.wait(500);
        await s.moveTo(nameEl.current, "typing your name", "left");
        await s.type(setName, "Abdul Bayees");
        await s.moveTo(emailEl.current, "and your email", "left");
        await s.type(setEmail, "abdul@dolze.ai", 30);
        await s.moveTo(submit.current, "sending it");
        await s.click();
        setSent(true);
        setCount((c) => Math.min(10, c + 1));
        s.say("done. next one?");
    }, () => {
        setOpen(false);
        setName("");
        setEmail("");
        setSent(false);
    });
    return (_jsxs("div", { className: "scene", ref: root, children: [_jsx(Asked, { children: "apply to ten frontend roles with my resume" }), _jsx(Site, { url: "careers.northwind.dev/jobs/frontend-engineer", tone: "jobs", children: _jsxs("div", { className: "jobs", children: [_jsxs("aside", { className: "jobs-list", children: [_jsxs("p", { className: "jobs-count", children: [_jsx("strong", { children: count }), " of 10 applied"] }), ["Frontend Engineer", "UI Engineer", "Web Platform", "Design Engineer"].map((t, i) => (_jsxs("div", { className: `jobs-item ${i === 0 ? "current" : ""}`, children: [_jsx("b", { children: t }), _jsxs("span", { children: [["Northwind", "Tessel", "Kiln", "Parallel"][i], " \u00B7 remote"] })] }, t)))] }), _jsxs("article", { className: "jobs-post", children: [_jsx("p", { className: "jobs-co", children: "Northwind \u2014 Bengaluru or remote" }), _jsx("h3", { children: "Frontend Engineer" }), _jsx("p", { className: "jobs-desc", children: "Build the interfaces people actually enjoy. React, TypeScript, and strong opinions about milliseconds." }), _jsx("button", { type: "button", className: "jobs-apply", ref: apply, tabIndex: -1, children: "Easy Apply" }), _jsx("div", { className: `jobs-sheet ${open ? "on" : ""}`, children: sent ? (_jsxs("p", { className: "jobs-sent", children: [_jsx("span", { children: "\u2713" }), " Application sent"] })) : (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["Full name", _jsx("span", { className: "fx", ref: nameEl, children: name })] }), _jsxs("label", { children: ["Email", _jsx("span", { className: "fx", ref: emailEl, children: email })] }), _jsxs("label", { children: ["Resume", _jsx("span", { className: "fx file", children: "abdul-bayees-resume.pdf" })] }), _jsx("button", { type: "button", className: "jobs-submit", ref: submit, tabIndex: -1, children: "Submit application" })] })) })] })] }) })] }));
}
export function MailScene() {
    const root = useRef(null);
    const reply = useRef(null);
    const body = useRef(null);
    const send = useRef(null);
    const [composing, setComposing] = useState(false);
    const [text, setText] = useState("");
    useScene(root, async (s) => {
        await s.moveTo(reply.current, "replying");
        await s.click();
        setComposing(true);
        await s.wait(350);
        await s.moveTo(body.current, "writing it in your voice", "left");
        await s.type(setText, "Yes — Friday works. I'll send the build over by noon. — Abdul", 26);
        await s.moveTo(send.current, "");
        s.ring(send.current);
        s.say("drafted. not sending — you said don't.", "point");
        await s.wait(2600);
        s.ring(null);
    }, () => {
        setComposing(false);
        setText("");
    });
    return (_jsxs("div", { className: "scene", ref: root, children: [_jsx(Asked, { children: "draft a reply to priya saying friday works \u2014 don't send it" }), _jsx(Site, { url: "mail.example.com/inbox/ship-date", tone: "mail", children: _jsxs("div", { className: "mail", children: [_jsxs("nav", { className: "mail-side", children: [_jsx("span", { className: "mail-compose", children: "Compose" }), _jsx("span", { className: "on", children: "Inbox 12" }), _jsx("span", { children: "Starred" }), _jsx("span", { children: "Sent" }), _jsx("span", { children: "Drafts" })] }), _jsxs("div", { className: "mail-thread", children: [_jsx("h3", { children: "Can we ship Friday?" }), _jsxs("div", { className: "mail-msg", children: [_jsx("span", { className: "avatar", children: "P" }), _jsxs("div", { children: [_jsx("b", { children: "Priya Raman" }), _jsx("p", { children: "Hey \u2014 design signed off this morning. Can we get the build to QA by Friday?" })] })] }), !composing ? (_jsx("button", { type: "button", className: "mail-reply", ref: reply, tabIndex: -1, children: "\u21A9 Reply" })) : (_jsxs("div", { className: "mail-box", children: [_jsx("p", { className: "mail-to", children: "To: Priya Raman" }), _jsxs("div", { className: "mail-body", ref: body, children: [text, _jsx("i", { className: "caret" })] }), _jsx("button", { type: "button", className: "mail-send", ref: send, tabIndex: -1, children: "Send" })] }))] })] }) })] }));
}
export function ConsoleScene() {
    const root = useRef(null);
    const deploys = useRef(null);
    useScene(root, async (s) => {
        s.say("let me look…");
        await s.wait(700);
        await s.moveTo(deploys.current, "it's right here. your turn →", "left");
        s.ring(deploys.current);
        s.say("it's right here. your turn →", "point");
        await s.wait(3200);
        s.ring(null);
    }, () => { });
    return (_jsxs("div", { className: "scene", ref: root, children: [_jsx(Asked, { children: "where do i see the prod deploys?" }), _jsx(Site, { url: "console.cloud.example/amplify/apps", tone: "console", children: _jsxs("div", { className: "console", children: [_jsxs("nav", { className: "console-side", children: [_jsx("p", { className: "console-app", children: "dolze-webapp" }), _jsx("span", { children: "Overview" }), _jsx("span", { children: "Branches" }), _jsx("span", { ref: deploys, children: "Deployments" }), _jsx("span", { children: "Domains" }), _jsx("span", { children: "Environment" }), _jsx("span", { children: "Logs" })] }), _jsxs("div", { className: "console-main", children: [_jsx("h3", { children: "All apps" }), [
                                    ["dolze-admin-panel-prod", "main", "9 days ago"],
                                    ["dolze-webapp-core-prod", "main", "2 days ago"],
                                    ["dolze-webapp-core-uat", "uat", "1 day ago"],
                                ].map(([n, b, t]) => (_jsxs("div", { className: "console-row", children: [_jsx("span", { className: "ok" }), _jsx("b", { children: n }), _jsx("span", { children: b }), _jsx("span", { children: t })] }, n)))] })] }) })] }));
}
export function NeverScene() {
    const root = useRef(null);
    const user = useRef(null);
    const pass = useRef(null);
    const [email, setEmail] = useState("");
    useScene(root, async (s) => {
        await s.moveTo(user.current, "your email, sure", "left");
        await s.type(setEmail, "abdul@dolze.ai", 30);
        await s.moveTo(pass.current, "and the password…", "left");
        await s.wait(300);
        s.say("nope. passwords are yours.", "no");
        await s.shake();
        s.say("nope. passwords are yours.", "no");
        await s.wait(2200);
    }, () => setEmail(""));
    return (_jsxs("div", { className: "scene", ref: root, children: [_jsx(Asked, { children: "just log in for me" }), _jsx(Site, { url: "bank.example.com/login", tone: "bank", children: _jsxs("div", { className: "bank", children: [_jsx("p", { className: "bank-logo", children: "\u25B2 ledgerly" }), _jsx("h3", { children: "Sign in" }), _jsxs("label", { children: ["Email", _jsx("span", { className: "fx", ref: user, children: email })] }), _jsxs("label", { children: ["Password", _jsx("span", { className: "fx pw", ref: pass })] }), _jsx("span", { className: "bank-btn", children: "Sign in" })] }) })] }));
}
export function CheckoutScene({ onFree }) {
    const root = useRef(null);
    const pay = useRef(null);
    useScene(root, async (s) => {
        await s.moveTo(pay.current, "");
        s.ring(pay.current);
        s.say("this bit's yours. i never pay.", "point");
        await s.wait(3000);
        s.ring(null);
    }, () => { });
    return (_jsx("div", { className: "scene", ref: root, children: _jsx(Site, { url: "jev.app/checkout", tone: "checkout", children: _jsxs("div", { className: "checkout", children: [_jsxs("div", { className: "plans-list", children: [_jsxs("label", { className: "plan-line picked", children: [_jsx("span", { className: "radio on" }), _jsxs("span", { children: [_jsx("b", { children: "Free" }), _jsx("small", { children: "500 credits on sign-up \u00B7 about thirty tasks \u00B7 everything included" })] }), _jsx("strong", { children: "$0" })] }), _jsxs("label", { className: "plan-line", children: [_jsx("span", { className: "radio" }), _jsxs("span", { children: [_jsx("b", { children: "Pro" }), " ", _jsx("em", { children: "soon" }), _jsx("small", { children: "20,000 credits a month \u00B7 long multi-site tasks" })] }), _jsx("strong", { children: "$20/mo" })] }), _jsxs("label", { className: "plan-line", children: [_jsx("span", { className: "radio" }), _jsxs("span", { children: [_jsx("b", { children: "Max" }), " ", _jsx("em", { children: "soon" }), _jsx("small", { children: "120,000 credits a month \u00B7 batch runs across many sites" })] }), _jsx("strong", { children: "$100/mo" })] })] }), _jsxs("div", { className: "receipt", children: [_jsxs("p", { children: [_jsx("span", { children: "Plan" }), _jsx("span", { children: "Free" })] }), _jsxs("p", { children: [_jsx("span", { children: "Credits" }), _jsx("span", { children: "500" })] }), _jsxs("p", { className: "total", children: [_jsx("span", { children: "Due today" }), _jsx("span", { children: "$0.00" })] }), _jsx("button", { type: "button", className: "start-free", onClick: onFree, children: "Start free" }), _jsx("span", { className: "pay", ref: pay, children: "Pay" }), _jsx("small", { className: "fineprint", children: "1 credit = a thousandth of a dollar of model usage. Paid plans open soon." })] })] }) }) }));
}
//# sourceMappingURL=scenes.js.map