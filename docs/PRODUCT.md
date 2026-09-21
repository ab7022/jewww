# Jev — product spec

**One line:** an assistant that lives in your browser. Say what you want; it does it
on the page in front of you, with a visible cursor, and stops for you only where you
asked it to — or where it must.

## Who it is for

| Person | Job to be done | Why a browser agent, not an API |
|---|---|---|
| Job seeker | "Apply to 10 relevant jobs with my resume" | Every ATS is a different form; none has an API they can use |
| Operator / founder | "Is our prod Amplify app healthy?", "Refund order 1182" | Admin consoles are the only interface they have |
| Knowledge worker | "Draft a reply", "Turn this thread into a Notion page" | The tools are web apps behind their own login |
| Non-technical user | "Where do I turn on two-factor here?" | They need to be *shown*, not told |
| Researcher / shopper | "Compare this laptop on three sites" | Multi-site, repetitive, tedious |

## Two modes

Borrowed deliberately from heyclicky, which gets this right:

- **Do it** — the agent acts. The cursor moves, clicks and types; the side panel
  keeps the timeline.
- **Show me** — the agent *points*. It finds the same target it would have clicked,
  glides the cursor there, labels it ("this is the Export button"), and waits. Nothing
  on the page is changed. This is how people learn a tool, and it is nearly free to
  build: the decision is identical, only the last step differs.

The mode is read from the request ("how do I…", "where is…", "show me…" → show;
anything imperative → do), and can be forced from the panel.

## How you start it

| Way | What happens | Why |
|---|---|---|
| **⌥J** (Alt+J) | Opens the side panel on this tab, cursor in the box | Chrome only opens a side panel from a user gesture; a keyboard command counts |
| **Hold ⌥Space**, talk, release | Push-to-talk: a listening pill appears on the page, speech becomes the request, it runs on release | Fastest path; nothing is heard until you press |
| Mic button in the panel | Dictation into the box | Same engine, for when the panel is already open |
| **"Hey Jev"** (opt-in) | The listening pill appears; your next sentence is the request | Hands-free, but see the trade-offs below |
| Toolbar icon | Opens the panel | Discoverability |

### About "Hi Jev"

It is buildable, with three honest constraints, and it ships **off by default**:

1. **A wake word cannot open the side panel.** `chrome.sidePanel.open()` requires a
   user gesture, and a voice is not one. So "Hey Jev" opens the *on-page* listening
   pill instead — which is where the cursor is anyway.
2. **Continuous listening means the microphone is open.** Chrome's built-in speech
   recognition streams audio to Google's recogniser while it runs. Heyclicky's answer
   is to never listen without a hotkey, and that is the right default. Wake word is
   an explicit opt-in in Settings, with the page showing a small mic indicator the
   whole time it is on, and it pauses when the tab is hidden.
3. **It needs a visible page.** It runs in the active tab's content script and stops
   on tab switch; it cannot listen from the background.

## The cursor

A second, clearly-not-yours cursor drawn above the page (shadow DOM, pointer-events
none, so it can never intercept a real click):

- glides from its last position to the target along an eased curve, ~350 ms;
- a label bubble says what it is about to do in plain words — "Clicking **Easy
  Apply**", "Typing your email";
- a ripple on click, a soft caret shimmer while typing;
- in **Show me** mode it stops and pulses, with the explanation in the bubble;
- when it is blocked, the bubble says so ("A dialog is in the way — closing it");
- honours `prefers-reduced-motion` (jumps instead of glides).

The cursor is the trust surface. People forgive a slow agent they can watch; they do
not forgive one that clicks things they did not see.

## Use-case catalogue

Tiers: **A** works today end to end · **B** works with known limits · **C** hard stop
by design · **D** not yet.

### 1. Read and answer (one page)
| Request | Plan shape | Tier |
|---|---|---|
| Summarise this page / PR / article | read → compose | A |
| What does the top plan cost? | read | A |
| Pull this table into CSV | read (schema) | A |
| Explain this error message | read → compose | A |
| Translate this page's key points | read → compose | A |

