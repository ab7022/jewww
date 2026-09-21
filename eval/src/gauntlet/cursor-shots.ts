/** Renders the agent's cursor in its two states, for eyeballing: pnpm tsx eval/src/gauntlet/cursor-shots.ts */
import { CdpExecutor } from "@jev-browser/executor";
import { serveFixtures } from "./drivers.js";
import { tools } from "./scenarios.js";

const { base, server } = await serveFixtures();
const exec = await CdpExecutor.launch(`${base}/covered.html`, { headless: true, viewport: { width: 900, height: 560 } });
const t = tools(exec);
await exec.probe(`document.getElementById("bd").remove()`);
const apply = await t.find("button", "Easy Apply");
await exec.act({ kind: "click", eid: apply.eid }, apply.node, await exec.guardFor(apply.node, apply.fp), undefined, apply.fp);
await exec.probe(`new Promise(r => setTimeout(r, 120))`);
await (exec as unknown as { page: { screenshot(o: object): Promise<void> } }).page.screenshot({ path: ".data/cursor/doing.png" });

await exec.act({ kind: "navigate", url: `${base}/compose.html` }, null, { pageKey: null, nodeGuard: null });
const to = await t.find(null, "To recipients");
await exec.point(to.node, "Type in “To recipients”", to.fp);
await exec.probe(`new Promise(r => setTimeout(r, 300))`);
await (exec as unknown as { page: { screenshot(o: object): Promise<void> } }).page.screenshot({ path: ".data/cursor/showing.png" });
await exec.close();
server.close();
console.log("wrote .data/cursor/doing.png and showing.png");
