import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
const START = {
    cursor: { x: 0, y: 0, label: "", visible: false },
    ripple: 0,
    form: false,
    sent: false,
    values: { name: "", email: "" },
    focused: null,
    steps: ["pending", "pending", "pending"],
    lines: [],
    summary: false,
};
const FINAL = {
    ...START,
    cursor: { x: 0, y: 0, label: "Clicking “Submit application”", visible: true },
    form: true,
    sent: true,
    values: { name: "Abdul Bayees", email: "abdul@dolze.ai" },
    steps: ["done", "done", "done"],
    lines: ["Opened the application", "Typed your name and email", "Submitted it"],
    summary: true,
};
const STEP_TITLES = ["Open the application", "Fill in your details", "Submit it"];
export function HeroDemo() {
    const stage = useRef(null);
    const targets = useRef({});
    const [scene, setScene] = useState(START);
    const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    useEffect(() => {
        if (reduced) {
            setScene(FINAL);
            requestAnimationFrame(() => {
                // In the finished frame the form has been replaced by the confirmation.
                const at = pointOf("sent");
                if (at)
                    setScene((s) => ({ ...s, cursor: { ...s.cursor, ...at } }));
            });
            return;
        }
        let alive = true;
        const wait = (ms) => new Promise((resolve, reject) => {
            const t = setTimeout(() => (alive ? resolve() : reject(new Error("stopped"))), ms);
            if (!alive) {
                clearTimeout(t);
                reject(new Error("stopped"));
            }
        });
        const set = (fn) => alive && setScene(fn);
        const moveTo = async (key, label) => {
            const at = pointOf(key);
            if (!at)
                return;
            set((s) => ({ ...s, cursor: { ...at, label, visible: true } }));
            await wait(620);
        };
        const type = async (field, text) => {
            set((s) => ({ ...s, focused: field }));
            for (let i = 1; i <= text.length; i++) {
                set((s) => ({ ...s, values: { ...s.values, [field]: text.slice(0, i) } }));
                await wait(42);
            }
            set((s) => ({ ...s, focused: null }));
        };
        const click = () => set((s) => ({ ...s, ripple: s.ripple + 1 }));
        const loop = async () => {
            while (alive) {
                setScene(START);
                await wait(700);
                set((s) => ({ ...s, cursor: { ...s.cursor, ...bottomRight(), visible: true }, steps: ["running", "pending", "pending"] }));
                await wait(500);
                await moveTo("apply", "Clicking “Easy Apply”");
                click();
                await wait(260);
                set((s) => ({ ...s, form: true, steps: ["done", "running", "pending"], lines: ["Opened the application"] }));
                await wait(700);
                await moveTo("name", "Typing into “Full name”");
                await type("name", "Abdul Bayees");
                await moveTo("email", "Typing into “Email”");
                await type("email", "abdul@dolze.ai");
                set((s) => ({ ...s, steps: ["done", "done", "running"], lines: [...s.lines, "Typed your name and email"] }));
                await wait(300);
                await moveTo("submit", "Clicking “Submit application”");
                click();
                await wait(300);
                set((s) => ({ ...s, sent: true, steps: ["done", "done", "done"], lines: [...s.lines, "Submitted it"], summary: true }));
                await wait(3400);
            }
        };
        loop().catch(() => { });
        return () => {
            alive = false;
        };
    }, [reduced]);
    function pointOf(key) {
        const el = targets.current[key];
        const box = stage.current?.getBoundingClientRect();
        if (!el || !box)
            return null;
        const r = el.getBoundingClientRect();
        return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
    }
    function bottomRight() {
        const box = stage.current?.getBoundingClientRect();
        return { x: (box?.width ?? 600) * 0.55, y: (box?.height ?? 400) - 40 };
    }
    const ref = (key) => (el) => {
        targets.current[key] = el;
    };
    return (_jsxs("div", { className: "demo", "aria-label": "Jev applying to a job, step by step", role: "img", children: [_jsxs("div", { className: "demo-chrome", children: [_jsxs("span", { className: "lights", "aria-hidden": true, children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }), _jsx("span", { className: "omnibox", children: "jobs.northwind.example/frontend-engineer" })] }), _jsxs("div", { className: "demo-body", children: [_jsxs("div", { className: "demo-page", ref: stage, children: [_jsxs("div", { className: "posting", children: [_jsx("p", { className: "eyebrow", children: "Northwind \u00B7 Remote, India" }), _jsx("h3", { children: "Frontend Engineer" }), _jsx("p", { className: "muted", children: "React, TypeScript, and a taste for fast interfaces. Two years or more." }), _jsx("button", { type: "button", className: "fake-btn", ref: ref("apply"), tabIndex: -1, children: "Easy Apply" })] }), _jsx("div", { className: `sheet ${scene.form ? "on" : ""}`, children: scene.sent ? (_jsxs("div", { className: "sent", ref: ref("sent"), children: [_jsx("span", { className: "tick", "aria-hidden": true, children: "\u2713" }), "Application sent"] })) : (_jsxs(_Fragment, { children: [_jsx("h4", { children: "Apply to Northwind" }), _jsxs("label", { children: ["Full name", _jsxs("span", { className: `fake-input ${scene.focused === "name" ? "focus" : ""}`, ref: ref("name"), children: [scene.values.name, scene.focused === "name" && _jsx("i", { className: "caret" })] })] }), _jsxs("label", { children: ["Email", _jsxs("span", { className: `fake-input ${scene.focused === "email" ? "focus" : ""}`, ref: ref("email"), children: [scene.values.email, scene.focused === "email" && _jsx("i", { className: "caret" })] })] }), _jsx("button", { type: "button", className: "fake-btn dark", ref: ref("submit"), tabIndex: -1, children: "Submit application" })] })) }), _jsxs("div", { className: `agent ${scene.cursor.visible ? "on" : ""}`, style: { transform: `translate(${scene.cursor.x}px, ${scene.cursor.y}px)` }, "aria-hidden": true, children: [_jsx("span", { className: scene.ripple ? "ripple go" : "ripple" }, scene.ripple), _jsxs("svg", { width: "26", height: "26", viewBox: "0 0 26 26", className: "arrow", children: [_jsx("path", { d: "M4 2.5 L4 21 L9.2 16.4 L12.6 23.6 L15.9 22.1 L12.6 15 L19.6 15 Z", fill: "#1c1c1e", stroke: "#fff", strokeWidth: "1.6", strokeLinejoin: "round" }), _jsx("circle", { cx: "20.5", cy: "5.5", r: "2.6", fill: "#ff9f0a", stroke: "#fff", strokeWidth: "1.2" })] }), scene.cursor.label && (_jsxs("span", { className: "pill", children: [_jsx("b", { children: "Jev" }), scene.cursor.label] }))] })] }), _jsxs("aside", { className: "demo-panel", "aria-hidden": true, children: [_jsx("div", { className: "panel-goal", children: "apply to this job with my details" }), _jsx("ol", { children: STEP_TITLES.map((title, i) => (_jsxs("li", { className: scene.steps[i], children: [_jsx("span", { className: "mark", children: scene.steps[i] === "done" ? "✓" : scene.steps[i] === "running" ? "●" : "○" }), _jsxs("span", { children: [title, scene.lines[i] && _jsx("small", { children: scene.lines[i] })] })] }, title))) }), scene.summary && (_jsxs("p", { className: "panel-summary", children: [_jsx("strong", { children: "Finished" }), " 6 steps \u00B7 4.1s"] }))] })] })] }));
}
//# sourceMappingURL=HeroDemo.js.map