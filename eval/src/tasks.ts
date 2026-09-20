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
    goal: "apply to a job at this company", intent: "open the first engineering job posting" },
  { slug: "gh-form", url: "https://job-boards.greenhouse.io/anthropic", kind: "form",
    goal: "apply to this job with my resume", intent: "fill in the job application form",
    follow: ["Engineer"], settleMs: 1500 },
  { slug: "lever-board", url: "https://jobs.lever.co/matchgroup", kind: "nav",
    goal: "apply to a job at this company", intent: "open the first job posting" },
  { slug: "lever-form", url: "https://jobs.lever.co/matchgroup", kind: "form",
    goal: "apply to this job with my resume", intent: "fill in the job application form",
    follow: ["Engineer", "Apply"], settleMs: 1500 },
  { slug: "ashby-board", url: "https://jobs.ashbyhq.com/ramp", kind: "nav",
    goal: "apply to a job at this company", intent: "open the first engineering job posting" },
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
    goal: "read the top story", intent: "open the highest ranked story" },
  { slug: "hn-jobs", url: "https://news.ycombinator.com/jobs", kind: "results",
    goal: "find a job posting", intent: "open the first job posting" },
  { slug: "wiki-search", url: "https://en.wikipedia.org/w/index.php?search=iphone+review", kind: "results",
    goal: "research iphone reviews", intent: "open the most relevant article about the iPhone" },
  { slug: "mdn-search", url: "https://developer.mozilla.org/en-US/search?q=fetch", kind: "results",
    goal: "read the fetch docs", intent: "open the main documentation page for fetch" },
  { slug: "gh-search", url: "https://github.com/search?q=browser+agent&type=repositories", kind: "results",
    goal: "find a browser agent library", intent: "open the top repository result", settleMs: 1500 },

  // --- content / navigation -------------------------------------------------
  { slug: "wiki-article", url: "https://en.wikipedia.org/wiki/Web_accessibility", kind: "nav",
    goal: "check the references", intent: "jump to the references section" },
  { slug: "mdn-article", url: "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API", kind: "nav",
    goal: "see browser support", intent: "open the browser compatibility information" },
  { slug: "vercel-pricing", url: "https://vercel.com/pricing", kind: "nav",
    goal: "find the price of the pro plan", intent: "open the pricing details for the Pro plan",
    settleMs: 1500 },
  { slug: "openrouter-models", url: "https://openrouter.ai/models", kind: "results",
    goal: "compare model prices", intent: "search the model list", settleMs: 2000 },

  // --- heavy SPA shells -----------------------------------------------------
  { slug: "npm-pkg", url: "https://www.npmjs.com/package/playwright", kind: "nav",
    goal: "check the install command", intent: "copy the install command", settleMs: 1500 },
  { slug: "so-question", url: "https://stackoverflow.com/questions/tagged/playwright", kind: "results",
    goal: "find an answered question", intent: "open the first question in the list",
    settleMs: 1500 },
  { slug: "gh-repo", url: "https://github.com/microsoft/playwright", kind: "nav",
    goal: "read the contributing guide", intent: "open the issues tab", settleMs: 1500 },
];
