import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { Cancelled, take } from "./agent.js";
/**
 * Hand Jev the cursor while a scene is on screen, and loop its script there.
 * Scrolling a scene out of view does not stop it by itself — the next scene to arrive
 * takes the cursor, which cancels the previous script mid-step.
 */
export function useScene(ref, script, reset) {
    const run = useRef(script);
    run.current = script;
    const clear = useRef(reset);
    clear.current = reset;
    useEffect(() => {
        const el = ref.current;
        if (!el)
            return;
        let playing = false;
        const io = new IntersectionObserver(([entry]) => {
            if (!entry?.isIntersecting || playing)
                return;
            playing = true;
            const s = take();
            void (async () => {
                try {
                    for (;;) {
                        clear.current();
                        await s.wait(350);
                        await run.current(s);
                        await s.wait(2600);
                    }
                }
                catch (err) {
                    if (!(err instanceof Cancelled))
                        throw err;
                }
                finally {
                    playing = false;
                }
            })();
        }, { threshold: 0.6 });
        io.observe(el);
        return () => io.disconnect();
    }, [ref]);
}
/** A page Jev is visiting: its own address, its own look. */
export function Site({ url, tone, children, id, }) {
    return (_jsxs("div", { className: `site-frame tone-${tone}`, id: id, children: [_jsxs("div", { className: "site-bar", children: [_jsxs("span", { className: "site-dots", "aria-hidden": true, children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }), _jsxs("span", { className: "site-url", children: [_jsx("span", { className: "lock", "aria-hidden": true, children: "\u2302" }), url] })] }), _jsx("div", { className: "site-body", children: children })] }));
}
/** What the person asked, in their own words, as a speech bubble. */
export function Asked({ children }) {
    return (_jsxs("p", { className: "asked", children: [_jsx("span", { className: "asked-who", children: "you" }), children] }));
}
//# sourceMappingURL=scene.js.map