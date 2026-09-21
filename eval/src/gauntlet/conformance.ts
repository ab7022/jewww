/**
 * Executor conformance: every scenario, against both executors.
 *
 *   pnpm gauntlet            (builds the test extension first)
 *
 * Exits non-zero if any scenario fails on either executor. A scenario that passes on
 * one executor and fails on the other is the specific thing this exists to catch: two
 * implementations of one contract that have drifted apart.
 */
import { cdpDriver, type Driver, extensionDriver, serveFixtures } from "./drivers.js";
import { SCENARIOS, tools } from "./scenarios.js";

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const scenarios = SCENARIOS.filter((s) => !only || s.name.includes(only) || s.page.includes(only));

const { base, server } = await serveFixtures();
const drivers: Driver[] = [cdpDriver(), await extensionDriver()];
const results: { scenario: string; driver: string; ok: boolean; detail?: string; ms: number }[] = [];

for (const scenario of scenarios) {
  for (const driver of drivers) {
    const started = Date.now();
    let session: Awaited<ReturnType<Driver["open"]>> | undefined;
    try {
      session = await driver.open(`${base}/${scenario.page}`);
      await scenario.run(session, tools(session.exec));
      results.push({ scenario: scenario.name, driver: driver.name, ok: true, ms: Date.now() - started });
    } catch (err) {
      results.push({
        scenario: scenario.name,
        driver: driver.name,
        ok: false,
        detail: (err instanceof Error ? err.message : String(err)).slice(0, 240),
        ms: Date.now() - started,
      });
    } finally {
      await session?.close().catch(() => {});
    }
  }
}

for (const d of drivers) await d.shutdown();
server.close();

const width = Math.max(...scenarios.map((s) => s.name.length));
console.log(`\n${"scenario".padEnd(width)}   ${drivers.map((d) => d.name.padEnd(10)).join(" ")}`);
for (const scenario of scenarios) {
  const cells = drivers.map((d) => {
    const r = results.find((x) => x.scenario === scenario.name && x.driver === d.name);
    return (r?.ok ? "pass" : "FAIL").padEnd(10);
  });
  console.log(`${scenario.name.padEnd(width)}   ${cells.join(" ")}`);
}
const failed = results.filter((r) => !r.ok);
for (const f of failed) console.log(`\n  ✕ [${f.driver}] ${f.scenario}\n    ${f.detail}`);
const drift = scenarios.filter((s) => {
  const r = results.filter((x) => x.scenario === s.name);
  return r.some((x) => x.ok) && r.some((x) => !x.ok);
});
if (drift.length) console.log(`\nDRIFT (passes on one executor, fails on the other): ${drift.map((d) => d.name).join("; ")}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
