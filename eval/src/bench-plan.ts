/**
 * Planner benchmark over all 50 use cases.
 *
 * Plans are cached to eval/plans/, so iterating on the CHECKS costs nothing — only a
 * prompt change or --fresh re-spends. That matters: the checks will be wrong several
 * times before they are right, and re-running the planner each time would be silly.
 *
 *   pnpm eval:plans              # plan what is missing, then check everything
 *   pnpm eval:plans --fresh      # re-plan all 50
 *   pnpm eval:plans --check-only # no network at all
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makePlan } from "@jev-browser/planner";
import { Plan } from "@jev-browser/shared";
import { CHECK_IDS, runChecks, SAFETY_CHECKS } from "./checks.js";
import { type JevPlanScore, scorePlan } from "./jev-checks.js";
import { USE_CASES, type UseCase } from "./usecases.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLANS = join(ROOT, "plans");
const RESULTS = join(ROOT, "results");
mkdirSync(PLANS, { recursive: true });
mkdirSync(RESULTS, { recursive: true });

const argv = process.argv.slice(2);
const fresh = argv.includes("--fresh");
const checkOnly = argv.includes("--check-only");
/** JEV-scored judgement checks; skip with --no-jev when offline. */
const useJev = !argv.includes("--no-jev");
const CONCURRENCY = 6;

interface Cached {
  plan: Plan;
  costUsd: number;
  latencyMs: number;
  model: string;
  repaired: boolean;
}

const planPath = (slug: string) => join(PLANS, `${slug}.json`);

async function getPlan(uc: UseCase, apiKey: string): Promise<Cached | { error: string }> {
  if (!fresh && existsSync(planPath(uc.slug))) {
    const raw = JSON.parse(readFileSync(planPath(uc.slug), "utf8")) as Cached;
    const parsed = Plan.safeParse(raw.plan);
    if (parsed.success) return { ...raw, plan: parsed.data };
  }
  if (checkOnly) return { error: "no cached plan (--check-only)" };
  try {
    const r = await makePlan({ apiKey, goal: uc.goal, start: uc.start });
    const cached: Cached = {
      plan: r.plan,
      costUsd: r.costUsd,
      latencyMs: r.latencyMs,
      model: r.model,
      repaired: r.repaired,
    };
    writeFileSync(planPath(uc.slug), JSON.stringify(cached, null, 2));
    return cached;
  } catch (err) {
    return { error: err instanceof Error ? err.message.slice(0, 120) : String(err) };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      for (;;) {
        const i = next++;
        const item = items[i];
        if (i >= items.length || item === undefined) return;
        out[i] = await fn(item);
      }
    }),
  );
  return out;
}

const apiKey = process.env.OPENROUTER_API_KEY ?? "";
if (!apiKey && !checkOnly) throw new Error("OPENROUTER_API_KEY is not set");

const missing = USE_CASES.filter((u) => fresh || !existsSync(planPath(u.slug))).length;
if (missing && !checkOnly) console.log(`planning ${missing} use case(s), ${CONCURRENCY} at a time…\n`);

const rows = await pool(USE_CASES, CONCURRENCY, async (uc) => {
  const got = await getPlan(uc, apiKey);
  if ("error" in got) return { uc, error: got.error };
  const checks = runChecks(got.plan, uc);
  const applicable = checks.filter((c) => c.applicable);
  const failed = applicable.filter((c) => !c.pass);
  const unsafe = failed.filter((c) => SAFETY_CHECKS.has(c.id));
  let jev: JevPlanScore | undefined;
  if (useJev) {
    try {
      jev = await scorePlan(uc.slug, got.plan);
    } catch {
      // A scoring failure must not lose the deterministic result for this row.
    }
  }
  process.stdout.write(unsafe.length ? "!" : failed.length ? "x" : ".");
  return { uc, cached: got, checks, applicable, failed, unsafe, jev };
});
console.log("\n");

// --- report ---------------------------------------------------------------

const ok = rows.filter((r) => !("error" in r)) as Extract<(typeof rows)[number], { checks: unknown }>[];
const errors = rows.filter((r) => "error" in r);

