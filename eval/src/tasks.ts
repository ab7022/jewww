export interface Task {
  slug: string;
  url: string;
  /** What a user asked for. Context for labelling. */
  goal: string;
  /** The current subgoal — what ranking and the `target` question are told. */
  intent: string;
  kind: "form" | "nav" | "results";
  /** Link texts to click in order before capturing, to reach a form behind a board. */
  follow?: string[];
  /** Extra settle time for heavy SPAs. */
  settleMs?: number;
  /**
   * Ground truth for element selection: a case-insensitive substring that must match
   * exactly ONE element in the fixture. Stored as a substring rather than an eid
   * because eids shift on every re-capture while names do not.
   *
   * Set by hand via `pnpm eval:label`. Tasks without one are excluded from the
   * selection benchmark rather than guessed at.
   */
  target?: string;
}

/**
 * Twenty public, unauthenticated pages. Nothing here requires a login, so fixtures
 * are safe to commit.
 *
 * ATS postings expire, so board URLs are used with `follow` to walk to whatever job
 * is live today. When one dies, capture reports it and you swap the URL — the
 * benchmark itself replays fixtures offline and never touches the network.
 */
export const TASKS: Task[] = [
  // --- ATS application forms: the field-mapping benchmark --------------------
  { slug: "gh-board", url: "https://job-boards.greenhouse.io/anthropic", kind: "nav",
    goal: "apply to a job at this company", intent: "open the first engineering job posting" , target: "Engineering Manager, GPU"},
  { slug: "gh-form", url: "https://job-boards.greenhouse.io/anthropic", kind: "form",
    goal: "apply to this job with my resume", intent: "fill in the job application form",
    follow: ["Engineer"], settleMs: 1500 },
  { slug: "lever-board", url: "https://jobs.lever.co/matchgroup", kind: "nav",
    goal: "apply to a job at this company", intent: "open the first job posting" },
  { slug: "lever-form", url: "https://jobs.lever.co/matchgroup", kind: "form",
    goal: "apply to this job with my resume", intent: "fill in the job application form",
    follow: ["Engineer", "Apply"], settleMs: 1500 },
  { slug: "ashby-board", url: "https://jobs.ashbyhq.com/ramp", kind: "nav",
    goal: "apply to a job at this company", intent: "open the first listed open position",
    settleMs: 6000 , target: "AI Solutions Strategist"},
  { slug: "ashby-form", url: "https://jobs.ashbyhq.com/ramp", kind: "form",
    goal: "apply to this job with my resume", intent: "fill in the job application form",
    follow: ["Engineer", "Apply"], settleMs: 2000 },
  { slug: "gh-form2", url: "https://job-boards.greenhouse.io/discord", kind: "form",
    goal: "apply to this job with my resume", intent: "fill in the job application form",
    follow: ["Engineer"], settleMs: 1500 },
  { slug: "wp-contact-form", url: "https://www.w3schools.com/html/html_forms.asp", kind: "form",
    goal: "fill in the sample form", intent: "fill in the form fields" },

  // --- results / search: the hardest case for ranking ------------------------
  { slug: "hn", url: "https://news.ycombinator.com/", kind: "results",
    goal: "read the top story", intent: "open the highest ranked story" , target: "Qwen-Image-2.1"},
  { slug: "hn-jobs", url: "https://news.ycombinator.com/jobs", kind: "results",
    goal: "find a job posting", intent: "open the first job posting" , target: "Supabase (YC S20) Is Hiring for OrioleDB"},
  { slug: "wiki-search", url: "https://en.wikipedia.org/w/index.php?search=iphone+review", kind: "results",
    goal: "research iphone reviews", intent: "open the article about the iPhone 17 Pro" , target: "IPhone 17 Pro"},
  { slug: "npm-search", url: "https://www.npmjs.com/search?q=playwright", kind: "results",
    goal: "find the playwright package", intent: "open the top package result", settleMs: 3000 },
  // Third choice for this slot. GitHub search hits a secondary rate limit on
  // re-capture and PyPI serves a CAPTCHA to headless browsers — both unusable for a
  // fixture that gets re-captured. Gutenberg is server-rendered and scraper-tolerant.
  { slug: "book-search", url: "https://www.gutenberg.org/ebooks/search/?query=sherlock+holmes",
    kind: "results", goal: "read a Sherlock Holmes book",
    intent: "open the top search result", settleMs: 1500,
    target: "The Adventures of Sherlock Holmes" },

  // --- content / navigation -------------------------------------------------
  { slug: "wiki-article", url: "https://en.wikipedia.org/wiki/Web_accessibility", kind: "nav",
    goal: "check the references", intent: "jump to the references section" , target: "References"},
  { slug: "mdn-article", url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API", kind: "nav",
    goal: "see browser support", intent: "open the browser compatibility information" , target: "Browser compatibility"},
  { slug: "vercel-pricing", url: "https://vercel.com/pricing", kind: "nav",
    goal: "find the price of the pro plan", intent: "start a free trial of the Pro plan",
    settleMs: 1500 , target: "Start a free Pro trial"},
  { slug: "openrouter-models", url: "https://openrouter.ai/models", kind: "results",
    goal: "compare model prices", intent: "search the model list", settleMs: 2000 , target: "Search models"},

  // --- heavy SPA shells -----------------------------------------------------
  { slug: "npm-pkg", url: "https://www.npmjs.com/package/playwright", kind: "nav",
    goal: "check the install command", intent: "copy the install command", settleMs: 1500 , target: "Copy install command line"},
  { slug: "so-question", url: "https://stackoverflow.com/questions/tagged/playwright", kind: "results",
    goal: "find an answered question", intent: "open the first question in the list",
    settleMs: 3000 , target: "Is it a good practice to manage Tekton"},
  { slug: "gh-repo", url: "https://github.com/microsoft/playwright", kind: "nav",
    goal: "read the contributing guide", intent: "open the issues tab", settleMs: 1500 , target: "Issues 185"},
];
