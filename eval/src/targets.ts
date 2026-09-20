import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RawElement, RawSnapshot } from "@jev-browser/shared";
import { TASKS, type Task } from "./tasks.js";

/**
 * Target labels live in two places: committed defaults on each Task, and a local
 * overrides file the labelling CLI writes. Overrides win, so anyone can relabel
 * without editing TypeScript.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
export const OVERRIDES = join(HERE, "..", "targets.json");
export const FIXTURES = join(HERE, "..", "fixtures");

export function loadOverrides(): Record<string, string> {
  if (!existsSync(OVERRIDES)) return {};
  return JSON.parse(readFileSync(OVERRIDES, "utf8")) as Record<string, string>;
}

export function saveOverride(slug: string, target: string): void {
  const all = loadOverrides();
  all[slug] = target;
  writeFileSync(OVERRIDES, `${JSON.stringify(all, null, 2)}\n`);
}

export function targetFor(task: Task): string | undefined {
  return loadOverrides()[task.slug] ?? task.target;
}

export function loadFixture(slug: string): RawSnapshot {
  return JSON.parse(readFileSync(join(FIXTURES, `${slug}.json`), "utf8")) as RawSnapshot;
}

/**
 * Every element the label accepts.
 *
 * A page often offers two routes to the same thing — a sidebar contents link and the
 * heading itself — and both answers are right. Forcing the label to be unique would
 * mark a correct pick wrong, so the label names a SET and any member counts.
 */
export function acceptableEids(snap: RawSnapshot, target: string): string[] {
  const t = target.toLowerCase();
  return snap.elements.filter((e) => e.name.toLowerCase().includes(t)).map((e) => e.eid);
}

export function labelledTasks(): { task: Task; target: string; snap: RawSnapshot }[] {
  const out: { task: Task; target: string; snap: RawSnapshot }[] = [];
  for (const task of TASKS) {
    const target = targetFor(task);
    if (!target || !existsSync(join(FIXTURES, `${task.slug}.json`))) continue;
    const snap = loadFixture(task.slug);
    if (acceptableEids(snap, target).length === 0) continue;
    out.push({ task, target, snap });
  }
  return out;
}

export function describe(e: RawElement): string {
  const bits = [`[${e.role}]`, e.name];
  if (e.ctx) bits.push(`(${e.ctx})`);
  return bits.join(" ");
}
