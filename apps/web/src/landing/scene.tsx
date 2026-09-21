import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { Cancelled, type Script, take } from "./agent.js";

/**
 * Hand Jev the cursor while a scene is on screen, and loop its script there.
 * Scrolling a scene out of view does not stop it by itself — the next scene to arrive
 * takes the cursor, which cancels the previous script mid-step.
 */
export function useScene(ref: RefObject<HTMLElement | null>, script: (s: Script) => Promise<void>, reset: () => void) {
  const run = useRef(script);
  run.current = script;
  const clear = useRef(reset);
  clear.current = reset;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let playing = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || playing) return;
        playing = true;
        const s = take();
        void (async () => {
          try {
            for (;;) {
              clear.current();
              await s.wait(350);
              await run.current(s);
              await s.wait(2600);
            }
          } catch (err) {
            if (!(err instanceof Cancelled)) throw err;
          } finally {
            playing = false;
          }
        })();
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
}

/** A page Jev is visiting: its own address, its own look. */
export function Site({
  url, tone, children, id,
}: { url: string; tone: string; children: ReactNode; id?: string }) {
  return (
    <div className={`site-frame tone-${tone}`} id={id}>
      <div className="site-bar">
        <span className="site-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="site-url">
          <span className="lock" aria-hidden>
            ⌂
          </span>
          {url}
        </span>
      </div>
      <div className="site-body">{children}</div>
    </div>
  );
}

/** What the person asked, in their own words, as a speech bubble. */
export function Asked({ children }: { children: ReactNode }) {
  return (
    <p className="asked">
      <span className="asked-who">you</span>
      {children}
    </p>
  );
}
