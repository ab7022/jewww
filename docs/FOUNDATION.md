# Foundation audit — why we kept patching, and what stops it

Every bug fixed in the live-testing sessions of September 2026 is listed below and
traced to one of seven structural causes. The patches were each correct locally, but
each one fixed an *instance*. This document names the *classes*, and the structural
change that makes each class impossible (or at least caught by a test before a user
sees it).

The rule going forward: **a bug is not fixed until the class it belongs to has a
guard.** A guard is a type that makes it unrepresentable, a single source of truth
that removes the duplicate, or a test in the gauntlet that fails when it recurs.

---

## The seven classes

### 1. Two implementations of one contract, drifting

`Executor` has two implementations — `CdpExecutor` (Playwright) and `TabExecutor`
(extension). The interface describes the *signatures*; nothing described the
*behaviour*, so the implementations diverged exactly there.

| Symptom seen live | CDP did | Extension did |
|---|---|---|
| Google Forms "Blank form" never opened | real trusted mouse input | `el.click()` — no pointerdown/mousedown |
| New tab opened by a click was ignored | followed the new page | stayed bound to one `tabId` |
| Flights page navigated away from itself | `url()` was the live URL | `url()` returned `""` |
| Typing went to the wrong element | typed into the focused element | typed into `closest("[role]")` of the hit element |
| Resume upload unavailable | ATTACH offered | server never forwarded `attachable` |

**Structural fix — an executor conformance suite.** One set of behavioural
scenarios (fixture pages exercising each pattern: mousedown-only handlers,
`target=_blank`, read-only search-as-button, occluding modals, contenteditable
composers, React re-renders, smooth scroll, success dialogs after submit) run
against *both* executors in a real Chromium, the extension loaded unpacked. A
divergence is a red test, not a user report. → `eval/src/gauntlet/`

### 2. Components handed less than they need

The pattern: a function takes a hand-picked subset of the run's context as
positional arguments, a new piece of context is added upstream, and some consumer is
never updated.

- `compose` / `extract` never received the goal → "I don't have enough information".
- I then added `goal` to both, and forgot to forward it in the extension's `extract`.
- `decide` was called as `api.decide(runId, input.subgoal, input)` — the subgoal went
  into the `nodeId` slot.
- The extension never computed `autonomy`, so every run was "confirm", so "apply to 10
  jobs" stopped for approval on every Easy Apply.
- I changed `api.profile()` to return `{fields, instructions}` and the extension kept
  spreading it as the flat fields map — form filling saw keys named `fields`.

