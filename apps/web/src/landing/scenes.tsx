import { useRef, useState } from "react";
import { Asked, Site, useScene } from "./scene.js";

/**
 * The sites Jev visits on the landing page. Each is one real behaviour of the product,
 * acted out — not a feature card: it applies, it drafts but does not send when told
 * not to, it points instead of clicking when asked "where", and it will not type a
 * password however it is asked.
 */

export function JobsScene() {
  const root = useRef<HTMLDivElement>(null);
  const apply = useRef<HTMLButtonElement>(null);
  const nameEl = useRef<HTMLSpanElement>(null);
  const emailEl = useRef<HTMLSpanElement>(null);
  const submit = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [count, setCount] = useState(3);

  useScene(
    root,
    async (s) => {
      await s.moveTo(apply.current, "applying for you…");
      await s.click();
      setOpen(true);
      await s.wait(500);
      await s.moveTo(nameEl.current, "typing your name", "left");
      await s.type(setName, "Abdul Bayees");
      await s.moveTo(emailEl.current, "and your email", "left");
      await s.type(setEmail, "abdul@dolze.ai", 30);
      await s.moveTo(submit.current, "sending it");
      await s.click();
      setSent(true);
      setCount((c) => Math.min(10, c + 1));
      s.say("done. next one?");
    },
    () => {
      setOpen(false);
      setName("");
      setEmail("");
      setSent(false);
    },
  );

  return (
    <div className="scene" ref={root}>
      <Asked>apply to ten frontend roles with my resume</Asked>
      <Site url="careers.northwind.dev/jobs/frontend-engineer" tone="jobs">
        <div className="jobs">
          <aside className="jobs-list">
            <p className="jobs-count">
              <strong>{count}</strong> of 10 applied
            </p>
            {["Frontend Engineer", "UI Engineer", "Web Platform", "Design Engineer"].map((t, i) => (
              <div key={t} className={`jobs-item ${i === 0 ? "current" : ""}`}>
                <b>{t}</b>
                <span>{["Northwind", "Tessel", "Kiln", "Parallel"][i]} · remote</span>
              </div>
            ))}
          </aside>
          <article className="jobs-post">
            <p className="jobs-co">Northwind — Bengaluru or remote</p>
            <h3>Frontend Engineer</h3>
            <p className="jobs-desc">
              Build the interfaces people actually enjoy. React, TypeScript, and strong opinions about
              milliseconds.
            </p>
            <button type="button" className="jobs-apply" ref={apply} tabIndex={-1}>
              Easy Apply
            </button>
            <div className={`jobs-sheet ${open ? "on" : ""}`}>
              {sent ? (
                <p className="jobs-sent">
                  <span>✓</span> Application sent
                </p>
              ) : (
                <>
                  <label>
                    Full name
                    <span className="fx" ref={nameEl}>
                      {name}
                    </span>
                  </label>
                  <label>
                    Email
                    <span className="fx" ref={emailEl}>
                      {email}
                    </span>
                  </label>
                  <label>
                    Resume
                    <span className="fx file">abdul-bayees-resume.pdf</span>
                  </label>
                  <button type="button" className="jobs-submit" ref={submit} tabIndex={-1}>
                    Submit application
                  </button>
                </>
              )}
            </div>
          </article>
        </div>
      </Site>
    </div>
  );
}

export function MailScene() {
  const root = useRef<HTMLDivElement>(null);
  const reply = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const send = useRef<HTMLButtonElement>(null);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState("");

  useScene(
    root,
    async (s) => {
      await s.moveTo(reply.current, "replying");
      await s.click();
      setComposing(true);
      await s.wait(350);
      await s.moveTo(body.current, "writing it in your voice", "left");
      await s.type(setText, "Yes — Friday works. I'll send the build over by noon. — Abdul", 26);
      await s.moveTo(send.current, "");
      s.ring(send.current);
      s.say("drafted. not sending — you said don't.", "point");
      await s.wait(2600);
      s.ring(null);
    },
    () => {
      setComposing(false);
      setText("");
    },
  );

  return (
    <div className="scene" ref={root}>
      <Asked>draft a reply to priya saying friday works — don't send it</Asked>
      <Site url="mail.example.com/inbox/ship-date" tone="mail">
        <div className="mail">
          <nav className="mail-side">
            <span className="mail-compose">Compose</span>
            <span className="on">Inbox 12</span>
            <span>Starred</span>
            <span>Sent</span>
            <span>Drafts</span>
          </nav>
          <div className="mail-thread">
            <h3>Can we ship Friday?</h3>
            <div className="mail-msg">
              <span className="avatar">P</span>
              <div>
                <b>Priya Raman</b>
                <p>Hey — design signed off this morning. Can we get the build to QA by Friday?</p>
              </div>
            </div>
            {!composing ? (
              <button type="button" className="mail-reply" ref={reply} tabIndex={-1}>
                ↩ Reply
              </button>
            ) : (
              <div className="mail-box">
                <p className="mail-to">To: Priya Raman</p>
                <div className="mail-body" ref={body}>
                  {text}
                  <i className="caret" />
                </div>
                <button type="button" className="mail-send" ref={send} tabIndex={-1}>
                  Send
                </button>
              </div>
            )}
          </div>
        </div>
      </Site>
    </div>
  );
}

