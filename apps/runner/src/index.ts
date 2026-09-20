/**
 * Headless task runner: plan a goal, then execute it in a real browser.
 *
 * This is milestone 2a's proving vehicle. It deliberately has no UI and no server —
 * if the loop cannot finish a task here, nothing built on top of it will work either.
 *
 *   pnpm run-task --goal "..." --url https://... [--headed] [--auto-approve]
 */
import { CdpExecutor } from "@jev-browser/executor";
import { fromEnv } from "@jev-browser/jev";
import { compose, extract, makePlan } from "@jev-browser/planner";
import { runPlan } from "@jev-browser/runtime";
import type { RunEvent } from "@jev-browser/runtime";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const goal = arg("goal");
const url = arg("url");
if (!goal || !url) {
  console.error('usage: pnpm run-task --goal "..." --url https://... [--headed] [--auto-approve]');
  process.exit(1);
}
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

const t0 = Date.now();
const ms = () => String(Date.now() - t0).padStart(6);

function print(e: RunEvent): void {
  switch (e.type) {
    case "plan":
      console.log(`${ms()}  plan      ${e.nodes} nodes · ${e.sites.join(", ") || "one site"} · $${e.costUsd.toFixed(5)}`);
      break;
    case "node:start":
      console.log(`${ms()}  ${e.kind.padEnd(8)}  ${e.id}  ${e.intent.slice(0, 62)}`);
      break;
    case "step":
      console.log(
        `${ms()}    step    ${e.operation.padEnd(11)}` +
          `${e.target ? `"${e.target.slice(0, 38)}"` : ""}`.padEnd(42) +
          `p=${e.confidence?.toFixed(2) ?? " n/a"} ${String(e.latencyMs).padStart(4)}ms` +
          `${e.risk !== "none" ? `  risk=${e.risk}` : ""}`,
      );
      break;
    case "text":
      console.log(`${ms()}    typed   "${e.value.slice(0, 54)}"  (${e.latencyMs}ms)`);
      break;
    case "escalate":
      console.log(`${ms()}    ~~ low confidence on ${e.nodeId}: ${e.reason}`);
      break;
    case "suspend":
      console.log(`\n${ms()}  SUSPENDED (${e.reason}) — ${e.preview}${e.risk ? `  risk=${e.risk}` : ""}`);
      break;
    case "warn":
      console.log(`${ms()}    !! ${e.message}`);
      break;
    case "finish":
      console.log(
        `\n${ms()}  ${e.status.toUpperCase()}  ${e.steps} steps · $${e.costUsd.toFixed(5)} · ${(e.elapsedMs / 1000).toFixed(1)}s`,
      );
      break;
  }
}

console.log(`goal   ${goal}\nstart  ${url}\n`);

const planned = await makePlan({ apiKey, goal, start: url });
print({ type: "plan", nodes: planned.plan.nodes.length, sites: planned.plan.sites, costUsd: planned.costUsd });

const executor = await CdpExecutor.launch(url, { headless: !flag("headed") });
try {
  const result = await runPlan({
    jev: fromEnv("openrouter"),
    executor,
    plan: planned.plan,
    emit: print,
    apiKey,
    // --auto-approve exists ONLY so a read-only task can run unattended. It must
    // never be the default: it turns the safety gate off.
    ...(flag("auto-approve")
      ? { approve: async () => true }
      : {}),
    extract: async (intent, schema, pageText) =>
      (await extract({ apiKey, intent, schema, pageText })).value,
    compose: async (intent, inputs) => (await compose({ apiKey, intent, inputs })).value,
  });

  const data = Object.entries(result.data).filter(([k]) => k !== "profile");
  if (data.length) {
    console.log(`\nscratchpad:`);
    for (const [k, v] of data) console.log(`  ${k}  ${JSON.stringify(v).slice(0, 200)}`);
  }
  process.exitCode = result.status === "done" ? 0 : 1;
} finally {
  await executor.close();
}
