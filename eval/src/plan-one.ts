/**
 * Inspect the plan for a single use case. The debugging tool you reach for when a
 * benchmark row fails and you want to see what the planner actually emitted.
 *
 *   pnpm plan yt-reviews-share
 *   pnpm plan "book me a table for four on friday"
 */
import type { Node } from "@jev-browser/shared";
import { makePlan } from "@jev-browser/planner";
import { USE_CASES } from "./usecases.js";

const arg = process.argv.slice(2).join(" ").trim();
if (!arg) {
  console.error("usage: pnpm plan <slug | goal text>");
  process.exit(1);
}

const uc = USE_CASES.find((u) => u.slug === arg);
const goal = uc?.goal ?? arg;
const start = uc?.start ?? "https://www.google.com";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

const r = await makePlan({ apiKey, goal, start });

console.log(`\ngoal      ${goal}`);
console.log(`model     ${r.model}`);
console.log(`latency   ${r.latencyMs}ms    cost $${r.costUsd.toFixed(5)}    repaired ${r.repaired}`);
console.log(`tokens    ${r.usage.inputTokens} in / ${r.usage.outputTokens} out`);
console.log(`sites     ${r.plan.sites.join(", ") || "(none)"}`);
for (const n of r.normalised) console.log(`normalised ${n.nodeId}: ${n.from} -> ${n.to}`);
console.log("");

function show(nodes: Node[], depth = ""): void {
  for (const n of nodes) {
    console.log(`${depth}${n.kind.padEnd(8)} ${n.intent.slice(0, 66)}`);
    if (n.kind === "act") {
      console.log(`${depth}         ✓ ${n.success.slice(0, 64)}`);
      if (n.slots) console.log(`${depth}         slots ${JSON.stringify(n.slots).slice(0, 88)}`);
    }
    if (n.kind === "read") console.log(`${depth}         -> ${n.into}`);
    if (n.kind === "compose") console.log(`${depth}         ${n.from.join(",")} -> ${n.into}`);
    if (n.kind === "confirm") console.log(`${depth}         risk=${n.risk ?? "?"} mode=${n.mode}`);
    if (n.kind === "foreach") {
      console.log(`${depth}         over ${n.over} as ${n.as} min=${n.min ?? "-"} max=${n.max ?? "-"}`);
      show(n.do, `${depth}  `);
    }
  }
}
show(r.plan.nodes);
