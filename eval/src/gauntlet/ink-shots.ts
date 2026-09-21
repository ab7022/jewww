/** Renders the agent drawing on a page, for eyeballing: pnpm tsx eval/src/gauntlet/ink-shots.ts */
import { CdpExecutor } from "@jev-browser/executor";
import { serveFixtures } from "./drivers.js";
import { tools } from "./scenarios.js";

const { base, server } = await serveFixtures();
const exec = await CdpExecutor.launch(`${base}/apps/billing.html`, { headless: true, viewport: { width: 1180, height: 720 } });
const t = tools(exec);
const shot = (path: string) => (exec as unknown as { page: { screenshot(o: object): Promise<void> } }).page.screenshot({ path });

const pay = await t.find("button", "Pay now");
const change = await t.find("button", "Change plan");
const alerts = await t.find("button", "Set usage alert");
await exec.annotate([
  { node: pay.node, fp: pay.fp, n: 1, note: "$1,284.60 is due on 1 October — a quarter of it is overage" },
  { node: alerts.node, fp: alerts.fp, n: 2, note: "You're at 86% of bandwidth; an alert stops next month's surprise" },
  { node: change.node, fp: change.fp, n: 3, note: "Only if overage keeps happening — the next tier includes 25 TB" },
]);
await exec.probe(`new Promise(r => setTimeout(r, 400))`);
await shot(".data/ink/drawing.png");
await exec.probe(`new Promise(r => setTimeout(r, 2400))`);
await shot(".data/ink/explained.png");

await exec.point(pay.node, "Click “Pay now”", pay.fp);
await exec.probe(`new Promise(r => setTimeout(r, 900))`);
await shot(".data/ink/showing.png");
await exec.close();
server.close();
console.log("wrote .data/ink/{drawing,explained,showing}.png");
