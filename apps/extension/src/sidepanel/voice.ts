import { useCallback, useEffect, useRef, useState } from "react";
import { matchWake } from "./wake.js";

/**
 * Voice, using the browser's own speech recognition — the engine behind Chrome's
 * address-bar microphone. No key, and no audio reaches our server.
 *
 * One recogniser, three uses:
 *  - dictate: speech fills the box (the mic button);
 *  - talk-to-run: speech fills the box and, after a pause, runs it — what ⌥J then
 *    speaking does when "Listen when I open Jev" is on;
 *  - wake: waits for "Hey Jev", then takes what follows as the request. Opt-in, only
 *    while the panel is open, and always visibly on.
 *
 * Feature-detected: when the browser has no recogniser the hook says so and the UI
 * leaves the controls out rather than showing dead ones.
 */

interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
type RecognitionCtor = new () => Recognition;

const Ctor: RecognitionCtor | undefined =
  (globalThis as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
  (globalThis as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

/** How long a pause means "I've finished speaking" in talk-to-run. */
const END_OF_REQUEST_MS = 1400;

export type VoiceState = "off" | "dictating" | "wake" | "armed";

export interface Voice {
  supported: boolean;
  state: VoiceState;
  /** Words heard but not yet final, shown live. */
  interim: string;
  error: string | null;
  /**
   * The microphone has not been granted to Jev. A side panel cannot show Chrome's
   * permission prompt, so it is asked for on an extension page instead (`grantMic`).
   */
  needsMic: boolean;
  grantMic(): void;
  /** Mic button: start or stop dictation. `andRun` runs the request after a pause. */
  dictate(andRun?: boolean): void;
  stop(): void;
}

export function useVoice(opts: {
  /** A finished phrase to add to the box. */
  onPhrase: (phrase: string) => void;
  /** A complete spoken request to run now. */
  onCommand: (request: string) => void;
  /** Listen for "Hey Jev" whenever nothing else is using the microphone. */
  wake: boolean;
}): Voice {
  const [state, setState] = useState<VoiceState>("off");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsMic, setNeedsMic] = useState(false);

  const rec = useRef<Recognition | null>(null);
  const mode = useRef<VoiceState>("off");
  const runAfter = useRef(false);
  const heard = useRef("");
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Callbacks change identity every render; keeping them in refs means a session is
  // not torn down and restarted mid-sentence.
  const cb = useRef(opts);
  cb.current = opts;

  const setMode = (m: VoiceState) => {
    mode.current = m;
    setState(m);
  };

  const start = useCallback(async (m: VoiceState) => {
    if (!Ctor) return;
    // Starting recognition without a grant fails instantly in a side panel — Chrome
    // cannot prompt there. So look first, and say what to do instead of failing.
    if ((await micPermission()) !== "granted") {
      setNeedsMic(true);
      setMode("off");
      return;
    }
    setNeedsMic(false);
    rec.current?.abort();
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    heard.current = "";

    r.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const alt = e.results[i]?.[0];
        if (!alt) continue;
        if (!e.results[i]?.isFinal) {
          pending += alt.transcript;
          continue;
        }
        const text = alt.transcript.trim();
        if (!text) continue;
        onFinal(text);
      }
      setInterim(pending);
    };

    const onFinal = (text: string) => {
      if (mode.current === "wake") {
        const w = matchWake(text);
        if (!w.woke) return;
        if (w.rest) cb.current.onCommand(w.rest);
        else setMode("armed"); // the next sentence is the request
        return;
      }
      if (mode.current === "armed") {
        cb.current.onCommand(text.charAt(0).toUpperCase() + text.slice(1));
        setMode("wake");
        return;
      }
      // Dictating.
      cb.current.onPhrase(text);
      heard.current = heard.current ? `${heard.current} ${text}` : text;
      if (runAfter.current) {
        if (pause.current) clearTimeout(pause.current);
        pause.current = setTimeout(() => {
          const request = heard.current.trim();
          runAfter.current = false;
          r.stop();
          if (request) cb.current.onCommand(request);
        }, END_OF_REQUEST_MS);
      }
    };

    r.onerror = (e) => {
      // Ordinary ends to a session, not failures to show anyone.
      if (e.error === "aborted" || e.error === "no-speech") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setNeedsMic(true);
        setMode("off");
        return;
      }
      setError(
        e.error === "network"
            ? "Speech recognition could not reach its service. This Chrome build may not include it."
            : `Voice stopped: ${e.error}`,
      );
      if (e.error !== "network") setMode("off");
    };

    r.onend = () => {
      setInterim("");
      if (rec.current !== r) return;
      rec.current = null;
      // Chrome ends continuous sessions on its own (silence, a minute passing). Wake
      // mode is meant to be always on while enabled, so it resumes; dictation does not.
      if ((mode.current === "wake" || mode.current === "armed") && cb.current.wake) {
        setTimeout(() => {
          if (!rec.current && (mode.current === "wake" || mode.current === "armed")) void start("wake");
        }, 300);
        return;
      }
      setMode(cb.current.wake ? "wake" : "off");
      if (cb.current.wake) setTimeout(() => !rec.current && void start("wake"), 300);
    };

    try {
      r.start();
      rec.current = r;
      setMode(m);
      setError(null);
    } catch {
      setError("Could not start the microphone.");
      setMode("off");
    }
  }, []);

  const stop = useCallback(() => {
    runAfter.current = false;
    if (pause.current) clearTimeout(pause.current);
    setMode("off");
    rec.current?.abort();
    rec.current = null;
  }, []);

  // Wake mode follows the setting: on when enabled and the mic is free, off when not.
  useEffect(() => {
    if (!Ctor) return;
    if (opts.wake && mode.current === "off") void start("wake");
    if (!opts.wake && (mode.current === "wake" || mode.current === "armed")) stop();
  }, [opts.wake, start, stop]);

  useEffect(() => () => rec.current?.abort(), []);

  // Granted on the permission page: pick up where the person left off, without them
  // having to find the panel's button again.
  useEffect(() => {
    let status: PermissionStatus | undefined;
    void navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((s) => {
        status = s;
        s.onchange = () => {
          if (s.state !== "granted") return;
          setNeedsMic(false);
          setError(null);
          if (cb.current.wake && mode.current === "off") void start("wake");
        };
      })
      .catch(() => {});
    return () => {
      if (status) status.onchange = null;
    };
  }, [start]);

  const grantMic = useCallback(() => {
    void chrome.tabs.create({ url: chrome.runtime.getURL("src/mic/index.html") });
  }, []);

  const dictate = useCallback(
    (andRun = false) => {
      if (mode.current === "dictating") {
        stop();
        if (cb.current.wake) void start("wake");
        return;
      }
      runAfter.current = andRun;
      void start("dictating");
    },
    [start, stop],
  );

  return { supported: Boolean(Ctor), state, interim, error, needsMic, grantMic, dictate, stop };
}

/** "granted", "denied" or "prompt"; "prompt" where the Permissions API cannot say. */
async function micPermission(): Promise<PermissionState> {
  try {
    return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
  } catch {
    return "prompt";
  }
}
