import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from "../router.js";
import { useSession } from "../session.js";
export function Logo() {
    return (_jsxs(Link, { href: "/", className: "logo", "aria-label": "Jev home", children: [_jsxs("svg", { width: "22", height: "22", viewBox: "0 0 26 26", "aria-hidden": true, children: [_jsx("path", { d: "M4 2.5 L4 21 L9.2 16.4 L12.6 23.6 L15.9 22.1 L12.6 15 L19.6 15 Z", fill: "currentColor", stroke: "var(--bg)", strokeWidth: "1.6", strokeLinejoin: "round" }), _jsx("circle", { cx: "20.5", cy: "5.5", r: "2.6", fill: "#ff9f0a" })] }), "jev"] }));
}
export function Nav() {
    const session = useSession();
    return (_jsxs("nav", { className: "nav", children: [_jsx(Logo, {}), _jsxs("div", { className: "nav-links", children: [_jsx(Link, { href: "/#how", children: "How it works" }), _jsx(Link, { href: "/#uses", children: "Uses" }), _jsx(Link, { href: "/#pricing", children: "Pricing" }), _jsx(Link, { href: "/#faq", children: "FAQ" })] }), session.status === "signedIn" ? (_jsx(Link, { className: "btn small primary", href: "/dashboard", children: "Dashboard" })) : (_jsx(Link, { className: "btn small ghost", href: "/signin", children: "Sign in" }))] }));
}
//# sourceMappingURL=Nav.js.map