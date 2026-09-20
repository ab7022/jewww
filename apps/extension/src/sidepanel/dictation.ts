import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Dictation using the browser's own speech recognition — the same engine Chrome puts
 * behind the microphone in its address bar and on every `<input>`. No audio reaches
 * our server and no key is needed.
 *
 * It is deliberately feature-detected rather than assumed: `SpeechRecognition` is not
 * in every Chromium build, and the mic can be blocked by policy. When it is missing the
 * hook reports `supported: false` and the UI leaves the button out entirely, which is
 * better than a button that does nothing.
 */

// The API is prefixed in Chrome and untyped in lib.dom for the prefixed name.
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
type RecognitionCtor = new () => Recognition;

const Ctor: RecognitionCtor | undefined =
  (globalThis as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
  (globalThis as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

export interface Dictation {
  supported: boolean;
  listening: boolean;
  /** Words recognised but not yet finalised, for showing live under the box. */
  interim: string;
  error: string | null;
  toggle(): void;
}

/**
 * @param onText appends a finalised phrase. Called with the phrase only, so the caller
 *               decides where it lands — dictating mid-edit should not wipe typed text.
 */
export function useDictation(onText: (phrase: string) => void): Dictation {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<Recognition | null>(null);

  // `onText` changes identity on every render; keeping it in a ref means the
  // recognition session is not torn down and restarted mid-sentence.
  const sink = useRef(onText);
  sink.current = onText;

  useEffect(() => () => ref.current?.abort(), []);

  const toggle = useCallback(() => {
    if (!Ctor) return;
    if (ref.current) {
      ref.current.stop();
      return;
    }

    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const alt = e.results[i]?.[0];
        if (!alt) continue;
        if (e.results[i]?.isFinal) sink.current(alt.transcript.trim());
        else pending += alt.transcript;
      }
      setInterim(pending);
    };

    rec.onerror = (e) => {
      // "aborted" and "no-speech" are ordinary ends to a session, not failures worth
      // putting in front of someone.
      if (e.error === "aborted" || e.error === "no-speech") return;
      setError(
        e.error === "not-allowed"
          ? "Microphone access was blocked. Allow it for this extension to dictate."
          : `Dictation stopped: ${e.error}`,
      );
    };

    rec.onend = () => {
      ref.current = null;
      setListening(false);
      setInterim("");
    };

    try {
      rec.start();
      ref.current = rec;
      setError(null);
      setListening(true);
    } catch {
      setError("Could not start the microphone.");
    }
  }, []);

  return { supported: Boolean(Ctor), listening, interim, error, toggle };
}
