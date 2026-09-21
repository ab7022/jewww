import { useEffect, useRef, useState } from "react";

/**
 * The product, doing something: a scripted replay of a real task — applying to a job —
 * with the agent's cursor moving through a mock page while the side panel's timeline
 * advances beside it. Same cursor, label and ripple as the extension draws.
 *
 * Positions are measured from the real elements on every move, so it holds together at
 * any width. People who prefer reduced motion get the finished frame, not the loop.
 */

type Field = "name" | "email";
type Step = "pending" | "running" | "done";

interface Scene {
  cursor: { x: number; y: number; label: string; visible: boolean };
  ripple: number;
  form: boolean;
  sent: boolean;
  values: Record<Field, string>;
  focused: Field | null;
  steps: [Step, Step, Step];
  lines: string[];
  summary: boolean;
}

const START: Scene = {
  cursor: { x: 0, y: 0, label: "", visible: false },
  ripple: 0,
  form: false,
  sent: false,
  values: { name: "", email: "" },
  focused: null,
  steps: ["pending", "pending", "pending"],
  lines: [],
  summary: false,
};

const FINAL: Scene = {
  ...START,
  cursor: { x: 0, y: 0, label: "Clicking “Submit application”", visible: true },
  form: true,
  sent: true,
  values: { name: "Abdul Bayees", email: "abdul@dolze.ai" },
  steps: ["done", "done", "done"],
  lines: ["Opened the application", "Typed your name and email", "Submitted it"],
  summary: true,
};

const STEP_TITLES = ["Open the application", "Fill in your details", "Submit it"];

