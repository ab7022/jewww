import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useSyncExternalStore } from "react";
let state = {
    x: 0, y: 0, label: "", mood: "idle", visible: false, ripple: 0, ring: null, trail: { id: 0, points: [] },
};
/** A gentle arc between two points, bowed to one side like a hand moving a mouse. */
function arc(from, to, n = 9) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const bow = Math.min(90, Math.hypot(dx, dy) * 0.18);
    const cx = (from.x + to.x) / 2 - (dy / (Math.hypot(dx, dy) || 1)) * bow;
    const cy = (from.y + to.y) / 2 + (dx / (Math.hypot(dx, dy) || 1)) * bow;
    return Array.from({ length: n }, (_, i) => {
        const t = (i + 1) / (n + 1);
        return {
            x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * cx + t * t * to.x,
            y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * cy + t * t * to.y,
        };
    });
}
const subs = new Set();
const set = (patch) => {
    state = { ...state, ...patch };
    for (const s of subs)
        s();
};
export const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Whoever holds the cursor now. A newer holder cancels the older one's script. */
let holder = 0;
export class Cancelled extends Error {
}
/** Take the cursor for a scene. Every step throws `Cancelled` once someone else takes it. */
export function take() {
    const me = ++holder;
    const alive = () => {
        if (me !== holder)
            throw new Cancelled();
    };
    const wait = (ms) => new Promise((resolve, reject) => setTimeout(() => (me === holder ? resolve() : reject(new Cancelled())), reducedMotion() ? 0 : ms));
    return {
        async moveTo(el, label, at = "center") {
            alive();
            if (!el)
                return;
            const r = el.getBoundingClientRect();
            const to = {
                x: (at === "left" ? r.left + 18 : r.left + r.width / 2) + window.scrollX,
                y: r.top + r.height / 2 + window.scrollY,
            };
            const far = Math.hypot(to.x - state.x, to.y - state.y) > 60 && state.visible;
            set({
                ...to,
                ...(far && !reducedMotion() ? { trail: { id: state.trail.id + 1, points: arc(state, to) } } : {}),
                visible: true,
                mood: "busy",
                // Silent in transit: the label belongs to where it lands, not where it left.
                ...(label !== undefined ? { label: "" } : {}),
            });
            await wait(560);
            if (label !== undefined)
                set({ label });
            await wait(80);
        },
        async click() {
            alive();
            set({ ripple: state.ripple + 1 });
            await wait(240);
        },
        say(label, mood = "busy") {
            alive();
            set({ label, mood, visible: true });
        },
        ring(el) {
            alive();
            if (!el)
                return set({ ring: null });
            const r = el.getBoundingClientRect();
            set({ ring: { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height } });
        },
        wait,
        async type(setText, text, speed = 38) {
            for (let i = 1; i <= text.length; i++) {
                alive();
                setText(text.slice(0, i));
                await wait(speed);
            }
        },
        async shake() {
            alive();
            set({ mood: "no" });
            await wait(700);
        },
    };
}
export function release() {
    holder++;
    set({ ring: null, mood: "idle" });
}
export function useAgent() {
    return useSyncExternalStore((cb) => {
        subs.add(cb);
        return () => subs.delete(cb);
    }, () => state, () => state);
}
/** The cursor itself. Rendered once, at the top of the landing page. */
export function Agent() {
    const a = useAgent();
    useEffect(() => {
        // Enter from the hero, so the first thing anyone sees it do is arrive.
        set({ x: window.innerWidth * 0.72, y: 260, visible: true, label: "hi. i'm jev.", mood: "idle" });
    }, []);
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: "jev-trail", "aria-hidden": true, children: a.trail.points.map((p, i) => (_jsx("i", { style: { left: p.x, top: p.y, animationDelay: `${i * 45}ms` } }, i))) }, a.trail.id), a.ring && (_jsx("div", { className: "agent-ring", style: { left: a.ring.x - 6, top: a.ring.y - 6, width: a.ring.w + 12, height: a.ring.h + 12 }, "aria-hidden": true })), _jsxs("div", { className: `jev ${a.visible ? "on" : ""} mood-${a.mood}`, style: { transform: `translate(${a.x}px, ${a.y}px)` }, "aria-hidden": true, children: [_jsx("span", { className: a.ripple ? "jev-ripple go" : "jev-ripple" }, a.ripple), _jsxs("svg", { className: "jev-arrow", width: "30", height: "30", viewBox: "0 0 26 26", children: [_jsx("path", { d: "M4 2.5 L4 21 L9.2 16.4 L12.6 23.6 L15.9 22.1 L12.6 15 L19.6 15 Z", fill: "#141414", stroke: "#fff", strokeWidth: "1.6", strokeLinejoin: "round" }), _jsx("circle", { className: "jev-spark", cx: "20.5", cy: "5.5", r: "2.8", fill: "#ff8a00", stroke: "#fff", strokeWidth: "1.2" })] }), a.label && _jsx("span", { className: "jev-says", children: a.label })] })] }));
}
//# sourceMappingURL=agent.js.map