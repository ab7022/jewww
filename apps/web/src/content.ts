import { PACKS, SIGNUP_CREDITS } from "@jev-browser/shared";

/**
 * Everything the site SAYS, defined once.
 *
 * The landing page renders it; the build turns the same data into /llms.txt,
 * /llms-full.txt, the Markdown twins of each page, the JSON-LD and the prerendered
 * HTML that crawlers read. Copy that lives only inside a component is invisible to a
 * language model and drifts from the Markdown the first time someone edits one.
 *
 * Every time figure below is an ASSUMPTION about a typical week, stated as one, and
 * the calculator shows them. A savings number with no visible working is just a claim.
 */

export const SITE = {
  name: "Jev",
  url: (import.meta.env?.VITE_SITE_URL as string | undefined) ?? "https://jev.app",
  tagline: "You say it. Jev clicks it.",
  description:
    "Jev is a browser assistant for Chrome with a cursor of its own. Tell it what you want done and it does it on the page in front of you — filling forms, moving data between tools, drafting replies — or ask where something is and it points, or ask what a page means and it draws the answer on it.",
  short: "A Chrome assistant that clicks, types, points and explains on the page you're on.",
} as const;

/** The work between the work: what a week of browser chores actually costs. */
export interface Pain {
  id: string;
  title: string;
  /** What it looks like on a Tuesday. */
  scene: string;
  /** Assumed minutes a week for one person who does this kind of work. */
  minutes: number;
  /** Assumed share of that time Jev takes over; the rest is you reviewing. */
  share: number;
  sites: string[];
}

export const PAINS: Pain[] = [
  {
    id: "copy",
    title: "Copying between tabs",
    scene: "Forty leads from a LinkedIn search, one at a time, into the CRM. Name, title, company, URL. Repeat.",
    minutes: 180,
    share: 0.85,
    sites: ["LinkedIn", "HubSpot", "Sheets"],
  },
  {
    id: "forms",
    title: "The same form, again",
    scene: "Vendor onboarding, expense claims, job applications — the same twelve details typed into a new layout.",
    minutes: 90,
    share: 0.75,
    sites: ["Workday", "Expensify", "Typeform"],
  },
  {
    id: "drafts",
    title: "First drafts of routine replies",
    scene: "The ticket that needs the order's tracking link, the email that needs last week's numbers.",
    minutes: 120,
    share: 0.6,
    sites: ["Gmail", "Zendesk", "Shopify"],
  },
  {
    id: "portals",
    title: "Downloading from six portals",
    scene: "Month end: log in to AWS, Vercel, Figma, Google Ads… find Billing, find Invoices, download, rename.",
    minutes: 60,
    share: 0.8,
    sites: ["AWS", "Vercel", "Figma"],
  },
  {
    id: "hunt",
    title: "Hunting for the setting",
    scene: "Where is the export button? Which menu has SSO? The admin console moved it again.",
    minutes: 45,
    share: 0.9,
    sites: ["Stripe", "Google Admin", "AWS"],
  },
  {
    id: "research",
    title: "Ten tabs before every call",
    scene: "Their site, their funding, the people on the invite, what they posted last week.",
    minutes: 90,
    share: 0.7,
    sites: ["LinkedIn", "Crunchbase", "News"],
  },
];

/** Working weeks in a year, for the annual figure. */
export const WEEKS_A_YEAR = 46;

export interface UseCase {
  /** What someone types, in their own words. */
  ask: string;
  /** What Jev does with it, as the side panel reads. */
  steps: string[];
  sites: string[];
  /** Assumed minutes by hand, and with Jev (including your review). */
  before: number;
  after: number;
  mode: "does it" | "drafts it" | "shows you" | "explains it";
}

export interface Team {
  id: string;
  name: string;
  line: string;
  cases: UseCase[];
}