export function HeroDemo() {
  const stage = useRef<HTMLDivElement>(null);
  const targets = useRef<Record<string, HTMLElement | null>>({});
  const [scene, setScene] = useState<Scene>(START);
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduced) {
      setScene(FINAL);
      requestAnimationFrame(() => {
        // In the finished frame the form has been replaced by the confirmation.
        const at = pointOf("sent");
        if (at) setScene((s) => ({ ...s, cursor: { ...s.cursor, ...at } }));
      });
      return;
    }
    let alive = true;
    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => (alive ? resolve() : reject(new Error("stopped"))), ms);
        if (!alive) {
          clearTimeout(t);
          reject(new Error("stopped"));
        }
      });
    const set = (fn: (s: Scene) => Scene) => alive && setScene(fn);
    const moveTo = async (key: string, label: string) => {
      const at = pointOf(key);
      if (!at) return;
      set((s) => ({ ...s, cursor: { ...at, label, visible: true } }));
      await wait(620);
    };
    const type = async (field: Field, text: string) => {
      set((s) => ({ ...s, focused: field }));
      for (let i = 1; i <= text.length; i++) {
        set((s) => ({ ...s, values: { ...s.values, [field]: text.slice(0, i) } }));
        await wait(42);
      }
      set((s) => ({ ...s, focused: null }));
    };
    const click = () => set((s) => ({ ...s, ripple: s.ripple + 1 }));

    const loop = async () => {
      while (alive) {
        setScene(START);
        await wait(700);
        set((s) => ({ ...s, cursor: { ...s.cursor, ...bottomRight(), visible: true }, steps: ["running", "pending", "pending"] }));
        await wait(500);
        await moveTo("apply", "Clicking “Easy Apply”");
        click();
        await wait(260);
        set((s) => ({ ...s, form: true, steps: ["done", "running", "pending"], lines: ["Opened the application"] }));
        await wait(700);
        await moveTo("name", "Typing into “Full name”");
        await type("name", "Abdul Bayees");
        await moveTo("email", "Typing into “Email”");
        await type("email", "abdul@dolze.ai");
        set((s) => ({ ...s, steps: ["done", "done", "running"], lines: [...s.lines, "Typed your name and email"] }));
        await wait(300);
        await moveTo("submit", "Clicking “Submit application”");
        click();
        await wait(300);
        set((s) => ({ ...s, sent: true, steps: ["done", "done", "done"], lines: [...s.lines, "Submitted it"], summary: true }));
        await wait(3400);
      }
    };
    loop().catch(() => {});
    return () => {
      alive = false;
    };
  }, [reduced]);

  function pointOf(key: string): { x: number; y: number } | null {
    const el = targets.current[key];
    const box = stage.current?.getBoundingClientRect();
    if (!el || !box) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
  }
  function bottomRight() {
    const box = stage.current?.getBoundingClientRect();
    return { x: (box?.width ?? 600) * 0.55, y: (box?.height ?? 400) - 40 };
  }
  const ref = (key: string) => (el: HTMLElement | null) => {
    targets.current[key] = el;
  };

  return (
    <div className="demo" aria-label="Jev applying to a job, step by step" role="img">
      <div className="demo-chrome">
        <span className="lights" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="omnibox">jobs.northwind.example/frontend-engineer</span>
      </div>
      <div className="demo-body">
        <div className="demo-page" ref={stage}>
          <div className="posting">
            <p className="eyebrow">Northwind · Remote, India</p>
            <h3>Frontend Engineer</h3>
            <p className="muted">React, TypeScript, and a taste for fast interfaces. Two years or more.</p>
            <button type="button" className="fake-btn" ref={ref("apply")} tabIndex={-1}>
              Easy Apply
            </button>
          </div>

          <div className={`sheet ${scene.form ? "on" : ""}`}>
            {scene.sent ? (
              <div className="sent" ref={ref("sent")}>
                <span className="tick" aria-hidden>
                  ✓
                </span>
                Application sent
              </div>
            ) : (
              <>
                <h4>Apply to Northwind</h4>
                <label>
                  Full name
                  <span className={`fake-input ${scene.focused === "name" ? "focus" : ""}`} ref={ref("name")}>
                    {scene.values.name}
                    {scene.focused === "name" && <i className="caret" />}
                  </span>
                </label>
                <label>
                  Email
                  <span className={`fake-input ${scene.focused === "email" ? "focus" : ""}`} ref={ref("email")}>
                    {scene.values.email}
                    {scene.focused === "email" && <i className="caret" />}
                  </span>
                </label>
                <button type="button" className="fake-btn dark" ref={ref("submit")} tabIndex={-1}>
                  Submit application
                </button>
              </>
            )}
          </div>

          <div
            className={`agent ${scene.cursor.visible ? "on" : ""}`}
            style={{ transform: `translate(${scene.cursor.x}px, ${scene.cursor.y}px)` }}
            aria-hidden
          >
            <span key={scene.ripple} className={scene.ripple ? "ripple go" : "ripple"} />
            <svg width="26" height="26" viewBox="0 0 26 26" className="arrow">
              <path
                d="M4 2.5 L4 21 L9.2 16.4 L12.6 23.6 L15.9 22.1 L12.6 15 L19.6 15 Z"
                fill="#1c1c1e"
                stroke="#fff"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <circle cx="20.5" cy="5.5" r="2.6" fill="#ff9f0a" stroke="#fff" strokeWidth="1.2" />
            </svg>
            {scene.cursor.label && (
              <span className="pill">
                <b>Jev</b>
                {scene.cursor.label}
              </span>
            )}
          </div>
        </div>

        <aside className="demo-panel" aria-hidden>
          <div className="panel-goal">apply to this job with my details</div>
          <ol>
            {STEP_TITLES.map((title, i) => (
              <li key={title} className={scene.steps[i]}>
                <span className="mark">{scene.steps[i] === "done" ? "✓" : scene.steps[i] === "running" ? "●" : "○"}</span>
                <span>
                  {title}
                  {scene.lines[i] && <small>{scene.lines[i]}</small>}
                </span>
              </li>
            ))}
          </ol>
          {scene.summary && (
            <p className="panel-summary">
              <strong>Finished</strong> 6 steps · 4.1s
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