### 2. Find and navigate
| Request | Plan shape | Tier |
|---|---|---|
| Open Amplify and check prod status | act (nav) → read | A |
| Where is the export button? *(show me)* | act in show mode | A |
| Find the refund policy | act → read | A |
| Open my latest invoice | act | B — needs the list to be in view |

### 3. Fill forms
| Request | Plan shape | Tier |
|---|---|---|
| Fill this form with my details, don't submit | fill (autonomy: never) | A |
| Fill and submit the contact form | fill → act | A |
| Answer this survey honestly as me | fill + text | B — free-text quality |
| Update my shipping address | fill | A |
| Create an account here | — | **C** — never creates accounts |

### 4. Compose and communicate
| Request | Plan shape | Tier |
|---|---|---|
| Draft an email to X saying Y (don't send) | act → compose → fill | A |
| Reply to this Slack thread | compose → act (contenteditable) | A |
| Post this on X / LinkedIn | compose → act → confirm | A — confirm unless told otherwise |
| Comment on this PR | read → compose → act | A |

### 5. Create in web apps
| Request | Plan shape | Tier |
|---|---|---|
| Create a Google Form about sleep habits | compose → act → fill… | B — long editor flows |
| Make a Trello card / Jira ticket from this | read → compose → act | B |
| Start a Notion page from this thread | read → compose → act | B |

### 6. Transactional (stops before money)
| Request | Plan shape | Tier |
|---|---|---|
| Find flights BLR→DEL on the 22nd under ₹6k | act → read | A |
| Book two tickets for the 7pm show | act → … → payment | **C** at payment |
| Add these three items to my cart | foreach act | A |

### 7. Batch and multi-site
| Request | Plan shape | Tier |
|---|---|---|
| Apply to 10 engineering jobs with my resume | read → foreach(fill, attach, act) | B — many ATS need accounts (C) |
| Compare this laptop on 3 sites | foreach(nav, read) → compose | A |
| Collect contact emails for these 20 companies | foreach(nav, read) | B |

### 8. Ops consoles (risky by nature)
| Request | Plan shape | Tier |
|---|---|---|
| Check prod status in Amplify / Vercel | nav → read | A |
| Redeploy the prod branch | act → confirm | A — always confirms (`Sends/changes`) |
| Merge this PR | act → confirm | A — confirms unless told |

### 9. Guide ("show me")
| Request | Tier |
|---|---|
| How do I enable 2FA on this site? | A |
| Walk me through creating a pivot table | B — multi-step guide, one pointer at a time |

### Never (tier C, by design)
Typing a password, card number, CVV, SSN, OTP or PIN · creating accounts · solving a
CAPTCHA · entering payment details · 2FA. The agent hands over with one sentence
saying why, and resumes when told.

## Authority: who decides when it stops

Read from the user's own words, never from the page:

- *"…but don't submit"*, *"let me review"* → **never** finalise; queue for review.
- *"…and send it"*, *"apply"*, *"post it"* → **full**: do it.
- silent on the question → **confirm** only for irreversible actions (send, pay,
  delete, publish, submit).

Standing instructions in **Details → Always do this** apply to every run and can set
a default ("never submit anything without asking me").

## The website

- **Landing** — hero with the product doing something (animated cursor over a mock
  page), two modes, how to start (⌥J, hold ⌥Space), use cases, safety ("what it will
  never do"), pricing, FAQ, install CTA.
- **Sign in** — Google (and a dev sign-in when Google is not configured). Same
  accounts and credits as the extension.
- **Dashboard** — credits and usage, run history, standing instructions, saved
  details, install / connect the extension, sign out.
- **Pricing** — Free (credits on sign-up), Pro, Max. Stripe is additive later; the
  credit ledger already exists.

## Success metrics

- **Task success rate** on the gauntlet, per executor — the number that must never
  regress.
- **Interventions per run** — approvals + hand-offs + questions. Lower is better *only*
  when the user did not ask to review.
- **Wasted steps** — steps whose action was refused or had no effect. Target: < 5%.
- **Time to first action** — plan latency; target < 3 s.
- **Cost per successful task** — credits.
