import { type ReactNode, useEffect, useRef, useState } from "react";
import { Agent, release, take } from "../landing/agent.js";
import { Count, HeroStage, Marquee } from "../landing/hero.js";
import "../landing/landing.css";
import { CheckoutScene, ConsoleScene, JobsScene, MailScene, NeverScene } from "../landing/scenes.js";
import { Link, navigate } from "../router.js";
import { useSession } from "../session.js";

/**
 * The landing page is a browser, and Jev is the one driving it.
 *
 * The tab strip is the navigation; the address bar takes requests ("show me the
 * pricing") and Jev's cursor goes and does them; each section is a different site the
 * cursor visits, doing one real thing the product does. Nothing here is a feature card.
 */

const TABS = [
  { id: "hello", title: "hello", url: "jev.app" },
  { id: "do", title: "jobs", url: "careers.northwind.dev" },
  { id: "draft", title: "inbox", url: "mail.example.com" },
  { id: "show", title: "console", url: "console.cloud.example" },
  { id: "never", title: "never", url: "bank.example.com" },
  { id: "talk", title: "talk", url: "jev.app/voice" },
  { id: "pricing", title: "checkout", url: "jev.app/checkout" },
  { id: "history", title: "history", url: "jev://history" },
] as const;

/** Address-bar requests the page understands. A demo of the idea, not the agent. */
const INTENTS: [RegExp, string][] = [
  [/pric|cost|pay|plan|free|checkout/i, "pricing"],
  [/job|apply|resume|career/i, "do"],
  [/mail|reply|email|draft|inbox/i, "draft"],
  [/where|show|find|point|console|deploy/i, "show"],
  [/pass|login|log in|safe|never|secret|card/i, "never"],
  [/talk|voice|hey|speak|listen|mic|shortcut|key/i, "talk"],
];

const EXAMPLES = [
  "show me the pricing",
  "apply to ten jobs for me",
  "draft a reply, don't send it",
  "where do i see prod deploys?",
  "log in for me",
];

/** tone, site, request, mode — each a thing someone would rather not do themselves. */
const WALL: [string, string, string, string][] = [
  ["jobs", "careers.northwind.dev", "apply to ten frontend roles with my resume", "do it"],
  ["mail", "mail.example.com", "reply to priya: friday works — don't send", "draft"],
  ["code", "code.example/pr/1842", "summarise this pull request in three bullets", "read"],
  ["flights", "flights.example/blr-del", "cheapest flight to delhi on the 22nd", "find"],
  ["shop", "shop.example/cart", "add these three to my cart, stop before paying", "do it"],
  ["console", "console.cloud.example", "is the prod app healthy?", "check"],
  ["form", "forms.example/new", "make a survey about sleep habits", "create"],
  ["bank", "bank.example/settings", "where do i download statements?", "show me"],
  ["cal", "calendar.example", "find thirty minutes with sam on friday", "find"],
  ["news", "news.example/story", "three bullets on this article", "read"],
  ["docs", "docs.example/new", "turn this thread into a page", "create"],
  ["tickets", "tickets.example/7pm", "two seats for the 7pm show", "do it"],
];

const HISTORY: [string, string, string][] = [
  ["9:41", "does it see everything i browse?", "No. Jev only looks at a tab when you give it a task there, and only once you've allowed that site. It ships with access to nothing."],
  ["9:38", "is it always listening?", "No. Voice is off until you turn it on. “Hey Jev” only listens while the Jev panel is open, and says so the whole time. Speech recognition is Chrome's own."],
  ["9:30", "what does it do before something i can't undo?", "If you told it to go ahead, it goes ahead. If you asked to review, it asks — once, and only when the step can actually happen. If you said not to finalise, it never does."],
  ["9:22", "what happens when a site needs me?", "Sign-ins, CAPTCHAs, payments and new accounts come straight back to you, with one sentence saying why. Do that part, then run the task again."],
  ["9:15", "which sites does it work on?", "Ordinary pages, including ones built from web components and same-origin frames. Canvas-drawn apps, and card fields inside payment frames, it leaves to you."],
  ["9:02", "what's a credit?", "A thousandth of a dollar of model usage. A ten-step task is usually ten to twenty. You start with 500."],
];

