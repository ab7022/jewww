import { HeroDemo } from "../components/HeroDemo.js";
import { Nav } from "../components/Nav.js";
import { Link } from "../router.js";

const USES = [
  { title: "Apply to jobs", ask: "Apply to ten frontend roles with my resume, don't submit until I check", tag: "Forms" },
  { title: "Draft and reply", ask: "Draft a reply to this thread saying we'll ship Friday", tag: "Writing" },
  { title: "Check a dashboard", ask: "Open Amplify and tell me if the prod app is healthy", tag: "Ops" },
  { title: "Summarise anything", ask: "Summarise this pull request in three bullets", tag: "Reading" },
  { title: "Find it for you", ask: "Find flights to Delhi on the 22nd under ₹6,000", tag: "Search" },
  { title: "Fill the boring parts", ask: "Fill this form with my details, I'll submit", tag: "Forms" },
  { title: "Compare across sites", ask: "Compare this laptop's price on three stores", tag: "Research" },
  { title: "Learn a tool", ask: "Where do I turn on two-factor here?", tag: "Show me" },
];

const NEVER = [
  ["Types a password, card number, CVV, OTP or PIN", "Refused at the keystroke, even if the page or the model insists."],
  ["Solves a CAPTCHA", "It stops and hands the browser back to you."],
  ["Creates an account for you", "Signing up is yours to do."],
  ["Enters payment details", "It gets you to checkout. You pay."],
  ["Finalises anything you said not to", "“Don't submit” holds for the whole task — no setting overrides it."],
];

const FAQ = [
  [
    "Does it see everything I browse?",
    "No. Jev only looks at a tab when you give it a task there, and only after you've allowed that site. It ships with access to nothing.",
  ],
  [
    "Is it always listening?",
    "No. Voice is off until you turn it on. “Hey Jev” only listens while the Jev panel is open, and the panel shows it the whole time. Speech recognition is Chrome's own.",
  ],
  [
    "What does it do before something I can't undo?",
    "If you told it to go ahead, it goes ahead. If you asked to review, it asks — once, before the step, and only when the step can actually happen. If you said not to finalise, it never does.",
  ],
  [
    "What happens when a site needs me?",
    "Sign-ins, CAPTCHAs, payments and new accounts are handed back to you with one sentence saying why. Once you've done that part, run the task again.",
  ],
  [
    "Which sites does it work on?",
    "Ordinary web pages — including ones built with web components and same-origin frames. Pages drawn on a canvas, and card fields inside payment frames, it leaves to you.",
  ],
  [
    "What's a credit?",
    "A thousandth of a dollar of model usage. A typical ten-step task costs ten to twenty. You start with 500.",
  ],
];