**Structural fix — the server owns run context, and the wire is typed.**
1. Everything the server can know about a run (goal, standing instructions, autonomy,
   the user's profile and resume) it loads from the run record itself. A client
   cannot forget to send what it is never asked to send.
2. Every request shape is one zod schema in `packages/shared/src/wire.ts`, and the
   `@jev-browser/protocol` package holds one endpoint table. The server registers its
   handlers from that table and `parse`s every body (a bad field is a 400 naming it);
   the extension, website and tests all call through one typed client generated from
   the same table. Changing a shape breaks the build on both sides at once.
3. Capabilities are bound to a run (`runtime/models.ts`): goal and instructions are
   supplied once, where the capabilities are built, never per call.

### 3. Refusing late instead of being unrepresentable

The decision model is offered options; the executor then refuses some of them. Every
late refusal is a wasted step and, worse, a loop — the model has no reason to prefer
anything else next time.

- read-only inputs offered as TYPE targets (AWS console search);
- covered elements offered as CLICK targets (AWS services menu);
- approvals requested for actions that then could not land (LinkedIn — approved five
  times, blocked five times).

**Structural fix — affordances are computed from live element state, before the
choice.** `fillable` means *can take text now*. A pre-flight hit test runs before an
approval is requested, so a person is never asked to approve something that cannot
happen. Approvals are remembered per (target, operation) within a node, so a retry
does not re-ask.

### 4. Silent success

`el.click()` returned `ok` and the page did nothing. The only signal was a later
"page unchanged for 3 steps". Any action whose effect is not observed will, sooner or
later, report success for nothing.

**Structural fix — "no visible effect" is detected and said in words.** The page
fingerprint (`contentHash`) now covers the full URL, every control's value and state,
and all visible text — it used to ignore values, so typing looked like nothing. The
runtime compares fingerprints across steps and tells the model, in plain words, that
its last action "had no visible effect on the page". The executors do not yet return
an explicit per-action effect; the fingerprint comparison is the mechanism.

### 5. Persisted state without a schema

`chrome.storage` survives extension updates. Renaming `log` to `steps` produced a
blank side panel on every existing install.

**Structural fix — versioned, parsed state.** Panel state is a zod schema with a
`version`. Reads go through `parse`; anything that does not match is migrated or
reset, never trusted. The preview harness renders a legacy state and fails on an
empty root.

### 6. Events without identity or time

Timeline steps are keyed by node id, but a `foreach` re-enters the same node ids, so
iteration 2 inherited iteration 1's `endedAt` → negative durations ("−26223ms").
Timestamps were taken when storage got round to the event, not when it happened.
`warn` events carried no node id, so they were attributed to "whatever looks current".

**Structural fix — the runtime stamps every event, in one place, with `at` and (inside
a loop) `iteration`; warnings carry `nodeId`.** The timeline keeps one step per node,
replaces it (rather than merging) when a loop re-enters it, shows which item it is on,
and computes durations from runtime timestamps only.

### 7. Build/runtime skew

Vite re-hashes asset names on every build; a loaded unpacked extension keeps the
manifest it read at load time. Rebuilding under a loaded extension produced
"Could not load file 'assets/index.ts-loader-Bz0seLeD.js'".

**Mitigation, not yet a structural fix.** The worker detects the mismatch and says
"the extension was rebuilt — reload it" instead of failing obscurely. Stable (unhashed)
content-script entry names would remove the skew entirely; not done yet.

### 8. State that does not survive how the code is loaded

The CDP driver evaluates the sense bundle before every call, and each evaluation made
a fresh copy of every module. The element registry had already been moved onto a
global to survive this — a per-case fix — but the cursor's position and the ink drawn
on the page had not: the cursor re-entered from the corner on every action, and a click
could not clear an explanation drawn one call earlier. The conformance gauntlet caught
it as drift (it passed in the extension, which loads once).

**Structural fix — the bundle installs once per document** (`if (!globalThis.__jevSense)`
around it). All module state now lives exactly as long as the page, in both executors.

### 9. One bad model answer ending a whole task

A structurally invalid answer (probabilities not summing to one, a choice that is not
the argmax) is refused, never coerced — correct. But the refusal propagated as a node
failure, so one unreadable response ended a run one keystroke from done.

**Structural fix — the scope of a refusal matches the scope of the fault.** `decide`
asks the same question again, at most three times, every attempt paid for; judgements
that have a safe default (field mapping, autonomy, mode) fall back to it per answer. An
answer is still never acted on unless it validates.

### 10. Configuration read in more than one place

The local server and the deployed function each reading the environment is how one of
them ends up accepting any extension or starting without a secret. A provider resolved
twice inside one `Promise.all` left a rejected promise with nobody listening.

**Structural fix — `apps/server/src/config.ts` reads it once, for every entry point, and
refuses unsafe production configurations** (no Google sign-in, no `EXTENSION_IDS`, a
short JWT secret, no Mongo URI). The deployed function answers 503 and logs the reason
rather than running open. Model providers are resolved once per request, before work.

### 12. A capability bound to the moment a node starts

The fill node's batch pass (map every field in one call, ask the user once, fill) ran
only on arrival. Anything a form revealed later — behind a button, on a wizard's next
page, in an expanding section — fell to the one-field-at-a-time loop, which cannot ask.

**Structural fix — a fill node is the step loop with the batch pass attached.** Every
time the page shows fillable fields the node has not seen, they get the batch pass, then
the loop carries on. One path instead of "batch, else fall back".

### 11. Money

Credits bought through Dodo Payments come only from our own pack table; only a payment
Dodo vouches for (a signed webhook, or one we fetched ourselves) counts; and a grant is
ONE atomic update of the user row guarded by the order id, so retried, duplicated or
concurrent deliveries credit exactly once and a late failure never undoes a success.
Eleven server tests hold these properties.

---

## What the gauntlet found on its first run

`pnpm gauntlet` runs 13 scenarios against both executors. Its first run passed 9/26,
and every failure was a real product bug rather than a test problem:

- **The extension could not run on any `http://` page.** Its content script's module
  was web-accessible to https pages only; intranet tools and local dev servers failed
  with "Receiving end does not exist". Both schemes are now opt-in origins.
- **Buttons were named after the paragraph above them.** A label heuristic meant for
  ATS inputs ran on every element, so LinkedIn's "Not now" was offered to the model as
  "Your application was sent to Quik Hire Staffing!" — the dismiss button did not
  exist under its own name. Content-named roles are now named by content.
- **Shadow DOM and same-origin iframes were invisible.** Every lookup and hit test was
  `document`-scoped. One set of reach primitives (`reachableRoots`, `deepQueryAll`,
  `topRect`, `deepElementFromPoint`, `composedContains`) is now used everywhere, and
  realm-sensitive code no longer relies on `instanceof`.

## Known gaps (tracked, not hidden)

- **Cross-origin iframes** — Stripe card fields, some embedded ATS boards. A top-frame
  script cannot reach into them; supporting them needs `all_frames` content scripts
  and frame-addressed messages. Card fields are refused anyway (FORBIDDEN_FIELD).
- **Closed shadow roots** — unreachable by design of the platform.
- **Canvas-drawn UIs** (Figma, Google Sheets' grid) — there is no DOM to act on.
- **`humanize` parses runtime strings** to word them for people. Stringly typed; a
  structured event payload would remove the coupling.

## What stays deliberately hard-coded

Exactly one thing: `FORBIDDEN_FIELD` — a password, card number, CVV, SSN, OTP or PIN
is never typed. It is enforced in `decide()`, the runtime loop, and the content script,
because it has to hold when the model is wrong or the page has manipulated it.
Everything else is a model judgement or a fact read from the page.

## Hard stops (correct outcomes, not failures)

Account creation, passwords, CAPTCHAs, payment entry, 2FA. The agent hands the browser
back with a sentence saying why. A run that stops at one of these is working.

## Status

| Class | Guard | Where |
|---|---|---|
| 1 Drift | conformance gauntlet, both executors | `eval/src/gauntlet/` |
| 2 Missing context | server-owned context, zod wire, one endpoint table, run-bound capabilities | `shared/wire.ts`, `protocol/`, `runtime/models.ts` |
| 3 Late refusal | live affordances, pre-flight, approval memory | `sense/collect.ts`, `runtime/run.ts` |
| 4 Silent success | fingerprint covers values/state/URL; "no visible effect" fed back | `sense/collect.ts`, `runtime/run.ts` |
| 5 State schema | versioned zod panel state | `apps/extension/src/shared/state.ts` |
| 6 Event identity | `at` / `nodeId` / `iteration` on every event | `runtime/events.ts`, timeline |
| 7 Build skew | mismatch detected and explained (mitigation) | `background/executor.ts` |
| 8 Load-time state | bundle installs once per document | `sense/bundle.ts` |
| 9 Refusal scope | bounded re-ask in `decide`; safe defaults elsewhere | `policy/decide.ts` |
| 10 Config | one reader, production refuses unsafe config | `server/config.ts` |
| 11 Money | pack table, verified payments, idempotent grant | `server/billing.ts` |
| 12 Late forms | batch pass on every newly revealed field | `runtime/run.ts` (`runFillNode`) |

## Evidence (last run)

| Gate | Result |
|---|---|
| Unit + integration (`pnpm verify`) | 198 / 198 |
| Conformance, both executors (`pnpm gauntlet`) | 34 / 34 — no drift |
| Guards in a real browser (`pnpm check:guards`) | 9 / 9 |
| Extension load checks | 14 / 14 |
| Field mapping on real ATS forms (`eval:fields`) | 98.3 % |
| **End to end through the server, real models (`pnpm gauntlet:agent`)** | 8 / 8, in two consecutive full runs |

The end-to-end cases are graded on what happened in the page (what was submitted,
sent, typed), never on what the agent says: apply to two jobs with saved details;
draft but do not send; send without asking when told to; never type a password even
when given one; point instead of click for "where"; read and answer; explain a bill by
drawing on it; create a Google-Forms-style form through a mousedown-only tile and a
welcome dialog. The job-application loop used to fail on one plan shape. The server's step log
showed why, deterministically: the form sat behind "Easy Apply", the fill node's batch
pass ran once on arrival and saw no fields, and the step loop then typed the fields
itself and stopped BLOCKED at "Why do you want to join?" — only the batch pass can ask
the user. Fixed as class 12 below.
