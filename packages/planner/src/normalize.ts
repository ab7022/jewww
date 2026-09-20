import type { JevProvider } from "@jev-browser/jev";
import type { Node, Plan, Questions } from "@jev-browser/shared";
import { validateChoice, walk } from "@jev-browser/shared";

/**
 * Canonicalise a plan after parsing, by asking JEV what each step actually is.
 *
 * This exists for a measured reason: however explicitly the prompt says that filling
 * several form fields must be a `fill` node — including as rule zero — the planner
 * keeps emitting `act`. The first version of this file matched intent prose with
 * regexes, which worked on the examples I had written and would not have survived the
 * next site: "do not submit" read as a node that submits, and any phrasing I had not
 * thought of read as nothing at all.
 *
 * So the classification is a model's job. One batched call per plan, one question per
 * act node, ~$0.0002 — cheap next to the ~$0.0015 the plan itself cost, and it
 * generalises to intents nobody anticipated.
 */

const KIND_CRITERIA: Record<string, string> = {
  act: "drives the page one interaction at a time — clicking, navigating, opening something, or entering a single specific value",
  fill: "enters values into SEVERAL fields of a form at once, such as an application, checkout, or signup form",
  read: "only reads information off the page without changing anything",
};

export interface Normalisation {
  nodeId: string;
  from: string;
  to: string;
  confidence: number;
}

export interface NormalizeResult {
  plan: Plan;
  changes: Normalisation[];
  costUsd: number;
}

export async function normalizePlan(jev: JevProvider, plan: Plan): Promise<NormalizeResult> {
  const acts = walk(plan.nodes).filter(
    (n): n is Extract<Node, { kind: "act" }> => n.kind === "act",
  );
  if (!acts.length) return { plan, changes: [], costUsd: 0 };

  const questions: Questions = {};
  for (const node of acts) {
    questions[node.id] = {
      type: "choice",
      instructions:
        `What does this planned step actually do?\n` +
        `Step: "${node.intent}"\n` +
        `It succeeds when: "${node.success}"`,
      criteria: KIND_CRITERIA,
    };
  }

  const r = await jev.evaluate({ goal: plan.goal, steps: acts.map((a) => a.intent) }, questions);

  const rewrite = new Map<string, Normalisation>();
  for (const node of acts) {
    const answer = r.answers[node.id];
    try {
      validateChoice(answer, Object.keys(KIND_CRITERIA));
    } catch {
      continue;
    }
    // Only `fill` is worth rewriting to: it is the one kind with different mechanics
    // rather than a different description. Leave everything else as planned.
    if (answer.choice !== "fill") continue;
    const confidence = answer.probabilities?.[answer.choice] ?? 1;
    // A slotted act node is typing one specific value somewhere; leave it alone.
    if (node.slots && Object.keys(node.slots).length) continue;
    if (confidence < 0.6) continue;
    rewrite.set(node.id, { nodeId: node.id, from: "act", to: "fill", confidence });
  }

  const apply = (nodes: Node[]): Node[] =>
    nodes.map((node) => {
      if (node.kind === "foreach") return { ...node, do: apply(node.do) };
      if (node.kind !== "act" || !rewrite.has(node.id)) return node;
      const { slots: _slots, ...rest } = node;
      return { ...rest, kind: "fill" as const };
    });

  return {
    plan: { ...plan, nodes: apply(plan.nodes) },
    changes: [...rewrite.values()],
    costUsd: r.costUsd,
  };
}
