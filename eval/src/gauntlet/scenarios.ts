import { type Executor, type RawElement, type RawSnapshot, UnreachableTarget } from "@jev-browser/shared";
import type { Session } from "./drivers.js";

/**
 * Executor conformance scenarios.
 *
 * Each one is a pattern that broke in real use (or is the same shape as one that did),
 * reproduced as a local page. They make no model calls: the choice of target is fixed,
 * so a failure here is the executor's, not the model's. Every scenario runs against
 * BOTH executors; the outcome is read from the page itself, not from what the executor
 * reports about itself — `ok: true` from a click that did nothing is the bug.
 */
export interface Scenario {
  name: string;
  page: string;
  /** Why this exists: the failure it reproduces. */
  why: string;
  run(s: Session, t: Tools): Promise<void>;
}

export interface Tools {
  find(role: string | null, name: string): Promise<RawElement>;
  missing(name: string): Promise<boolean>;
  click(el: RawElement): Promise<void>;
  type(el: RawElement, text: string, submit?: boolean): Promise<void>;
  select(el: RawElement, option: string): Promise<void>;
  snapshot(): Promise<RawSnapshot>;
  expect(cond: unknown, message: string): void;
}

export function tools(exec: Executor): Tools {
  const snapshot = () => exec.snapshot();
  const act = async (el: RawElement, action: Parameters<Executor["act"]>[0], text?: string) => {
    const guard = await exec.guardFor(el.node, el.fp);
    await exec.act(action, el.node, guard, text, el.fp);
    await exec.settle(el.node, el.role === "combobox");
  };
  return {
    snapshot,
    async find(role, name) {
      const s = await snapshot();
      const hit = s.elements.find((e) => e.name === name && (role === null || e.role === role));
      if (!hit) {
        const seen = s.elements.map((e) => `${e.role}:${e.name}`).slice(0, 25).join(" | ");
        throw new Error(`no ${role ?? "element"} named "${name}" in the snapshot (saw: ${seen})`);
      }
      return hit;
    },
    async missing(name) {
      const s = await snapshot();
      return !s.elements.some((e) => e.name === name);
    },
    click: (el) => act(el, { kind: "click", eid: el.eid }),
    type: (el, text, submit) =>
      act(el, { kind: "type", eid: el.eid, text, ...(submit ? { submit: true } : {}) }, text),
    select: (el, option) => act(el, { kind: "select", eid: el.eid, option }),
    expect(cond, message) {
      if (!cond) throw new Error(message);
    },
  };
}

const refuses = async (fn: () => Promise<void>, pattern: RegExp): Promise<string> => {
  try {
    await fn();
  } catch (err) {
    if (err instanceof UnreachableTarget && pattern.test(err.message)) return err.message;
    throw new Error(`refused for the wrong reason: ${String(err)}`);
  }
  throw new Error("was NOT refused");
};

