import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { Logo } from "../components/Nav.js";
import { navigate } from "../router.js";
import { authConfig, signInDev, signInWithGoogle, useSession } from "../session.js";
export function SignIn() {
    const session = useSession();
    const [config, setConfig] = useState(null);
    const [email, setEmail] = useState("you@example.com");
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        void authConfig().then(setConfig);
    }, []);
    useEffect(() => {
        if (session.status === "signedIn")
            navigate("/dashboard");
    }, [session.status]);
    return (_jsx("div", { className: "auth-page", children: _jsxs("div", { className: "auth-card", children: [_jsx(Logo, {}), _jsx("h1", { children: "Sign in to Jev" }), _jsx("p", { className: "muted", children: "One account for the website and the extension. New accounts start with 500 credits." }), error && _jsx("p", { className: "banner bad", children: error }), config === null ? (_jsx("p", { className: "muted", children: "Checking what this server offers\u2026" })) : (_jsxs(_Fragment, { children: [config.google && (_jsxs("button", { type: "button", className: "btn primary block", onClick: () => signInWithGoogle(), children: [_jsx("svg", { width: "18", height: "18", viewBox: "0 0 48 48", "aria-hidden": true, children: _jsx("path", { fill: "#fff", d: "M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" }) }), "Continue with Google"] })), config.dev && (_jsxs("form", { className: "dev-signin", onSubmit: async (e) => {
                                e.preventDefault();
                                setBusy(true);
                                setError(null);
                                try {
                                    await signInDev(email.trim());
                                    navigate("/dashboard");
                                }
                                catch (err) {
                                    setError(err instanceof Error ? err.message : String(err));
                                }
                                finally {
                                    setBusy(false);
                                }
                            }, children: [_jsx("p", { className: "fine", children: "Google sign-in isn't configured on this server, so a development sign-in is available. It is refused in production." }), _jsxs("label", { children: ["Email", _jsx("input", { value: email, onChange: (e) => setEmail(e.target.value), type: "email", required: true })] }), _jsx("button", { className: "btn primary block", type: "submit", disabled: busy, children: busy ? "Signing in…" : "Sign in for development" })] })), !config.google && !config.dev && (_jsx("p", { className: "banner bad", children: "Sign-in isn't available \u2014 the server may be starting up. Try again shortly." }))] }))] }) }));
}
//# sourceMappingURL=SignIn.js.map