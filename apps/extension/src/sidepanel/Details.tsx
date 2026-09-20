import { useEffect, useState } from "react";
import { PROFILE_FIELDS, type ProfileKey } from "@jev-browser/shared";
import type { ToWorker } from "../shared/messages.js";

const send = <T,>(msg: ToWorker): Promise<T> => chrome.runtime.sendMessage(msg) as Promise<T>;

/**
 * The details forms get filled from.
 *
 * Only the fields most forms actually ask for. The full key space in
 * packages/shared is much larger, and presenting thirty inputs to someone who wants
 * to fill in a waitlist form is a worse experience than presenting eight.
 */
const SHOWN: ProfileKey[] = [
  "fullName",
  "email",
  "phone",
  "city",
  "country",
  "currentCompany",
  "currentTitle",
  "linkedin",
];

const LABEL: Partial<Record<ProfileKey, string>> = {
  fullName: "Full name",
  email: "Email",
  phone: "Phone",
  city: "City",
  country: "Country",
  currentCompany: "Company",
  currentTitle: "Job title",
  linkedin: "LinkedIn",
};

export function Details({ onClose }: { onClose: () => void }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [instructions, setInstructions] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "saving" | "saved">("loading");

  useEffect(() => {
    void send<{ fields: Record<string, string>; instructions: string }>({
      kind: "getProfile",
    }).then((p) => {
      setFields(p?.fields ?? {});
      setInstructions(p?.instructions ?? "");
      setState("ready");
    });
  }, []);

  const save = async () => {
    setState("saving");
    const trimmed = Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v),
    );
    await send({ kind: "saveProfile", fields: trimmed, instructions: instructions.trim() });
    setState("saved");
    setTimeout(onClose, 500);
  };

  const filled = Object.values(fields).filter((v) => v?.trim()).length;

  return (
    <div className="details">
      <div className="details-head">
        <h2>Your details</h2>
        <button className="ghost small" onClick={onClose}>Close</button>
      </div>
      <p className="fine">
        Used to fill forms for you. Stored against your account, never on the pages you
        visit. Leave anything blank and it will ask when a form needs it.
      </p>

      {state === "loading" ? (
        <p className="fine">Loading…</p>
      ) : (
        <>
          <div className="fields">
            {SHOWN.map((key) => (
              <label key={key}>
                <span>{LABEL[key] ?? key}</span>
                <input
                  value={fields[key] ?? ""}
                  placeholder={PROFILE_FIELDS[key]}
                  onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <label className="standing">
            <span>Always do this</span>
            <textarea
              rows={5}
              value={instructions}
              placeholder={"Anything that should hold for every task.\n\nFor example: keep replies short and plain. Never submit a form without asking me first. Dates are day/month. Sign off as Abdul."}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </label>
          <p className="fine">
            Loaded on every run — when it plans, when it writes, and at every step.
          </p>

          <button className="primary block" onClick={() => void save()} disabled={state === "saving"}>
            {state === "saved" ? "Saved" : state === "saving" ? "Saving…" : `Save ${filled} details`}
          </button>
        </>
      )}
    </div>
  );
}
