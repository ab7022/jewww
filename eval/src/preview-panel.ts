/**
 * Render the side panel with mock state and screenshot it.
 *
 * The panel can only be seen inside Chrome's side panel in a real session, which is
 * a slow loop for design work — and a design nobody has looked at is a design nobody
 * has checked.
 *
 *   pnpm preview:panel
 */
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dist = join(root, "apps/extension/dist");
const out = join(root, ".data/panel");
mkdirSync(out, { recursive: true });

const RUNNING = {
  signedIn: true,
  email: "dev@localhost",
  credits: 491,
  running: true,
  status: "running",
  steps: [
    { id: "n1", kind: "act", title: "Open BookMyShow for India", status: "done",
      startedAt: 0, endedAt: 2100,
      actions: [{ kind: "navigate", text: "Opened in.bookmyshow.com" }] },
    { id: "n2", kind: "act", title: "Set the city to Bengaluru", status: "done",
      startedAt: 0, endedAt: 1400,
      actions: [
        { kind: "act", text: "Clicked “Detect my location”" },
        { kind: "act", text: "Clicked “Bengaluru”" },
      ] },
    { id: "n3", kind: "fill", title: "Search for the Mirzapur movie", status: "running",
      startedAt: 0,
      actions: [
        { kind: "act", text: "Clicked “Search for movies, events…”" },
        { kind: "type", text: "Typed “Mirzapur” into “Search”" },
        { kind: "problem", text: "Something was covering it — looking again" },
      ] },
    { id: "n4", kind: "act", title: "Open the Mirzapur listing", status: "pending", actions: [] },
    { id: "n5", kind: "act", title: "Select tomorrow's showtimes", status: "pending", actions: [] },
  ],
};

const WAITING = {
  ...RUNNING,
  steps: [
    ...RUNNING.steps.slice(0, 2),
    { id: "n3", kind: "act", title: "Submit the application", status: "waiting",
      startedAt: 0,
      actions: [
        { kind: "note", text: "Filled 9 of 20 fields, left 5 for you" },
        { kind: "act", text: "Attached test-resume.pdf" },
      ],
      prompt: { preview: "Click “Submit application”", risk: "message", reason: "confirm" } },
    { id: "n4", kind: "act", title: "Confirm the submission", status: "pending", actions: [] },
  ],
};

const FINISHED = {
  signedIn: true, email: "dev@localhost", credits: 486, running: false, status: "done",
  steps: [
    { id: "n1", kind: "read", title: "Read the pull request and its diff", status: "done",
      startedAt: 0, endedAt: 4200,
      actions: [{ kind: "note", text: "Read 18,204 characters from the page" }] },
    { id: "n2", kind: "compose", title: "Write a concise summary of the change", status: "done",
      startedAt: 0, endedAt: 7400, actions: [] },
  ],
  result:
    "Migrates Perplexity from the retired Sonar Chat Completions endpoint to the Agent API.\n\n" +
    "• Adds a schema `name` that the Agent API requires and langchain-perplexity omits\n" +
    "• Routes to /v1/agent only when the payload carries a built-in tool\n" +
    "• Cuts research cost roughly 64% on the measured workload",
  summary: { steps: 2, credits: 4.1, seconds: 11.6 },
  queued: [{ preview: "Click “Submit application”", risk: "message" }],
};

const EMPTY = { signedIn: true, email: "dev@localhost", credits: 500, running: false, steps: [] };

/**
 * The shape an older build persisted: `log`, no `steps`. chrome.storage survives an
 * update, so this is what the panel actually received after the redesign shipped —
 * and `state.steps.map` threw, leaving a completely blank side panel.
 */
const LEGACY = {
  signedIn: true, email: "dev@localhost", credits: 497, running: false,
  log: ["goal: summarise this page", "read  Read the page"], status: "done",
};

