import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { Cancelled, take } from "./agent.js";
/**
 * The hero's stage: five small sites floating in layered depth, and Jev darting between
 * them doing one thing on each. Everything here moves on its own clock — the windows
 * drift, the arrows draw themselves, the chips float — so the stage is never still,
 * but nothing competes with the cursor, which is the one thing that moves with intent.
 */
const TASKS = [
    { key: "jobs", say: "applying — 4 of 10" },
    { key: "mail", say: "drafting, not sending" },
    { key: "flights", say: "₹5,480 — cheapest on the 22nd" },
    { key: "console", say: "prod is healthy ✓" },
    { key: "form", say: "filled 9 of 9 fields" },
];
export function HeroStage() {
    const stage = useRef(null);
    const targets = useRef({});
    const [lit, setLit] = useState(null);
    const [progress, setProgress] = useState(0);
    useEffect(() => {
        const el = stage.current;
        if (!el)
            return;
        let running = false;
        const io = new IntersectionObserver(([entry]) => {
            if (!entry?.isIntersecting || running)
                return;
            running = true;
            const s = take();
            void (async () => {
                try {
                    await s.wait(900);
                    for (let i = 0;; i = (i + 1) % TASKS.length) {
                        const t = TASKS[i];
                        if (!t)
                            continue;
                        setLit(t.key);
                        await s.moveTo(targets.current[t.key] ?? null, t.say);
                        await s.click();
                        setProgress((p) => p + 1);
                        await s.wait(1300);
                    }
                }
                catch (err) {
                    if (!(err instanceof Cancelled))
                        throw err;
                }
                finally {
                    running = false;
                    setLit(null);
                }
            })();
        }, { threshold: 0.5 });
        io.observe(el);
        return () => io.disconnect();
    }, []);
    const ref = (key) => (el) => {
        targets.current[key] = el;
    };
    return (_jsxs("div", { className: "stage", ref: stage, "aria-hidden": true, children: [_jsxs("svg", { className: "doodles", viewBox: "0 0 600 560", fill: "none", children: [_jsx("path", { className: "draw d1", d: "M70 90 C 150 30, 250 40, 300 110" }), _jsx("path", { className: "draw d1", d: "M285 92 L300 110 L276 112" }), _jsx("path", { className: "draw d2", d: "M520 330 C 560 400, 520 470, 430 480" }), _jsx("path", { className: "draw d3", d: "M40 420 q 30 -30 60 0 t 60 0 t 60 0" }), _jsx("circle", { className: "draw d4", cx: "470", cy: "80", r: "30" })] }), _jsxs("div", { className: `mini w-jobs ${lit === "jobs" ? "lit" : ""}`, children: [_jsx(MiniBar, { url: "careers.northwind.dev", tone: "#1c6b47" }), _jsxs("div", { className: "mini-body", children: [_jsx("p", { className: "m-eyebrow", children: "Northwind \u00B7 remote" }), _jsx("p", { className: "m-title", children: "Frontend Engineer" }), _jsx("span", { className: "m-btn green", ref: ref("jobs"), children: "Easy Apply" }), _jsx("div", { className: "m-meter", children: _jsx("i", { style: { width: `${Math.min(100, 40 + (progress % 7) * 10)}%` } }) })] })] }), _jsxs("div", { className: `mini w-mail ${lit === "mail" ? "lit" : ""}`, children: [_jsx(MiniBar, { url: "mail.example.com", tone: "#d4452a" }), _jsxs("div", { className: "mini-body", children: [_jsx("p", { className: "m-title sm", children: "Re: Can we ship Friday?" }), _jsx("p", { className: "m-line" }), _jsx("p", { className: "m-line short" }), _jsx("span", { className: "m-btn red ghosted", ref: ref("mail"), children: "Send" })] })] }), _jsxs("div", { className: `mini w-flights ${lit === "flights" ? "lit" : ""}`, children: [_jsx(MiniBar, { url: "flights.example/blr-del", tone: "#2d6a6a" }), _jsx("div", { className: "mini-body", children: [
                            ["06:10", "₹6,210"],
                            ["09:45", "₹5,480"],
                            ["18:30", "₹7,050"],
                        ].map(([t, p]) => (_jsxs("div", { className: `m-flight ${p === "₹5,480" ? "best" : ""}`, ref: p === "₹5,480" ? ref("flights") : undefined, children: [_jsx("b", { children: t }), _jsx("span", { children: "BLR \u2192 DEL" }), _jsx("em", { children: p })] }, t))) })] }), _jsxs("div", { className: `mini w-console dark ${lit === "console" ? "lit" : ""}`, children: [_jsx(MiniBar, { url: "console.cloud.example", tone: "#b8f06a", dark: true }), _jsx("div", { className: "mini-body", children: ["admin-panel-prod", "webapp-core-prod"].map((n, i) => (_jsxs("div", { className: "m-row", ref: i === 1 ? ref("console") : undefined, children: [_jsx("i", {}), n] }, n))) })] }), _jsxs("div", { className: `mini w-form ${lit === "form" ? "lit" : ""}`, children: [_jsx(MiniBar, { url: "forms.example/survey", tone: "#6b4bb8" }), _jsx("div", { className: "mini-body", children: ["Name", "Email", "Role"].map((f, i) => (_jsxs("div", { className: "m-field", ref: i === 2 ? ref("form") : undefined, children: [_jsx("span", { children: f }), _jsx("i", { style: { width: `${[62, 78, 44][i]}%` } })] }, f))) })] }), _jsxs("span", { className: "chip c1", children: [_jsx("i", { className: "fav fav-do" }), " 10 applications"] }), _jsxs("span", { className: "chip c2", children: [_jsx("i", { className: "fav fav-hello" }), " \u2325 J"] }), _jsxs("span", { className: "chip c3", children: [_jsx("i", { className: "fav fav-never" }), " never types passwords"] }), _jsx("span", { className: "spark s1" }), _jsx("span", { className: "spark s2" }), _jsx("span", { className: "spark s3" })] }));
}
function MiniBar({ url, tone, dark }) {
    return (_jsxs("div", { className: `mini-bar ${dark ? "dark" : ""}`, children: [_jsx("span", { className: "mini-fav", style: { background: tone } }), _jsx("span", { className: "mini-url", children: url })] }));
}
const WORDS_A = [
    ["do", "apply to ten frontend roles"],
    ["draft", "draft a reply, don't send it"],
    ["hello", "summarise this pull request"],
    ["show", "where are the prod deploys?"],
    ["pricing", "find flights under ₹6,000"],
    ["do", "fill this form with my details"],
];
const WORDS_B = [
    ["draft", "reply to priya: friday works"],
    ["show", "how do i turn on two-factor?"],
    ["hello", "compare this laptop on three sites"],
    ["do", "add these three to my cart"],
    ["never", "stop before paying"],
    ["talk", "hey jev, check the build"],
];
/** Two rows of real requests, sliding in opposite directions. */
export function Marquee() {
    return (_jsx("div", { className: "marquee", "aria-hidden": true, children: [WORDS_A, WORDS_B].map((row, r) => (_jsx("div", { className: `mq-row ${r ? "rev" : ""}`, children: [...row, ...row, ...row].map(([fav, text], i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: repeated decoration
            _jsxs("span", { className: "mq-chip", children: [_jsx("i", { className: `fav fav-${fav}` }), text] }, i))) }, r))) }));
}
/** A number that counts up when it scrolls into view. */
export function Count({ to, suffix = "", decimals = 0 }) {
    const el = useRef(null);
    const [v, setV] = useState(0);
    useEffect(() => {
        const node = el.current;
        if (!node)
            return;
        let raf = 0;
        const io = new IntersectionObserver(([e]) => {
            if (!e?.isIntersecting)
                return;
            io.disconnect();
            const start = performance.now();
            const tick = (now) => {
                const t = Math.min(1, (now - start) / 1400);
                setV(to * (1 - (1 - t) ** 4));
                if (t < 1)
                    raf = requestAnimationFrame(tick);
            };
            raf = requestAnimationFrame(tick);
        });
        io.observe(node);
        return () => {
            io.disconnect();
            cancelAnimationFrame(raf);
        };
    }, [to]);
    return (_jsxs("span", { ref: el, children: [v.toFixed(decimals), suffix] }));
}
//# sourceMappingURL=hero.js.map