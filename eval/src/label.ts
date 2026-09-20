/**
 * Interactive target labelling.
 *
 * Ground truth for element selection cannot be derived by rule — someone has to
 * decide which element the intent means. This shows the ranked candidates for each
 * unlabelled fixture and records the choice.
 *
 *   pnpm eval:label            # only unlabelled fixtures
 *   pnpm eval:label --all      # review every fixture, including labelled ones
 *   pnpm eval:label gh-search  # one fixture
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { rankElements } from "@jev-browser/sense";
import { TASKS } from "./tasks.js";
import { acceptableEids, describe, FIXTURES, loadFixture, saveOverride, targetFor } from "./targets.js";

const argv = process.argv.slice(2);
const all = argv.includes("--all");
const only = argv.filter((a) => !a.startsWith("--"));

const todo = TASKS.filter((t) => {
  if (!existsSync(join(FIXTURES, `${t.slug}.json`))) return false;
  if (only.length) return only.includes(t.slug);
  if (t.kind === "form") return false; // forms are scored by the field benchmark
  return all || !targetFor(t);
});

if (!todo.length) {
  console.log("nothing to label (use --all to review existing labels)");
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log(`labelling ${todo.length} fixture(s). enter = skip, q = quit.\n`);

for (const task of todo) {
  const snap = loadFixture(task.slug);
  const ranked = rankElements(snap, task.intent);
  const current = targetFor(task);

  console.log(`\n${"─".repeat(72)}`);
  console.log(`${task.slug}   ${snap.elements.length} elements`);
  console.log(`goal    ${task.goal}`);
  console.log(`intent  ${task.intent}`);
  if (current) {
    console.log(`current "${current}" → ${acceptableEids(snap, current).length} match(es)`);
  }
  console.log(`\ntop ranked candidates:`);
  ranked.slice(0, 15).forEach((e, i) => console.log(`  ${String(i).padStart(2)}  ${describe(e).slice(0, 76)}`));

  const answer = (
    await rl.question(`\nindex, or text to match, or /regex to search: `)
  ).trim();

  if (answer === "q") break;
  if (!answer) continue;

  if (answer.startsWith("/")) {
    const re = new RegExp(answer.slice(1), "i");
    snap.elements.filter((e) => re.test(e.name)).slice(0, 20).forEach((e, i) => {
      console.log(`  ${String(i).padStart(2)}  ${describe(e).slice(0, 76)}`);
    });
    const pick = (await rl.question(`exact text to store: `)).trim();
    if (pick) saveOverride(task.slug, pick);
    continue;
  }

  const asIndex = Number(answer);
  const chosen = Number.isInteger(asIndex) ? ranked[asIndex]?.name : answer;
  if (!chosen) {
    console.log("  no such candidate, skipped");
    continue;
  }
  const n = acceptableEids(snap, chosen).length;
  console.log(`  stored "${chosen}" → ${n} acceptable element(s)`);
  saveOverride(task.slug, chosen);
}

rl.close();
console.log(`\ndone. run: pnpm eval:select`);