// Served over HTTP, not file://: the built page references /assets/… absolutely,
// which under file:// resolves to the filesystem root and renders nothing.
const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
};
const server = createServer((req, res) => {
  const path = join(dist, decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/"));
  if (!existsSync(path) || statSync(path).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  const ext = path.slice(path.lastIndexOf("."));
  res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream" });
  createReadStream(path).pipe(res);
});
await new Promise<void>((r) => server.listen(0, r));
const port = (server.address() as { port: number }).port;

/**
 * A finished run with earlier ones behind it. History and Reset only appear once a
 * run has happened, so without this fixture neither is ever rendered in a preview.
 */
const WITH_HISTORY = {
  ...FINISHED,
  history: [
    { id: "h1", goal: "Draft an email to abdul@dolze.ai saying hi", status: "done", steps: 11, credits: 5.1, seconds: 14, at: Date.now() - 9 * 60_000 },
    { id: "h2", goal: "Create a dummy form and ask the user about sleeping habits", status: "blocked", steps: 6, credits: 2.1, seconds: 9, at: Date.now() - 3 * 3600_000 },
    { id: "h3", goal: "Summarise this page", status: "done", steps: 4, credits: 1.2, seconds: 6, at: Date.now() - 2 * 86_400_000 },
  ],
};

const browser = await chromium.launch();
for (const [name, state, scheme] of [
  ["empty", EMPTY, "dark"],
  ["running", RUNNING, "dark"],
  ["waiting", WAITING, "dark"],
  ["finished", FINISHED, "dark"],
  ["finished-light", FINISHED, "light"],
  ["legacy-state", LEGACY, "dark"],
  ["history", WITH_HISTORY, "dark"],
] as const) {
  const page = await browser.newPage({
    viewport: { width: 400, height: 760 },
    colorScheme: scheme,
    deviceScaleFactor: 2,
  });
  await page.addInitScript(`window.chrome = {
    runtime: {
      sendMessage: async () => (${JSON.stringify(state)}),
      onMessage: { addListener() {}, removeListener() {} },
      getManifest: () => ({}),
    },
    // The panel reads its own settings from storage; a mock without it only ever
    // rendered the crash screen.
    storage: { local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    } },
    tabs: { query: async () => [{ id: 1, url: "https://example.com" }] },
    permissions: { contains: async () => true, request: async () => true },
  };`);
  await page.goto(`http://127.0.0.1:${port}/src/sidepanel/index.html`);
  await page.waitForTimeout(600);
  // A blank panel is the failure this preview exists to catch.
  const rendered = await page.evaluate(
    `(document.getElementById('root')?.textContent ?? '').trim().length`,
  );
  if (!rendered) throw new Error(`${name}: the panel rendered nothing`);
  // A crash screen is not an empty page. Rendering SOMETHING never proved the panel
  // worked: every state here once showed the error boundary and passed.
  const crashed = await page.evaluate(
    `document.querySelector('[data-crashed]')?.textContent ?? ''`,
  );
  if (crashed) throw new Error(`${name}: the panel crashed — ${String(crashed).slice(0, 160)}`);

  // The tray sits below the fold, so a screenshot alone would never show whether
  // History and Reset are actually reachable after a run.
  if (name === "history") {
    const trayText = await page.evaluate(
      `(document.querySelector('.tray')?.textContent ?? '').trim()`,
    );
    if (!String(trayText).includes("Reset") || !String(trayText).includes("History")) {
      throw new Error(`history: expected History and Reset in the tray, got "${trayText}"`);
    }
    await page.click(".tray button");
    await page.waitForTimeout(150);
    const entries = await page.evaluate(`document.querySelectorAll('.history li').length`);
    if (entries !== 3) throw new Error(`history: expected 3 past runs, got ${entries}`);
  }

  await page.screenshot({ path: join(out, `${name}.png`), fullPage: name === "history" });
  await page.close();
  console.log(`  ${name}.png`);
}
await browser.close();
server.close();
console.log(`\nwrote ${out}`);
