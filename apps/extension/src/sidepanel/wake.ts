/**
 * Recognising "Hey Jev" in a speech transcript.
 *
 * Speech recognisers do not know the word "Jev". They hear the nearest real word —
 * "Jeff", "Jeb", "chef", "Jove" — so the match is on how it SOUNDS, with a greeting in
 * front ("hey", "hi", "okay") so that someone merely saying "Jeff" in conversation does
 * not wake it. Pure and synchronous, so it is tested without a microphone.
 */

// Not "a": recognisers occasionally hear "hey" as "a", but "a chef recommended it" waking
// the agent is worse than the rare mishearing it would catch.
const GREETING = String.raw`(?:hey|hi|hello|hay|okay|ok)`;
// What recognisers actually produce for "Jev": the real word nearest in sound.
const NAME = String.raw`(?:jev|jeff|jef|jeb|jev's|jeve|chev|chef|jove|jav|jevv|jab|jed|jen)`;
const WAKE = new RegExp(String.raw`(?:^|[\s,.!?])${GREETING}[\s,.!?-]+${NAME}(?=$|[\s,.!?])[\s,.!?-]*`, "i");

export interface Wake {
  /** The phrase was heard. */
  woke: boolean;
  /** Whatever was said after it in the same breath — often the whole request. */
  rest: string;
}

export function matchWake(transcript: string): Wake {
  const m = WAKE.exec(transcript);
  if (!m) return { woke: false, rest: "" };
  const rest = transcript.slice(m.index + m[0].length).trim();
  return { woke: true, rest: tidy(rest) };
}

/** Recognisers capitalise oddly and trail filler; a request should read like one. */
function tidy(s: string): string {
  const t = s.replace(/^(?:please|can you|could you|would you)[\s,]+/i, "").trim();
  return t ? t[0]?.toUpperCase() + t.slice(1) : "";
}
