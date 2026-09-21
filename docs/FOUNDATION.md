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
2. Every endpoint has one zod schema in `packages/shared/src/api.ts`. The server
   `parse`s requests with it (unknown or missing fields are a 400, not a silent
   `undefined`); the client's types are `z.infer` of the same schema. Changing a shape
   breaks the build on both sides at once.

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

**Structural fix — every action reports what it observed.** After acting, the
executor compares the page before and after (content hash, URL, focused element,
the target's own state) and returns an `Effect`. The runtime feeds "no visible
effect" back to the model as a failure with a reason, on the very next step.

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

**Structural fix — every event carries `at` (monotonic, stamped by the runtime) and
`nodeId`, and events inside a loop carry `iteration`.** The timeline keys steps by
node *instance*, and durations are computed from runtime timestamps only.

### 7. Build/runtime skew

Vite re-hashes asset names on every build; a loaded unpacked extension keeps the
manifest it read at load time. Rebuilding under a loaded extension produced
"Could not load file 'assets/index.ts-loader-Bz0seLeD.js'".

**Structural fix.** Content-script entry names are stable (not hashed), and the
worker detects a manifest/build mismatch and says "reload the extension" rather than
failing on a tab.

---

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
| 2 Missing context | server-owned context + zod wire | `packages/shared/src/api.ts`, `apps/server/src/app.ts` |
| 3 Late refusal | live affordances, pre-flight, approval memory | `sense/collect.ts`, `runtime/run.ts` |
| 4 Silent success | `Effect` from every action | `shared/executor.ts`, both executors |
| 5 State schema | versioned zod panel state | `apps/extension/src/shared/state.ts` |
| 6 Event identity | `at` / `nodeId` / `iteration` on every event | `runtime/events.ts`, timeline |
| 7 Build skew | stable entry names + mismatch detection | `apps/extension/vite.config.ts` |
