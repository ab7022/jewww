/**
 * Headless task runner: plan a goal, then execute it in a real browser.
 *
 * This is milestone 2a's proving vehicle. It deliberately has no UI and no server —
 * if the loop cannot finish a task here, nothing built on top of it will work either.
 *
 *   pnpm run-task --goal "..." --url https://... [--headed] [--auto-approve]
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { CdpExecutor } from "@jev-browser/executor";
import { fromEnv } from "@jev-browser/jev";
import { compose, extract, makePlan } from "@jev-browser/planner";
import { decide, fieldText, mapFields, readConstraints } from "@jev-browser/policy";
import { type Capabilities, runPlan } from "@jev-browser/runtime";
import { bindModels } from "@jev-browser/runtime/models";
import type { RunEvent } from "@jev-browser/runtime";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const goal = arg("goal");
const url = arg("url");
if (!goal || !url) {
  console.error('usage: pnpm run-task --goal "..." --url https://... [--headed] [--batch] [--no-ask] [--auto-approve] [--profile p.json]');
  process.exit(1);
}
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

const profilePath = arg("profile");
const profile = profilePath
  ? (JSON.parse(readFileSync(profilePath, "utf8")) as Record<string, string>)
  : undefined;

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
    case "node:done":
      if (e.detail) console.log(`${ms()}    ${e.detail}`);
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
    case "queued":
      console.log(`${ms()}    queued for review: ${e.preview}  risk=${e.risk}`);
      break;
    case "asked":
      console.log(`${ms()}    asked you ${e.count} question(s), got ${e.answered}`);
      break;
    case "reused":
      console.log(`${ms()}    reused your earlier answer for "${e.field.slice(0, 44)}"`);
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

const jev = fromEnv("openrouter");
const constraints = await readConstraints(jev, goal);
console.log(
  `${ms()}  authority  ${constraints.autonomy} (p=${constraints.confidence.toFixed(2)}) — ` +
    `${constraints.autonomy === "full" ? "carry the task out without interrupting" : constraints.autonomy === "never" ? "fill in but finalise nothing" : "ask before finalising"}`,
);
const planned = await makePlan({ apiKey, goal, start: url, jev });
print({ type: "plan", nodes: planned.plan.nodes.length, sites: planned.plan.sites, costUsd: planned.costUsd });
for (const n of planned.normalised) {
  console.log(`${ms()}    normalised ${n.nodeId}: ${n.from} -> ${n.to} (p=${n.confidence.toFixed(2)})`);
}

const executor = await CdpExecutor.launch(url, { headless: !flag("headed") });
try {
  // The CLI talks to the models directly; the extension goes through the server. Both
  // bind capabilities to the run ONCE — goal and instructions are never per-call.
  const capabilities: Capabilities = bindModels({ apiKey, jev, goal });

  const result = await runPlan({
    capabilities,
    executor,
    plan: planned.plan,
    emit: print,
    ...(profile ? { profile } : {}),
    ...(arg("max-steps") ? { maxSteps: Number(arg("max-steps")) } : {}),
    // --auto-approve exists ONLY so a read-only task can run unattended. It must
    // never be the default: it turns the safety gate off.
    autonomy: constraints.autonomy,
    // Anything the agent cannot answer is asked ONCE and remembered, so the same
    // question on the next nine applications fills itself.
    ...(flag("no-ask")
      ? {}
      : {
          ask: async (missing) => {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const given: Record<string, string> = {};
            console.log(`\n  ${missing.length} field(s) I cannot answer from your profile:`);
            try {
              for (const m of missing) {
                const answer = (
                  await rl.question(`    ${m.required ? "*" : " "} ${m.label.slice(0, 90)}\n      > `)
                ).trim();
                if (answer) given[m.key] = answer;
              }
            } finally {
              rl.close();
            }
            return given;
          },
        }),
    ...(flag("auto-approve") ? { approve: async () => true } : {}),
    // --batch fills everything safe and queues every irreversible step for one
    // review at the end. Nothing gated is executed either way.
    ...(flag("batch") ? { batchApprovals: true } : {}),
  });

  if (result.pending.length) {
    console.log(`\nREVIEW QUEUE — ${result.pending.length} step(s), none executed:`);
    for (const p of result.pending) {
      const who =
        p.item && typeof p.item === "object"
          ? ((p.item as Record<string, unknown>).company ?? (p.item as Record<string, unknown>).title ?? "")
          : "";
      console.log(
        `  ${String(who).slice(0, 24).padEnd(26)} ${p.operation} "${p.target.slice(0, 34)}"` +
          `  risk=${p.risk}\n      ${p.url.slice(0, 92)}`,
      );
    }
  }

  const data = Object.entries(result.data).filter(([k]) => k !== "profile");
  if (data.length) {
    console.log(`\nscratchpad:`);
    for (const [k, v] of data) console.log(`  ${k}  ${JSON.stringify(v).slice(0, 200)}`);
  }
  process.exitCode = result.status === "done" ? 0 : 1;
} finally {
  await executor.close();
}
