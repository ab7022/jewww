import { useEffect, useRef, useState } from "react";
import { Cancelled, take } from "./agent.js";

/**
 * The hero's stage: five small sites floating in layered depth, and Jev darting between
 * them doing one thing on each. Everything here moves on its own clock — the windows
 * drift, the arrows draw themselves, the chips float — so the stage is never still,
 * but nothing competes with the cursor, which is the one thing that moves with intent.
 */

const TASKS = [
  { key: "jobs", say: "applying — 4 of 10" },
  { key: "mail", say: "drafting, not sending" },
  { key: "flights", say: "₹5,480 — cheapest on the 22nd" },
  { key: "console", say: "prod is healthy ✓" },
  { key: "form", say: "filled 9 of 9 fields" },
] as const;

export function HeroStage() {
  const stage = useRef<HTMLDivElement>(null);
  const targets = useRef<Record<string, HTMLElement | null>>({});
  const [lit, setLit] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let running = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || running) return;
        running = true;
        const s = take();
        void (async () => {
          try {
            await s.wait(900);
            for (let i = 0; ; i = (i + 1) % TASKS.length) {
              const t = TASKS[i];
              if (!t) continue;
              setLit(t.key);
              await s.moveTo(targets.current[t.key] ?? null, t.say);
              await s.click();
              setProgress((p) => p + 1);
              await s.wait(1300);
            }
          } catch (err) {
            if (!(err instanceof Cancelled)) throw err;
          } finally {
            running = false;
            setLit(null);
          }
        })();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const ref = (key: string) => (el: HTMLElement | null) => {
    targets.current[key] = el;
  };

  return (
    <div className="stage" ref={stage} aria-hidden>
      <svg className="doodles" viewBox="0 0 600 560" fill="none">
        <path className="draw d1" d="M70 90 C 150 30, 250 40, 300 110" />
        <path className="draw d1" d="M285 92 L300 110 L276 112" />
        <path className="draw d2" d="M520 330 C 560 400, 520 470, 430 480" />
        <path className="draw d3" d="M40 420 q 30 -30 60 0 t 60 0 t 60 0" />
        <circle className="draw d4" cx="470" cy="80" r="30" />
      </svg>

      <div className={`mini w-jobs ${lit === "jobs" ? "lit" : ""}`}>
        <MiniBar url="careers.northwind.dev" tone="#1c6b47" />
        <div className="mini-body">
          <p className="m-eyebrow">Northwind · remote</p>
          <p className="m-title">Frontend Engineer</p>
          <span className="m-btn green" ref={ref("jobs")}>
            Easy Apply
          </span>
          <div className="m-meter">
            <i style={{ width: `${Math.min(100, 40 + (progress % 7) * 10)}%` }} />
          </div>
        </div>
      </div>

      <div className={`mini w-mail ${lit === "mail" ? "lit" : ""}`}>
        <MiniBar url="mail.example.com" tone="#d4452a" />
        <div className="mini-body">
          <p className="m-title sm">Re: Can we ship Friday?</p>
          <p className="m-line" />
          <p className="m-line short" />
          <span className="m-btn red ghosted" ref={ref("mail")}>
            Send
          </span>
        </div>
      </div>

      <div className={`mini w-flights ${lit === "flights" ? "lit" : ""}`}>
        <MiniBar url="flights.example/blr-del" tone="#2d6a6a" />
        <div className="mini-body">
          {[
            ["06:10", "₹6,210"],
            ["09:45", "₹5,480"],
            ["18:30", "₹7,050"],
          ].map(([t, p]) => (
            <div key={t} className={`m-flight ${p === "₹5,480" ? "best" : ""}`} ref={p === "₹5,480" ? ref("flights") : undefined}>
              <b>{t}</b>
              <span>BLR → DEL</span>
              <em>{p}</em>
            </div>
          ))}
        </div>
      </div>

      <div className={`mini w-console dark ${lit === "console" ? "lit" : ""}`}>
        <MiniBar url="console.cloud.example" tone="#b8f06a" dark />
        <div className="mini-body">
          {["admin-panel-prod", "webapp-core-prod"].map((n, i) => (
            <div key={n} className="m-row" ref={i === 1 ? ref("console") : undefined}>
              <i />
              {n}
            </div>
          ))}
        </div>
      </div>

      <div className={`mini w-form ${lit === "form" ? "lit" : ""}`}>
        <MiniBar url="forms.example/survey" tone="#6b4bb8" />
        <div className="mini-body">
          {["Name", "Email", "Role"].map((f, i) => (
            <div key={f} className="m-field" ref={i === 2 ? ref("form") : undefined}>
              <span>{f}</span>
              <i style={{ width: `${[62, 78, 44][i]}%` }} />
            </div>
          ))}
        </div>
      </div>

      <span className="chip c1">
        <i className="fav fav-do" /> 10 applications
      </span>
      <span className="chip c2">
        <i className="fav fav-hello" /> ⌥ J
      </span>
      <span className="chip c3">
        <i className="fav fav-never" /> never types passwords
      </span>
      <span className="spark s1" />
      <span className="spark s2" />
      <span className="spark s3" />
    </div>
  );
}

function MiniBar({ url, tone, dark }: { url: string; tone: string; dark?: boolean }) {
  return (
    <div className={`mini-bar ${dark ? "dark" : ""}`}>
      <span className="mini-fav" style={{ background: tone }} />
      <span className="mini-url">{url}</span>
    </div>
  );
}

const WORDS_A = [
  ["do", "apply to ten frontend roles"],
  ["draft", "draft a reply, don't send it"],
  ["hello", "summarise this pull request"],
  ["show", "where are the prod deploys?"],
  ["pricing", "find flights under ₹6,000"],
  ["do", "fill this form with my details"],
];
const WORDS_B = [
  ["draft", "reply to priya: friday works"],
  ["show", "how do i turn on two-factor?"],
  ["hello", "compare this laptop on three sites"],
  ["do", "add these three to my cart"],
  ["never", "stop before paying"],
  ["talk", "hey jev, check the build"],
];

/** Two rows of real requests, sliding in opposite directions. */
export function Marquee() {
  return (
    <div className="marquee" aria-hidden>
      {[WORDS_A, WORDS_B].map((row, r) => (
        <div key={r} className={`mq-row ${r ? "rev" : ""}`}>
          {[...row, ...row, ...row].map(([fav, text], i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: repeated decoration
            <span key={i} className="mq-chip">
              <i className={`fav fav-${fav}`} />
              {text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A number that counts up when it scrolls into view. */
export function Count({ to, suffix = "", decimals = 0 }: { to: number; suffix?: string; decimals?: number }) {
  const el = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / 1400);
        setV(to * (1 - (1 - t) ** 4));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(node);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to]);
  return (
    <span ref={el}>
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}