export function ConsoleScene() {
  const root = useRef<HTMLDivElement>(null);
  const deploys = useRef<HTMLSpanElement>(null);

  useScene(
    root,
    async (s) => {
      s.say("let me look…");
      await s.wait(700);
      await s.moveTo(deploys.current, "it's right here. your turn →", "left");
      s.ring(deploys.current);
      s.say("it's right here. your turn →", "point");
      await s.wait(3200);
      s.ring(null);
    },
    () => {},
  );

  return (
    <div className="scene" ref={root}>
      <Asked>where do i see the prod deploys?</Asked>
      <Site url="console.cloud.example/amplify/apps" tone="console">
        <div className="console">
          <nav className="console-side">
            <p className="console-app">dolze-webapp</p>
            <span>Overview</span>
            <span>Branches</span>
            <span ref={deploys}>Deployments</span>
            <span>Domains</span>
            <span>Environment</span>
            <span>Logs</span>
          </nav>
          <div className="console-main">
            <h3>All apps</h3>
            {[
              ["dolze-admin-panel-prod", "main", "9 days ago"],
              ["dolze-webapp-core-prod", "main", "2 days ago"],
              ["dolze-webapp-core-uat", "uat", "1 day ago"],
            ].map(([n, b, t]) => (
              <div key={n} className="console-row">
                <span className="ok" />
                <b>{n}</b>
                <span>{b}</span>
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </Site>
    </div>
  );
}

export function NeverScene() {
  const root = useRef<HTMLDivElement>(null);
  const user = useRef<HTMLSpanElement>(null);
  const pass = useRef<HTMLSpanElement>(null);
  const [email, setEmail] = useState("");

  useScene(
    root,
    async (s) => {
      await s.moveTo(user.current, "your email, sure", "left");
      await s.type(setEmail, "abdul@dolze.ai", 30);
      await s.moveTo(pass.current, "and the password…", "left");
      await s.wait(300);
      s.say("nope. passwords are yours.", "no");
      await s.shake();
      s.say("nope. passwords are yours.", "no");
      await s.wait(2200);
    },
    () => setEmail(""),
  );

  return (
    <div className="scene" ref={root}>
      <Asked>just log in for me</Asked>
      <Site url="bank.example.com/login" tone="bank">
        <div className="bank">
          <p className="bank-logo">▲ ledgerly</p>
          <h3>Sign in</h3>
          <label>
            Email
            <span className="fx" ref={user}>
              {email}
            </span>
          </label>
          <label>
            Password
            <span className="fx pw" ref={pass} />
          </label>
          <span className="bank-btn">Sign in</span>
        </div>
      </Site>
    </div>
  );
}

export function CheckoutScene({ onFree }: { onFree: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const pay = useRef<HTMLSpanElement>(null);

  useScene(
    root,
    async (s) => {
      await s.moveTo(pay.current, "");
      s.ring(pay.current);
      s.say("this bit's yours. i never pay.", "point");
      await s.wait(3000);
      s.ring(null);
    },
    () => {},
  );

  return (
    <div className="scene" ref={root}>
      <Site url="jev.app/checkout" tone="checkout">
        <div className="checkout">
          <div className="plans-list">
            <label className="plan-line picked">
              <span className="radio on" />
              <span>
                <b>Free</b>
                <small>500 credits on sign-up · about thirty tasks · everything included</small>
              </span>
              <strong>$0</strong>
            </label>
            <label className="plan-line">
              <span className="radio" />
              <span>
                <b>Pro</b> <em>soon</em>
                <small>20,000 credits a month · long multi-site tasks</small>
              </span>
              <strong>$20/mo</strong>
            </label>
            <label className="plan-line">
              <span className="radio" />
              <span>
                <b>Max</b> <em>soon</em>
                <small>120,000 credits a month · batch runs across many sites</small>
              </span>
              <strong>$100/mo</strong>
            </label>
          </div>
          <div className="receipt">
            <p>
              <span>Plan</span>
              <span>Free</span>
            </p>
            <p>
              <span>Credits</span>
              <span>500</span>
            </p>
            <p className="total">
              <span>Due today</span>
              <span>$0.00</span>
            </p>
            <button type="button" className="start-free" onClick={onFree}>
              Start free
            </button>
            <span className="pay" ref={pay}>
              Pay
            </span>
            <small className="fineprint">1 credit = a thousandth of a dollar of model usage. Paid plans open soon.</small>
          </div>
        </div>
      </Site>
    </div>
  );
}