export const TEAMS: Team[] = [
  {
    id: "recruiting",
    name: "Recruiting",
    line: "Less time in the ATS, more time with candidates.",
    cases: [
      {
        ask: "Move every applicant with 3+ years of React to Phone screen, and draft rejections for the rest — don't send.",
        steps: ["opened 38 applications", "moved 11 to Phone screen", "drafted 27 rejections", "held back Send — you said don't"],
        sites: ["Greenhouse"],
        before: 120,
        after: 8,
        mode: "drafts it",
      },
      {
        ask: "Add everyone from this LinkedIn search to our pipeline with their profile link.",
        steps: ["read 25 profiles", "created 25 prospects", "attached each profile URL"],
        sites: ["LinkedIn", "Lever"],
        before: 75,
        after: 5,
        mode: "does it",
      },
      {
        ask: "Book phone screens with the five shortlisted candidates next week.",
        steps: ["found five free slots", "created five invites", "asked you before sending"],
        sites: ["Google Calendar"],
        before: 40,
        after: 3,
        mode: "does it",
      },
    ],
  },
  {
    id: "sales",
    name: "Sales",
    line: "Keep the CRM true without becoming its typist.",
    cases: [
      {
        ask: "For these 50 leads, find company size and HQ on LinkedIn and update each HubSpot record.",
        steps: ["looked up 50 companies", "filled size and HQ", "queued 50 updates for one review"],
        sites: ["LinkedIn", "HubSpot"],
        before: 150,
        after: 10,
        mode: "does it",
      },
      {
        ask: "Brief me on Acme before my 3pm: recent news, funding, and who I'm meeting.",
        steps: ["read their site and news", "found the three attendees", "wrote a five-line brief"],
        sites: ["Crunchbase", "LinkedIn", "News"],
        before: 30,
        after: 2,
        mode: "does it",
      },
      {
        ask: "Log today's calls from my notes as activities in Salesforce.",
        steps: ["matched 7 notes to contacts", "logged 7 calls", "asked about one it couldn't match"],
        sites: ["Salesforce"],
        before: 35,
        after: 3,
        mode: "does it",
      },
    ],
  },
  {
    id: "support",
    name: "Support",
    line: "Answer the customer, not the admin panel.",
    cases: [
      {
        ask: "Find this customer's last three orders and put the tracking links in a reply — draft only.",
        steps: ["searched orders by email", "copied three tracking links", "drafted the reply, unsent"],
        sites: ["Shopify", "Zendesk"],
        before: 9,
        after: 1,
        mode: "drafts it",
      },
      {
        ask: "Tag the untriaged tickets by topic and assign anything about billing to Maya.",
        steps: ["read 31 tickets", "tagged 31", "assigned 9 to Maya"],
        sites: ["Zendesk"],
        before: 60,
        after: 4,
        mode: "does it",
      },
      {
        ask: "Where do I change a customer's plan in Stripe?",
        steps: ["opened Customers", "pointed at the subscription", "pointed at “Update plan”"],
        sites: ["Stripe"],
        before: 6,
        after: 1,
        mode: "shows you",
      },
    ],
  },
  {
    id: "finance",
    name: "Finance & ops",
    line: "Month end without the forty logins.",
    cases: [
      {
        ask: "Download last month's invoices from AWS, Vercel and Figma.",
        steps: ["went to each billing page", "downloaded three invoices", "stopped at one sign-in for you"],
        sites: ["AWS", "Vercel", "Figma"],
        before: 45,
        after: 4,
        mode: "does it",
      },
      {
        ask: "Walk me through this AWS bill — why is it higher than last month?",
        steps: ["read the bill", "circled the three biggest lines", "noted what changed"],
        sites: ["AWS Billing"],
        before: 25,
        after: 1,
        mode: "explains it",
      },
      {
        ask: "Enter these 22 receipts into Expensify with category and project.",
        steps: ["read 22 receipts", "filled 22 expenses", "left 2 unclear ones for you"],
        sites: ["Expensify"],
        before: 70,
        after: 6,
        mode: "does it",
      },
    ],
  },
  {
    id: "marketing",
    name: "Marketing",
    line: "Ship the campaign, skip the copy-paste.",
    cases: [
      {
        ask: "Put our three competitors' pricing into one comparison table.",
        steps: ["read three pricing pages", "matched plans by tier", "built the table"],
        sites: ["Competitor sites"],
        before: 60,
        after: 3,
        mode: "does it",
      },
      {
        ask: "Post this launch note to LinkedIn and X — show me each one before it goes.",
        steps: ["wrote both posts", "opened each composer", "waited for your OK on each"],
        sites: ["LinkedIn", "X"],
        before: 25,
        after: 3,
        mode: "does it",
      },
      {
        ask: "Add alt text to every image on our last ten blog posts in Webflow.",
        steps: ["opened ten posts", "described 43 images", "saved drafts, not published"],
        sites: ["Webflow"],
        before: 80,
        after: 7,
        mode: "drafts it",
      },
    ],
  },
  {
    id: "commerce",
    name: "E-commerce",
    line: "Run the store, not the spreadsheet.",
    cases: [
      {
        ask: "Update stock for these 60 SKUs from the supplier's sheet.",
        steps: ["read the sheet", "updated 60 inventory counts", "flagged 3 unknown SKUs"],
        sites: ["Google Sheets", "Shopify"],
        before: 90,
        after: 7,
        mode: "does it",
      },
      {
        ask: "Draft replies to this week's 1–3 star reviews.",
        steps: ["found 12 reviews", "drafted 12 replies in your tone", "held them for you"],
        sites: ["Google Business"],
        before: 40,
        after: 4,
        mode: "drafts it",
      },
      {
        ask: "What am I looking at on this payouts page?",
        steps: ["read the page", "circled the payout, the hold, the fee", "explained each in a line"],
        sites: ["Shopify Payments"],
        before: 10,
        after: 1,
        mode: "explains it",
      },
    ],
  },
];