const perCheck = CHECK_IDS.map((id) => {
  const applicable = ok.filter((r) => r.checks.find((c) => c.id === id)?.applicable);
  const passed = applicable.filter((r) => r.checks.find((c) => c.id === id)?.pass);
  return { id, n: applicable.length, passed: passed.length };
});

const pct = (a: number, b: number) => (b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(0).padStart(4)}%`);

console.log("CHECK                 applicable   passed    rate");
console.log("─".repeat(52));
for (const c of perCheck) {
  const flag = SAFETY_CHECKS.has(c.id) ? " *" : "  ";
  console.log(
    `${flag}${c.id.padEnd(18)} ${String(c.n).padStart(8)} ${String(c.passed).padStart(9)}   ${pct(c.passed, c.n)}`,
  );
}
console.log("─".repeat(52));
console.log("  * = safety critical\n");

const cleanPlans = ok.filter((r) => r.failed.length === 0).length;
const unsafePlans = ok.filter((r) => r.unsafe.length > 0);
const totalCost = ok.reduce((s, r) => s + r.cached.costUsd, 0);
const latencies = ok.map((r) => r.cached.latencyMs).sort((a, b) => a - b);
const median = latencies[Math.floor(latencies.length / 2)] ?? 0;
const repaired = ok.filter((r) => r.cached.repaired).length;

console.log(`plans            ${ok.length}/${USE_CASES.length} produced, ${errors.length} error(s)`);
console.log(`fully clean      ${cleanPlans}/${ok.length}  (every applicable check passed)`);
console.log(`UNSAFE           ${unsafePlans.length}/${ok.length}`);
console.log(`needed repair    ${repaired}/${ok.length}`);
console.log(`median latency   ${median}ms`);
console.log(`total cost       $${totalCost.toFixed(4)}  (avg $${(totalCost / Math.max(ok.length, 1)).toFixed(5)})`);

const scored = ok.map((r) => r.jev).filter((j): j is JevPlanScore => Boolean(j));
if (scored.length) {
  const obs = scored.reduce((s, j) => s + j.observableRate, 0) / scored.length;
  const ach = scored.reduce((s, j) => s + j.achievable, 0) / scored.length;
  const jevCost = scored.reduce((s, j) => s + j.costUsd, 0);
  const jevLat = scored.map((j) => j.latencyMs).sort((a, b) => a - b);
  console.log(`\nJEV-scored (${scored.length} plans, $${jevCost.toFixed(4)}, median ${jevLat[Math.floor(jevLat.length / 2)]}ms)`);
  console.log(`  observable success criteria   ${(obs * 100).toFixed(0)}%`);
  console.log(`  achievable rubric (0-3)       ${ach.toFixed(2)}`);
  const worst = [...scored].sort((a, b) => a.achievable - b.achievable).slice(0, 5);
  console.log(`  least achievable: ${worst.map((w) => `${w.slug}(${w.achievable.toFixed(1)})`).join(" ")}`);
}

if (unsafePlans.length) {
  console.log(`\nUNSAFE PLANS — these would run an irreversible step with no human gate:`);
  for (const r of unsafePlans) {
    console.log(`  ${r.uc.slug.padEnd(22)} ${r.unsafe.map((c) => `${c.id}${c.detail ? `(${c.detail})` : ""}`).join(" ")}`);
  }
}

const otherFails = ok.filter((r) => r.failed.length && !r.unsafe.length);
if (otherFails.length) {
  console.log(`\nquality failures:`);
  for (const r of otherFails) {
    console.log(`  ${r.uc.slug.padEnd(22)} ${r.failed.map((c) => c.id).join(" ")}`);
  }
}
if (errors.length) {
  console.log(`\nerrors:`);
  for (const e of errors) console.log(`  ${e.uc.slug.padEnd(22)} ${(e as { error: string }).error}`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(
  join(RESULTS, `plans-${stamp}.json`),
  JSON.stringify(
    {
      model: ok[0]?.cached.model,
      summary: { total: USE_CASES.length, clean: cleanPlans, unsafe: unsafePlans.length, repaired, median, totalCost },
      perCheck,
      rows: ok.map((r) => ({ slug: r.uc.slug, failed: r.failed.map((c) => ({ id: c.id, detail: c.detail })) })),
    },
    null,
    2,
  ),
);
console.log(`\nwrote results/plans-${stamp}.json`);
