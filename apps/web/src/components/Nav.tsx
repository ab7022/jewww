import { Link } from "../router.js";
import { useSession } from "../session.js";

export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="Jev home">
      <svg width="22" height="22" viewBox="0 0 26 26" aria-hidden>
        <path
          d="M4 2.5 L4 21 L9.2 16.4 L12.6 23.6 L15.9 22.1 L12.6 15 L19.6 15 Z"
          fill="currentColor"
          stroke="var(--bg)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="20.5" cy="5.5" r="2.6" fill="#ff9f0a" />
      </svg>
      jev
    </Link>
  );
}

export function Nav() {
  const session = useSession();
  return (
    <nav className="nav">
      <Logo />
      <div className="nav-links">
        <Link href="/#how">How it works</Link>
        <Link href="/#uses">Uses</Link>
        <Link href="/#pricing">Pricing</Link>
        <Link href="/#faq">FAQ</Link>
      </div>
      {session.status === "signedIn" ? (
        <Link className="btn small primary" href="/dashboard">
          Dashboard
        </Link>
      ) : (
        <Link className="btn small ghost" href="/signin">
          Sign in
        </Link>
      )}
    </nav>
  );
}