export function Landing() {
  return (
    <div className="site">
      <Nav />

      <header className="hero">
        <p className="kicker">An assistant for Chrome</p>
        <h1>
          Ask for it.
          <br />
          Watch it happen.
        </h1>
        <p className="lede">
          Tell Jev what you want done and watch its cursor do it on the page in front of you — apply, fill,
          draft, check, compare. Or ask where something is, and it points.
        </p>
        <div className="cta-row">
          <Link className="btn primary" href="/signin">
            Get started — it's free
          </Link>
          <Link className="btn ghost" href="/#how">
            How it works
          </Link>
        </div>
        <HeroDemo />
      </header>

      <section id="how" className="band">
        <div className="section-head">
          <p className="kicker">Two ways to use it</p>
          <h2>Have it done. Or be shown.</h2>
        </div>
        <div className="two">
          <article className="card big">
            <span className="chip">Do it</span>
            <h3>“Draft a reply saying we'll ship Friday.”</h3>
            <p>
              Jev plans the task, then works through it where you can see it: the cursor glides to each thing
              before it clicks or types, and says what it's doing.
            </p>
          </article>
          <article className="card big">
            <span className="chip accent">Show me</span>
            <h3>“Where do I turn on two-factor?”</h3>
            <p>
              Same understanding, different ending. Jev finds the setting, points at it and outlines it —
              then waits for you to click. Walk through a whole tool one step at a time.
            </p>
          </article>
        </div>
      </section>

      <section className="band">
        <div className="section-head">
          <p className="kicker">Start it however you like</p>
          <h2>Press a key. Or just say it.</h2>
        </div>
        <div className="starts">
          <div className="start">
            <kbd>⌥ J</kbd>
            <h4>Open Jev</h4>
            <p>The panel opens on the tab you're on, ready to type.</p>
          </div>
          <div className="start">
            <kbd>⌥ J</kbd>
            <span className="then">then talk</span>
            <h4>Say what you want</h4>
            <p>Turn on “Listen when I open Jev”. Speak, pause — it runs.</p>
          </div>
          <div className="start">
            <kbd>“Hey Jev”</kbd>
            <h4>Hands-free</h4>
            <p>While the panel is open, say the words and the request. Off until you turn it on.</p>
          </div>
        </div>
      </section>

      <section id="uses" className="band">
        <div className="section-head">
          <p className="kicker">What people ask it</p>
          <h2>Thousands of small jobs you'd rather not do.</h2>
        </div>
        <div className="uses">
          {USES.map((u) => (
            <article key={u.title} className="use">
              <span className={`chip ${u.tag === "Show me" ? "accent" : ""}`}>{u.tag}</span>
              <h4>{u.title}</h4>
              <p>“{u.ask}”</p>
            </article>
          ))}
        </div>
      </section>

      <section id="trust" className="band">
        <div className="section-head">
          <p className="kicker">Safety</p>
          <h2>What it will never do.</h2>
          <p className="sub">
            One rule is built so deep it holds even when everything above it is wrong: no secret is ever typed.
            The rest follows your words, not the page's.
          </p>
        </div>
        <ul className="never">
          {NEVER.map(([what, why]) => (
            <li key={what}>
              <span className="x" aria-hidden>
                ✕
              </span>
              <div>
                <strong>{what}</strong>
                <p>{why}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section id="pricing" className="band">
        <div className="section-head">
          <p className="kicker">Pricing</p>
          <h2>Start free. Pay for what it does.</h2>
        </div>
        <div className="plans">
          <article className="plan">
            <h3>Free</h3>
            <p className="price">
              $0<span>forever</span>
            </p>
            <ul>
              <li>500 credits when you sign up</li>
              <li>About thirty everyday tasks</li>
              <li>Voice, show-me mode, everything</li>
            </ul>
            <Link className="btn primary block" href="/signin">
              Get started
            </Link>
          </article>
          <article className="plan featured">
            <h3>Pro</h3>
            <p className="price">
              $20<span>/ month</span>
            </p>
            <ul>
              <li>20,000 credits a month</li>
              <li>Long multi-site tasks</li>
              <li>Priority model capacity</li>
            </ul>
            <span className="btn ghost block disabled" aria-disabled="true">
              Coming soon
            </span>
          </article>
          <article className="plan">
            <h3>Max</h3>
            <p className="price">
              $100<span>/ month</span>
            </p>
            <ul>
              <li>120,000 credits a month</li>
              <li>Batch runs across many sites</li>
              <li>Early features</li>
            </ul>
            <span className="btn ghost block disabled" aria-disabled="true">
              Coming soon
            </span>
          </article>
        </div>
        <p className="fine center">1 credit is a thousandth of a dollar of model usage. Paid plans open soon.</p>
      </section>

      <section id="faq" className="band narrow">
        <div className="section-head">
          <p className="kicker">Questions</p>
          <h2>The honest answers.</h2>
        </div>
        {FAQ.map(([q, a]) => (
          <details key={q} className="faq">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </section>

      <section className="closing">
        <h2>Give it something to do.</h2>
        <Link className="btn primary" href="/signin">
          Get started — it's free
        </Link>
      </section>

      <footer className="foot">
        <span>© 2026 Jev</span>
        <nav>
          <Link href="/#trust">Safety</Link>
          <Link href="/#pricing">Pricing</Link>
          <Link href="/#faq">FAQ</Link>
          <Link href="/signin">Sign in</Link>
        </nav>
      </footer>
    </div>
  );
}
