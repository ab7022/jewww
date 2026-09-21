import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
/**
 * Three pages do not need a routing library. The server answers every non-API path
 * with index.html, so a reload on /dashboard lands back here.
 */
const listeners = new Set();
export function navigate(to) {
    if (to === location.pathname + location.hash)
        return;
    history.pushState(null, "", to);
    for (const l of listeners)
        l();
    if (!to.includes("#"))
        window.scrollTo({ top: 0 });
}
export function usePath() {
    const [path, setPath] = useState(location.pathname);
    useEffect(() => {
        const update = () => setPath(location.pathname);
        listeners.add(update);
        window.addEventListener("popstate", update);
        return () => {
            listeners.delete(update);
            window.removeEventListener("popstate", update);
        };
    }, []);
    return path;
}
/** An <a> that navigates in-page for local paths, and behaves normally otherwise. */
export function Link({ href = "/", onClick, ...rest }) {
    const local = href.startsWith("/") && !href.startsWith("/auth/");
    return (_jsx("a", { href: href, onClick: (e) => {
            onClick?.(e);
            if (!local || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                return;
            e.preventDefault();
            const [path, hash] = href.split("#");
            navigate(path || "/");
            if (hash)
                requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" }));
        }, ...rest }));
}
//# sourceMappingURL=router.js.map