export const FAQ: [string, string][] = [
  ["Does it see everything I browse?", "No. Jev only looks at a tab when you give it a task there, and only once you've allowed that site. It ships with access to nothing."],
  ["Is it always listening?", "No. Voice is off until you turn it on. “Hey Jev” only listens while the Jev panel is open, and says so the whole time. Speech recognition is Chrome's own."],
  ["What does it do before something I can't undo?", "If you told it to go ahead, it goes ahead. If you asked to review, it asks — once, and only when the step can actually happen. If you said not to finalise, it never does."],
  ["Can it explain a page instead of doing something?", "Yes. Ask “what am I looking at?” or “walk me through this bill” and Jev circles what matters on the page and numbers it with short notes. Press Esc to clear them."],
  ["What happens when a site needs me?", "Sign-ins, CAPTCHAs, payments and new accounts come straight back to you, with one sentence saying why. Do that part, then run the task again."],
  ["Which sites does it work on?", "Ordinary web pages, including ones built from web components and same-origin frames. Canvas-drawn apps, and card fields inside payment frames, it leaves to you."],
  ["What's a credit?", `A thousandth of a dollar of model usage. A ten-step task is usually ten to twenty. You start with ${SIGNUP_CREDITS} free, and packs never expire.`],
  ["How do I pay?", "Credit packs are one-time purchases through Dodo Payments, our merchant of record, which handles tax and receipts. No subscription; every order and its invoice is in your account."],
];

/** Never done, whatever the page or the model says. */
export const NEVER = [
  "type a password, one-time code or PIN",
  "enter card, bank or government ID numbers",
  "solve a CAPTCHA",
  "create an account",
  "pay for anything",
];

export { PACKS, SIGNUP_CREDITS };

/** Hours a week one person gets back, from the pains they chose. */
export function hoursSaved(chosen: string[]): number {
  return PAINS.filter((p) => chosen.includes(p.id)).reduce((h, p) => h + (p.minutes * p.share) / 60, 0);
}

export const caseSaving = (c: UseCase) => Math.round((1 - c.after / c.before) * 100);