export const SCENARIOS: Scenario[] = [
  {
    name: "mousedown-only tile responds to a click",
    page: "tile.html",
    why: "Google Forms' Blank form tile listens on mousedown; el.click() never reached it",
    async run(s, t) {
      await t.click(await t.find("button", "Blank form"));
      t.expect((await s.probe("document.body.dataset.outcome")) === "created", "the tile ignored the click");
    },
  },
  {
    name: "follows a tab the click opened",
    page: "newtab.html",
    why: "target=_blank opened the application in a new tab; the extension kept driving the old one",
    async run(s, t) {
      await t.click(await t.find("link", "Apply on company site"));
      const url = await s.exec.url();
      t.expect(url.endsWith("/newtab-target.html"), `still driving ${url}`);
      const snap = await t.snapshot();
      t.expect(snap.title === "Application form", `snapshot is of "${snap.title}"`);
    },
  },
  {
    name: "a read-only search box is clickable, not typeable",
    page: "readonly.html",
    why: "AWS' search is read-only until clicked; typing into it was offered, chosen, and refused",
    async run(s, t) {
      const box = await t.find(null, "Search");
      t.expect(box.fillable === false, "a read-only input was offered as a typing target");
      await t.click(box);
      await t.type(await t.find(null, "Search services"), "amplify");
      t.expect((await s.probe(`document.getElementById("real").value`)) === "amplify", "text did not land");
    },
  },
  {
    name: "a covered target is refused, named, and reachable once cleared",
    page: "covered.html",
    why: "LinkedIn's success dialog covered Easy Apply; five approvals, five blocked clicks",
    async run(s, t) {
      const apply = await t.find("button", "Easy Apply");
      const reason = await s.exec.preflight({ kind: "click", eid: apply.eid }, apply.node, apply.fp);
      t.expect(
        reason?.includes("dialog “Your application was sent”"),
        `preflight did not name the dialog: ${reason}`,
      );
      await refuses(() => t.click(apply), /covered by/);
      t.expect((await s.probe("document.body.dataset.outcome")) !== "applied", "a covered click went through");
      await t.click(await t.find("button", "Not now"));
      const cleared = await t.find("button", "Easy Apply");
      t.expect(
        (await s.exec.preflight({ kind: "click", eid: cleared.eid }, cleared.node, cleared.fp)) === null,
        "still refused after the dialog was dismissed",
      );
      await t.click(cleared);
      t.expect((await s.probe("document.body.dataset.outcome")) === "applied", "click did not land");
    },
  },
  {
    name: "types into inputs and a contenteditable body",
    page: "compose.html",
    why: "Gmail/X compose: the body has no .value; the native setter threw Illegal invocation",
    async run(s, t) {
      await t.type(await t.find(null, "To recipients"), "abdul@dolze.ai");
      await t.type(await t.find(null, "Subject"), "Hi");
      await t.type(await t.find(null, "Message Body"), "hi there");
      const got = (await s.probe(
        `[document.getElementById("to").value, document.getElementById("subject").value, document.getElementById("body").textContent]`,
      )) as string[];
      t.expect(
        JSON.stringify(got) === JSON.stringify(["abdul@dolze.ai", "Hi", "hi there"]),
        `got ${JSON.stringify(got)}`,
      );
      t.expect((await s.probe(`document.querySelector('[aria-label="Search mail"]').value`)) === "", "typed into the search box");
      // What the model is shown must match what is there: a contenteditable reported as
      // empty after typing made the model type the same message again and again.
      const body = await t.find(null, "Message Body");
      t.expect(body.value === "hi there", `the body is reported as "${body.value ?? ""}"`);
    },
  },
  {
    name: "never types a secret, however the field is dressed up",
    page: "credentials.html",
    why: "the one hard-coded rule: it must hold when the model is wrong or the page is hostile",
    async run(s, t) {
      await refuses(async () => t.type(await t.find(null, "Verification"), "123456"), /credential/);
      await refuses(async () => t.type(await t.find(null, "Card"), "4111111111111111"), /credential/);
      await refuses(async () => t.type(await t.find(null, "Your note"), "hunter2"), /credential/);
      const leaked = (await s.probe(`[pw.value, cc.value, inner.value].join("")`)) as string;
      t.expect(leaked === "", `a secret field received "${leaked}"`);
      await t.type(await t.find(null, "Nickname"), "ab");
      t.expect((await s.probe("ok.value")) === "ab", "an ordinary field was refused too");
    },
  },
  {
    name: "re-finds an input a re-render replaced",
    page: "rerender.html",
    why: "React replaces nodes; the held node id went stale and the step was lost",
    async run(s, t) {
      const city = await t.find(null, "City");
      await s.probe(`document.dispatchEvent(new Event("rerender"))`);
      await t.type(city, "Bengaluru");
      t.expect((await s.probe(`document.querySelector("input").value`)) === "Bengaluru", "value lost");
    },
  },
  {
    name: "reaches a field far below the fold under smooth scrolling",
    page: "longform.html",
    why: "scroll-behavior: smooth made scrollIntoView async; every field below the fold was 'unreachable'",
    async run(s, t) {
      await t.type(await t.find(null, "Question 28"), "yes");
      t.expect((await s.probe("q28.value")) === "yes", "field 28 not filled");
    },
  },
  {
    name: "typing and ticking change the page fingerprint",
    page: "multifield.html",
    why: "contentHash ignored values, so three fields typed in a row looked like three no-ops",
    async run(_s, t) {
      const h0 = (await t.snapshot()).contentHash;
      await t.type(await t.find(null, "First name"), "Abdul");
      const h1 = (await t.snapshot()).contentHash;
      t.expect(h1 !== h0, "typing did not change the fingerprint");
      await t.click(await t.find(null, "Newsletter"));
      const h2 = (await t.snapshot()).contentHash;
      t.expect(h2 !== h1, "ticking a checkbox did not change the fingerprint");
    },
  },
  {
    name: "a typed value is committed, as leaving the field would",
    page: "multifield.html",
    why: "the CDP driver fired only input; apps that save on change (Google Forms' title) never saw the value",
    async run(s, t) {
      await t.type(await t.find(null, "Email"), "abdul@dolze.ai");
      t.expect((await s.probe("document.body.dataset.committed")) === "abdul@dolze.ai", "the page never received a change");
    },
  },
  {
    name: "selects a native option; refuses a disabled button",
    page: "select.html",
    why: "a native select cannot be driven by clicks; a disabled control must be refused, not clicked",
    async run(s, t) {
      await t.select(await t.find(null, "Country"), "in");
      t.expect((await s.probe(`document.querySelector("select").value`)) === "in", "option not selected");
      const save = await t.find(null, "Save");
      const reason = await s.exec.preflight({ kind: "click", eid: save.eid }, save.node, save.fp);
      t.expect(/disabled/.test(reason ?? ""), `disabled button not refused: ${reason}`);
    },
  },
  {
    name: "finds a bare-div close button and clears the sheet",
    page: "bottomsheet.html",
    why: "BookMyShow's sheet closed only via a div with a JS listener — invisible to the collector",
    async run(s, t) {
      await t.click(await t.find(null, "Close"));
      await t.click(await t.find(null, "Movies"));
      t.expect((await s.probe("document.body.dataset.outcome")) === "movies", "click behind the sheet failed");
    },
  },
  {
    name: "sees and drives controls inside an open shadow root",
    page: "shadow.html",
    why: "web components hide controls from querySelectorAll; the agent could not see them at all",
    async run(s, t) {
      await t.type(await t.find(null, "Opportunity name"), "Acme renewal");
      await t.click(await t.find(null, "Save record"));
      t.expect((await s.probe("document.body.dataset.outcome")) === "saved", "shadow button not clicked");
    },
  },
  {
    name: "sees and drives controls inside a same-origin iframe",
    page: "iframe.html",
    why: "embedded ATS and checkout forms live in iframes the collector never entered",
    async run(s, t) {
      await t.type(await t.find(null, "Company"), "Dolze");
      await t.click(await t.find(null, "Continue"));
      t.expect((await s.probe("document.body.dataset.outcome")) === "submitted", "iframe button not clicked");
    },
  },
  {
    name: "the agent's cursor is drawn but never collected or in the way",
    page: "tile.html",
    why: "the trust surface must never become a target, block a hit test, or read as page content",
    async run(s, t) {
      const tile = await t.find("button", "Blank form");
      await t.click(tile);
      t.expect((await s.probe(`!!document.querySelector("jev-agent-overlay")`)) === true, "no cursor was drawn");
      const snap = await t.snapshot();
      t.expect(!snap.elements.some((e) => /Jev|Clicking/.test(e.name)), "the cursor's label was collected as page content");
      t.expect(!/Clicking/.test(snap.text), "the cursor's label leaked into the page text");
      const hit = (await s.probe(
        `(() => { const r = document.querySelector(".tile").getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.tagName; })()`,
      )) as string;
      t.expect(hit !== "JEV-AGENT-OVERLAY", "the overlay intercepts hit tests");
    },
  },
  {
    name: "show mode points at a target without touching it",
    page: "tile.html",
    why: "'where is Blank form?' wants a pointer; clicking it anyway does what nobody asked",
    async run(s, t) {
      const tile = await t.find("button", "Blank form");
      const refusal = await s.exec.point(tile.node, "Click \u201cBlank form\u201d", tile.fp);
      t.expect(refusal === null, `could not point: ${refusal}`);
      t.expect((await s.probe("document.body.dataset.outcome")) !== "created", "pointing clicked the tile");
    },
  },
];
