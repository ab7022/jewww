/**
 * Field-mapping benchmark: the single highest-leverage primitive in the system.
 *
 * For an unknown form, ask JEV one question PER FIELD, all in ONE call: "which
 * profile key belongs in this input?" A 26-field application form is one request.
 * Runs entirely offline against saved fixtures.
 *
 *   pnpm eval:fields
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromEnv } from "@jev-browser/jev";
import {
  NO_FIELD,
  profileCriteria,
  type Questions,
  type RawSnapshot,
} from "@jev-browser/shared";
import { labelFor } from "./field-labels.js";
import { TASKS } from "./tasks.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const jev = fromEnv("openrouter");
const criteria = profileCriteria();

const forms = TASKS.filter((t) => t.kind === "form" && existsSync(join(FIXTURES, `${t.slug}.json`)));

interface Row {
  slug: string;
  field: string;
  expected: string;
  got: string;
  p: number;
  correct: boolean;
}

const rows: Row[] = [];
let unlabelled = 0;
let cost = 0;
const latencies: number[] = [];
const tokens: number[] = [];

for (const task of forms) {
  const snap = JSON.parse(readFileSync(join(FIXTURES, `${task.slug}.json`), "utf8")) as RawSnapshot;
  const fields = snap.elements.filter((e) => e.fillable);
  type Labelled = { f: (typeof fields)[number]; expected: NonNullable<ReturnType<typeof labelFor>> };
  const labelled: Labelled[] = fields
    .map((f) => ({ f, expected: labelFor(f.name) }))
    .filter((x): x is Labelled => x.expected !== null);
  unlabelled += fields.length - labelled.length;
  if (!labelled.length) continue;

  // One question per field, ONE call. This is the batching that makes it cheap.
  const questions: Questions = {};
  for (const { f } of labelled) {
    questions[f.eid] = {
      type: "choice",
      instructions: `Which profile field belongs in the form input labelled "${f.name}"?`,
      criteria,
    };
  }

  const r = await jev.evaluate(
    { page: { url: snap.url, title: snap.title }, form: labelled.map(({ f }) => ({ eid: f.eid, role: f.role, label: f.name, required: f.st?.includes("required") ?? false })) },
    questions,
  );
  cost += r.costUsd;
  latencies.push(r.latencyMs);
  tokens.push(r.usage.inputTokens);

  for (const { f, expected } of labelled) {
    const a = r.answers[f.eid];
    const got = a && a.type === "choice" ? a.choice : "?";
    const p = a && a.type === "choice" ? (a.probabilities?.[got] ?? 0) : 0;
    rows.push({ slug: task.slug, field: f.name, expected, got, p, correct: got === expected });
  }
  const hit = rows.filter((x) => x.slug === task.slug);
  console.log(
    `${task.slug.padEnd(12)} ${String(hit.filter((x) => x.correct).length).padStart(3)}/${String(hit.length).padEnd(3)} ` +
      `${r.latencyMs}ms  ${r.usage.inputTokens} tok  $${r.costUsd.toFixed(6)}`,
  );
}

const correct = rows.filter((r) => r.correct).length;
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");

console.log(`\nfield mapping   ${correct}/${rows.length}  ${pct(correct, rows.length)}`);
console.log(`unlabelled      ${unlabelled} field(s) excluded (no deterministic rule)`);
console.log(`cost            $${cost.toFixed(5)} for ${forms.length} forms`);
console.log(`median latency  ${latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)]}ms`);
console.log(`median tokens   ${tokens.sort((a, b) => a - b)[Math.floor(tokens.length / 2)]} in`);

// Calibration: the whole reason for choosing JEV over a small LLM is that this
// number is meaningful. If high-confidence answers are no better than low, the
// escalation threshold is decorative.
const buckets = [
  { lo: 0.9, hi: 1.01, label: "p >= 0.90" },
  { lo: 0.7, hi: 0.9, label: "0.70-0.90" },
  { lo: 0.0, hi: 0.7, label: "p <  0.70" },
];
console.log(`\ncalibration`);
for (const b of buckets) {
  const inB = rows.filter((r) => r.p >= b.lo && r.p < b.hi);
  const ok = inB.filter((r) => r.correct).length;
  console.log(`  ${b.label}   n=${String(inB.length).padStart(3)}   accuracy ${pct(ok, inB.length)}`);
}

const wrong = rows.filter((r) => !r.correct);
if (wrong.length) {
  console.log(`\nmisses:`);
  for (const w of wrong.slice(0, 25)) {
    console.log(`  ${w.slug.padEnd(11)} ${w.field.slice(0, 44).padEnd(46)} want=${w.expected.padEnd(18)} got=${w.got} (p=${w.p.toFixed(2)})`);
  }
}
