/**
 * Element-selection benchmark: does JEV pick the right element on a real page?
 *
 * Run in two stages, because they fail for different reasons and the fix differs.
 *
 *   1. RECALL — is the correct element even present after rank() truncates? This is
 *      free, deterministic and involves no model. A low number here is OUR bug in
 *      packages/sense, not a verdict on JEV, and the benchmark says so.
 *   2. TOP-1 — given the capped list, does JEV choose correctly?
 *
 *   pnpm eval:select              # both
 *   pnpm eval:select --recall     # stage 1 only, no network, no cost
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fromEnv } from "@jev-browser/jev";
import { buildActionSpace, decide, targetHeadName } from "@jev-browser/policy";
import { DEFAULT_CAP, rankElements, rankedSnapshot } from "@jev-browser/sense";
import { acceptableEids, labelledTasks } from "./targets.js";

const recallOnly = process.argv.includes("--recall");
const CAPS = [30, 60, 120, 255];
const rows = labelledTasks();

if (!rows.length) {
  console.error("no labelled fixtures — run `pnpm eval:label` first");
  process.exit(1);
}

// --- stage 1: ranking recall ---------------------------------------------

console.log(`RANKING RECALL  (${rows.length} labelled fixtures, no model calls)\n`);
console.log(`${"fixture".padEnd(20)}${CAPS.map((c) => `@${c}`.padStart(7)).join("")}   best rank`);
console.log("─".repeat(58));

const recall: Record<number, number> = Object.fromEntries(CAPS.map((c) => [c, 0]));
const bestRanks: { slug: string; rank: number }[] = [];

for (const { task, target, snap } of rows) {
  const ok = new Set(acceptableEids(snap, target));
  const ranked = rankElements(snap, task.intent);
  const best = ranked.findIndex((e) => ok.has(e.eid));
  bestRanks.push({ slug: task.slug, rank: best });
  const cells = CAPS.map((c) => {
    const hit = best >= 0 && best < c;
    if (hit) recall[c] = (recall[c] ?? 0) + 1;
    return (hit ? "hit" : "—").padStart(7);
  });
  console.log(`${task.slug.padEnd(20)}${cells.join("")}   ${best < 0 ? "absent" : best}`);
}

console.log("─".repeat(58));
console.log(
  `${"recall".padEnd(20)}${CAPS.map((c) => `${(((recall[c] ?? 0) / rows.length) * 100).toFixed(0)}%`.padStart(7)).join("")}`,
);

const missedAtDefault = bestRanks.filter((b) => b.rank < 0 || b.rank >= DEFAULT_CAP);
if (missedAtDefault.length) {
  console.log(`\nbelow the cap of ${DEFAULT_CAP} — a packages/sense problem, not a model one:`);
  for (const m of missedAtDefault) console.log(`  ${m.slug.padEnd(20)} rank ${m.rank < 0 ? "absent" : m.rank}`);
}

if (recallOnly) process.exit(0);

// --- stage 2: JEV top-1 ---------------------------------------------------

const jev = fromEnv("openrouter");
console.log(`\n\nJEV TOP-1 SELECTION\n`);

interface Pick {
  slug: string;
  correct: boolean;
  chose: string;
  choseName: string;
  wantNames: string[];
  p: number;
  latencyMs: number;
}
const picks: Pick[] = [];
let cost = 0;

for (const { task, target, snap } of rows) {
  const capped = rankedSnapshot(snap, task.intent, DEFAULT_CAP);
  const ok = new Set(acceptableEids(snap, target));

  if (!capped.elements.some((e) => ok.has(e.eid))) {
    console.log(`${task.slug.padEnd(20)} skipped — target below the cap`);
    continue;
  }

  // The real decision path: one request carrying the operation head, every
  // per-operation target head, and the risk head. Benchmarking anything else would
  // measure a code path that will never ship.
  const nodes = Object.fromEntries(snap.elements.map((e) => [e.eid, e.node]));
  const space = buildActionSpace(capped.elements, nodes, {
    canScrollDown: capped.viewport.scrollY < capped.viewport.maxScrollY,
    canScrollUp: capped.viewport.scrollY > 0,
  });

  const d = await decide(jev, {
    goal: task.goal,
    subgoal: task.intent,
    success: `the intent "${task.intent}" has visibly been carried out`,
    snapshot: capped,
    nodes,
    recent: [],
  });
  cost += d.costUsd;

  const chose = d.target?.eid ?? "-";
  const p = d.targetConfidence ?? 0;
  const correct = ok.has(chose);
  const choseName = snap.elements.find((e) => e.eid === chose)?.name ?? d.operation;
  picks.push({
    slug: task.slug,
    correct,
    chose,
    choseName,
    wantNames: snap.elements.filter((e) => ok.has(e.eid)).map((e) => e.name),
    p,
    latencyMs: d.latencyMs,
  });

  const heads = Object.keys(space.targets).map(targetHeadName).length + 2;
  console.log(
    `${correct ? "ok " : "MISS"} ${task.slug.padEnd(18)} ${d.operation.padEnd(10)} p=${p.toFixed(2)} ` +
      `self=${d.selfConfidence?.toFixed(2) ?? " n/a"} ${heads} heads ` +
      `${String(d.inputTokens).padStart(5)} tok ${String(d.latencyMs).padStart(4)}ms` +
      `${d.requiresConfirmation ? "  [confirm]" : ""}` +
      `${correct ? "" : `  chose "${choseName.slice(0, 34)}"`}`,
  );
}

const hit = picks.filter((p) => p.correct).length;
const lat = picks.map((p) => p.latencyMs).sort((a, b) => a - b);
console.log(`\ntop-1 accuracy   ${hit}/${picks.length}  ${((hit / picks.length) * 100).toFixed(1)}%`);
console.log(`median latency   ${lat[Math.floor(lat.length / 2)]}ms`);
console.log(`cost             $${cost.toFixed(5)}`);

console.log(`\ncalibration`);
for (const b of [
  { lo: 0.9, hi: 1.01, label: "p >= 0.90" },
  { lo: 0.7, hi: 0.9, label: "0.70-0.90" },
  { lo: 0.0, hi: 0.7, label: "p <  0.70" },
]) {
  const inB = picks.filter((p) => p.p >= b.lo && p.p < b.hi);
  const ok2 = inB.filter((p) => p.correct).length;
  console.log(
    `  ${b.label}   n=${String(inB.length).padStart(2)}   accuracy ${inB.length ? `${((ok2 / inB.length) * 100).toFixed(0)}%` : "n/a"}`,
  );
}

const misses = picks.filter((p) => !p.correct);
if (misses.length) {
  console.log(`\nmisses:`);
  for (const m of misses) {
    console.log(`  ${m.slug}`);
    console.log(`    chose  "${m.choseName.slice(0, 62)}" (p=${m.p.toFixed(2)})`);
    console.log(`    wanted ${m.wantNames.map((n) => `"${n.slice(0, 50)}"`).join(" | ")}`);
  }
}

writeFileSync(
  join(import.meta.dirname, "..", "results", `select-${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
  JSON.stringify({ recall, rows: bestRanks, picks, cost }, null, 2),
);
