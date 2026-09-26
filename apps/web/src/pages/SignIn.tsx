import { useEffect, useState } from "react";
import { Logo } from "../components/Nav.js";
import { Link, navigate } from "../router.js";
import { authConfig, signInDev, signInWithGoogle, useSession } from "../session.js";

export function SignIn() {
  const session = useSession();
  const [config, setConfig] = useState<{ google: boolean; dev: boolean } | null>(null);
  const [email, setEmail] = useState("you@example.com");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void authConfig().then(setConfig);
    // Back from a sign-in that did not complete: the server says why in the fragment.
    const back = new URLSearchParams(location.hash.slice(1));
    if (back.get("error")) {
      setError(back.get("message") ?? "Sign-in didn't complete. Please try again.");
      history.replaceState(null, "", location.pathname + location.search);
    }
  }, []);
  useEffect(() => {
    if (session.status === "signedIn") navigate("/dashboard");
  }, [session.status]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Logo />
        <h1>Sign in to Jev</h1>
        <p className="muted">One account for the website and the extension. New accounts start with 500 credits.</p>

        {error && <p className="banner bad">{error}</p>}

        {config === null ? (
          <p className="muted">Checking what this server offers…</p>
        ) : (
          <>
            {config.google && (
              <button type="button" className="btn primary block" onClick={() => signInWithGoogle()}>
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
                  <path fill="#fff" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" />
                </svg>
                Continue with Google
              </button>
            )}

            {config.dev && (
              <form
                className="dev-signin"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError(null);
                  try {
                    await signInDev(email.trim());
                    navigate("/dashboard");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <p className="fine">
                  Google sign-in isn't configured on this server, so a development sign-in is available.
                  It is refused in production.
                </p>
                <label>
                  Email
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
                </label>
                <button className="btn primary block" type="submit" disabled={busy}>
                  {busy ? "Signing in…" : "Sign in for development"}
                </button>
              </form>
            )}

            {!config.google && !config.dev && (
              <p className="banner bad">Sign-in isn't available — the server may be starting up. Try again shortly.</p>
            )}
          </>
        )}
        <p className="fine legal-note">
          By continuing you agree to the <Link href="/terms">terms</Link> and <Link href="/privacy">privacy policy</Link>.
        </p>
      </div>
    </div>
  );
}
