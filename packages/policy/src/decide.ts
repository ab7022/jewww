import type { JevProvider } from "@jev-browser/jev";
import {
  type Action,
  IRREVERSIBLE_NAME,
  type Questions,
  RISK as RISK_CRITERIA,
  type Risk,
  type Snapshot,
  validateChoice,
} from "@jev-browser/shared";
import {
  type ActionSpace,
  describeTarget,
  type Operation,
  type TargetEntry,
  targetHeadName,
} from "./action-space.js";
import { NEXT_OPERATION, RISK, TARGET } from "./instructions.js";

export interface DecideInput {
  goal: string;
  subgoal: string;
  success: string;
  snapshot: Snapshot;
  space: ActionSpace;
  recent: { action: string; text?: string | null; pageChanged?: boolean | null }[];
}

export interface Decision {
  action: Action;
  /** The live DOM node the action resolves to, for the executor's guard check. */
  node?: number;
  operation: Operation;
  target?: TargetEntry;
  risk: Risk;
  /** Probability of the chosen operation. */
  operationConfidence: number | undefined;
  targetConfidence: number | undefined;
  /** Jev's own self-assessment, distinct from the distribution. */
  selfConfidence: number | undefined;
  requiresConfirmation: boolean;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
}

/** Below this on either head, hand the step back to the planner instead of acting. */
export const ACT_THRESHOLD = 0.7;

/**
 * One request. Asks which operation to perform AND, speculatively, the best target
 * for every operation that has one — plus the risk class. Only the head matching the
 * chosen operation is consumed; the rest cost nothing extra and save a round trip.
 */
export function buildQuestions(input: DecideInput): Questions {
  const { space, goal, subgoal, success } = input;
  const context = `Goal: ${goal}\nSubgoal: ${subgoal}\nSucceeds when: ${success}`;

  const questions: Questions = {
    operation: {
      type: "choice",
      instructions: `${context}\n\n${NEXT_OPERATION}`,
      criteria: space.operations,
    },
    risk: {
      type: "choice",
      instructions: `${context}\n\n${RISK}`,
      criteria: { ...RISK_CRITERIA },
    },
  };

  for (const [op, entries] of Object.entries(space.targets)) {
    if (!entries || !Object.keys(entries).length) continue;
    questions[targetHeadName(op)] = {
      type: "choice",
      instructions: `${context}\n\nThe assumed operation is ${op}.\n\n${TARGET}`,
      criteria: Object.fromEntries(Object.entries(entries).map(([k, t]) => [k, describeTarget(t)])),
    };
  }
  return questions;
}

export async function decide(jev: JevProvider, input: DecideInput): Promise<Decision> {
  const questions = buildQuestions(input);
  const state = {
    goal: input.goal,
    subgoal: input.subgoal,
    success_criteria: input.success,
    page: {
      url: input.snapshot.url,
      title: input.snapshot.title,
      text: input.snapshot.text,
    },
    scroll: input.snapshot.viewport,
    elements: input.space.elements,
    recent_actions: input.recent.slice(-10),
  };

  const r = await jev.evaluate(state, questions);

  const opAnswer = r.answers.operation;
  validateChoice(opAnswer, Object.keys(input.space.operations));
  const operation = opAnswer.choice as Operation;

  let target: TargetEntry | undefined;
  let targetConfidence: number | undefined;

  const head = input.space.targets[operation as "CLICK" | "TYPE_TEXT" | "SELECT"];
  if (head) {
    // Validate ONLY the head the operation selected. An unused speculative head
    // cannot cause an action, so a malformed one must not fail the step either.
    const answer = r.answers[targetHeadName(operation)];
    validateChoice(answer, Object.keys(head));
    target = head[answer.choice];
    targetConfidence = answer.probabilities?.[answer.choice];
  }

  const riskAnswer = r.answers.risk;
  validateChoice(riskAnswer, Object.keys(RISK_CRITERIA));
  const risk = riskAnswer.choice as Risk;

  const action = toAction(operation, target);

  // The model's risk class is advisory. The label check is not: a page that talks
  // Jev into `risk: none` still cannot get past a name that reads as irreversible.
  const requiresConfirmation =
    risk !== "none" || (target !== undefined && IRREVERSIBLE_NAME.test(target.label));

  return {
    action,
    ...(target ? { node: target.node } : {}),
    operation,
    ...(target ? { target } : {}),
    risk,
    operationConfidence: opAnswer.probabilities?.[opAnswer.choice],
    targetConfidence,
    selfConfidence: opAnswer.confidence,
    requiresConfirmation,
    latencyMs: r.latencyMs,
    costUsd: r.costUsd,
    inputTokens: r.usage.inputTokens,
  };
}

/** True when either head is too uncertain to act on. */
export function shouldEscalate(d: Decision, threshold = ACT_THRESHOLD): boolean {
  const op = d.operationConfidence;
  const tgt = d.targetConfidence;
  if (op !== undefined && op < threshold) return true;
  if (tgt !== undefined && tgt < threshold) return true;
  return false;
}

function toAction(operation: Operation, target?: TargetEntry): Action {
  switch (operation) {
    case "CLICK":
      if (!target) throw new Error("CLICK without a target");
      return { kind: "click", eid: target.eid };
    case "TYPE_TEXT":
      if (!target) throw new Error("TYPE_TEXT without a target");
      // Text is filled in by the caller via the inline helper, never guessed here.
      return { kind: "type", eid: target.eid, text: "" };
    case "SELECT":
      if (!target) throw new Error("SELECT without a target");
      return { kind: "select", eid: target.eid, option: target.option ?? target.value ?? "" };
    case "SCROLL_DOWN":
      return { kind: "scroll", dir: "down" };
    case "SCROLL_UP":
      return { kind: "scroll", dir: "up" };
    case "WAIT":
      return { kind: "wait", ms: 100 };
    case "DONE":
      return { kind: "done" };
    case "BLOCKED":
      return { kind: "blocked", reason: "no supported operation can progress" };
  }
}