export function Landing() {
  const session = useSession();
  const next = session.status === "signedIn" ? "/dashboard" : "/signin";
  const [active, setActive] = useState<string>("hello");
  const [typed, setTyped] = useState("");
  const [focused, setFocused] = useState(false);
  const [example, setExample] = useState(0);
  const tabRefs = useRef<Record<string, HTMLAnchorElement | null>>({});

  // The active tab follows the section on screen.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const t of TABS) {
      const el = document.getElementById(t.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  // The empty address bar cycles through things you could ask.
  useEffect(() => {
    const t = setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 2800);
    return () => clearInterval(t);
  }, []);

  /** Jev goes to the tab, clicks it, and the page follows. */
  const go = async (id: string) => {
    const s = take();
    try {
      await s.moveTo(tabRefs.current[id] ?? null, "on it");
      await s.click();
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      await s.wait(900);
    } catch {
      // Someone else took the cursor — fine.
    } finally {
      release();
    }
  };

  const ask = (text: string) => {
    if (/sign|start|get|install|download|account/i.test(text)) return navigate(next);
    const hit = INTENTS.find(([re]) => re.test(text));
    void go(hit?.[1] ?? "history");
  };

  const url = TABS.find((t) => t.id === active)?.url ?? "jev.app";

  return (
    <div className="jl">
      <Agent />

      <header className="chrome">
        <div className="tabs">
          <span className="lights" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <nav className="tab-list" aria-label="Sections">
            {TABS.map((t) => (
              <a
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                href={`#${t.id}`}
                className={`tab ${active === t.id ? "on" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(t.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <span className={`fav fav-${t.id}`} aria-hidden />
                {t.title}
              </a>
            ))}
          </nav>
          <Link className="tab-cta" href={next}>
            {session.status === "signedIn" ? "your account" : "sign in"}
          </Link>
        </div>
        <form
          className="omni"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) ask(typed);
            setTyped("");
          }}
        >
          <span className="omni-spark" aria-hidden />
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={focused ? "ask jev something…" : ""}
            aria-label="Ask Jev"
          />
          {!typed && !focused && (
            <span className="omni-ghost" aria-hidden>
              <span className="omni-url">{url}</span>
              <span className="omni-try">try “{EXAMPLES[example]}”</span>
            </span>
          )}
          <kbd>↵</kbd>
        </form>
      </header>

      <main>
        <section id="hello" className="hello">
          <div className="hello-copy">
          <p className="tag reveal">a browser assistant with a cursor of its own</p>
          <h1>
            you say it.
            <br />
            <em>i</em> click it.
          </h1>
          <p className="hello-lede">
            jev lives in chrome. tell it what you want done and watch its cursor do it on the page in front of
            you — or ask where something is, and it'll point. try the bar up there; it works on this page too.
          </p>
          <div className="hello-cta">
            <Link className="ink-btn" href={next}>
              get jev — it's free
            </Link>
            <span className="hello-keys">
              then press <kbd>⌥</kbd>
              <kbd>J</kbd> anywhere
            </span>
          </div>
          </div>
          <HeroStage />
        </section>

        <Marquee />

        <Chapter id="do" log={[["0.0s", "opened the posting"], ["0.8s", "clicked “Easy Apply”"], ["1.9s", "typed your name and email"], ["2.6s", "attached resume.pdf"], ["3.4s", "submitted — 4 of 10 done"]]} n="01" title="it does the clicking." note="applications, forms, checkouts — the tedious middle of everything.">
          <JobsScene />
        </Chapter>

        <Chapter id="draft" log={[["0.0s", "read priya's message"], ["0.6s", "clicked “Reply”"], ["1.4s", "wrote it in your voice"], ["3.1s", "held back “Send”", "you said don't"]]} n="02" title="it listens to how you said it." note="“don't send it” means it doesn't. every run reads your words for how far it may go.">
          <MailScene />
        </Chapter>

        <Chapter id="show" log={[["0.0s", "read the console"], ["0.9s", "found “Deployments”"], ["1.1s", "pointed at it", "your turn"]]} n="03" title="or it just shows you." note="ask “where” or “how do i”, and it points instead of clicking. walk through any tool one step at a time.">
          <ConsoleScene />
        </Chapter>

        <Chapter id="never" log={[["0.0s", "typed your email"], ["0.7s", "reached “Password”"], ["0.7s", "refused", "passwords are yours"]]} n="04" title="some things stay yours." note="passwords, card numbers, one-time codes, CAPTCHAs, new accounts, payments. refused at the keystroke — even if the page, or the model, insists.">
          <NeverScene />
        </Chapter>

        <section className="proof">
          <p className="proof-head">measured, not promised — from this project's own test runs</p>
          <div className="proof-grid">
            <div className="stat">
              <strong>
                <Count to={13} />
                <span className="of">/13</span>
              </strong>
              <p>times it picked the right thing to click on real sites — GitHub, Hacker News, job boards</p>
            </div>
            <div className="stat">
              <strong>
                <Count to={98.3} decimals={1} suffix="%" />
              </strong>
              <p>of fields on five real job applications matched to the right detail, in one call per form</p>
            </div>
            <div className="stat">
              <strong>
                <Count to={30} />
                <span className="of">/30</span>
              </strong>
              <p>behaviour checks passed by both engines — shadow DOM, iframes, modals, re-renders, new tabs</p>
            </div>
            <div className="stat zero">
              <strong>0</strong>
              <p>passwords typed. the one rule that holds even when the model, or the page, is wrong</p>
            </div>
          </div>
        </section>

        <section id="talk" className="talk">
          <p className="chapter-n">05</p>
          <h2>
            press two keys.
            <br />
            or just say <em>“hey jev.”</em>
          </h2>
          <div className="talk-row">
            <div className="keys" aria-label="Option J">
              <span className="key">⌥</span>
              <span className="key">J</span>
            </div>
            <div className="wave" aria-hidden>
              {Array.from({ length: 22 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static decoration
                <i key={i} style={{ animationDelay: `${(i % 7) * 90}ms` }} />
              ))}
            </div>
            <p className="said">“hey jev, summarise this pull request”</p>
          </div>
          <p className="talk-note">
            ⌥J opens jev on the tab you're on. turn on “listen when i open jev” and you can just talk. “hey jev”
            works while the panel is open — off until you switch it on, and visibly on when it is.
          </p>
        </section>

        <section className="wall">
          <h2 className="wall-title">
            the tedious middle of <em>everything.</em>
          </h2>
          <div className="wall-grid">
            {WALL.map(([tone, url, task, kind]) => (
              <article key={url} className={`tile tone-${tone}`}>
                <div className="tile-bar">
                  <i />
                  {url}
                </div>
                <p className="tile-task">{task}</p>
                <span className={`tile-kind ${kind === "show me" ? "accent" : ""}`}>{kind}</span>
              </article>
            ))}
          </div>
        </section>

        <Chapter id="pricing" log={[["0.0s", "picked the plan"], ["0.4s", "reached “Pay”"], ["0.4s", "stopped", "you pay, never jev"]]} n="06" title={<>it gets you to checkout.<br />you pay.</>} note="start free. that's the whole plan, for now.">
          <CheckoutScene onFree={() => navigate(next)} />
        </Chapter>

        <section id="history" className="history">
          <p className="chapter-n">07</p>
          <h2>things people have asked.</h2>
          <div className="hist">
            <p className="hist-day">Today — jev://history</p>
            {HISTORY.map(([time, q, a]) => (
              <details key={q} className="hist-row">
                <summary>
                  <span className="hist-time">{time}</span>
                  <span className="fav fav-hello" aria-hidden />
                  <span className="hist-q">{q}</span>
                  <span className="hist-host">jev.app</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="bye">
          <h2>
            give it something <em>boring</em> to do.
          </h2>
          <Link className="ink-btn big" href={next}>
            get jev — it's free
          </Link>
        </section>
      </main>

      <footer className="status">
        <span>
          <span className="dot" /> jev.app — done
        </span>
        <span>© 2026 jev</span>
        <nav>
          <a href="#never">safety</a>
          <a href="#pricing">pricing</a>
          <a href="#history">questions</a>
          <Link href="/privacy">privacy</Link>
          <Link href="/terms">terms</Link>
          <Link href="/refunds">refunds</Link>
          <Link href="/signin">sign in</Link>
        </nav>
      </footer>
    </div>
  );
}

function Chapter({
  id, n, title, note, log, children,
}: { id: string; n: string; title: ReactNode; note: string; log: string[][]; children: ReactNode }) {
  return (
    <section id={id} className="chapter">
      <div className="chapter-head">
        <p className="chapter-n">{n}</p>
        <h2 className="reveal">{title}</h2>
        <p className="chapter-note reveal">{note}</p>
        {/* What Jev's own timeline said while it did this — the side panel, as it reads. */}
        <ol className="log">
          {log.map(([t, what, why]) => (
            <li key={`${t}-${what}`} className={why ? "held" : ""}>
              <span className="log-t">{t}</span>
              <span className="log-mark">{why ? "!" : "✓"}</span>
              <span className="log-what">
                {what}
                {why && <em>{why}</em>}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="chapter-stage">{children}</div>
    </section>
  );
}
