import type { JevProvider } from "@jev-browser/jev";
import {
  type Action,
  BLOCKER as BLOCKER_CRITERIA,
  type Blocker,
  FORBIDDEN_FIELD,
  MUST_HAND_OFF,
  type Questions,
  RISK as RISK_CRITERIA,
  type Risk,
  type Snapshot,
  validateChoice,
} from "@jev-browser/shared";
import {
  type ActionSpace,
  buildActionSpace,
  describeTarget,
  type Operation,
  type TargetEntry,
  targetHeadName,
} from "./action-space.js";
import { BLOCKER, NEXT_OPERATION, RISK, TARGET } from "./instructions.js";

export interface DecideInput {
  goal: string;
  /** A local file the user has offered, which enables the ATTACH operation. */
  attachable?: string;
  subgoal: string;
  success: string;
  snapshot: Snapshot;
  /** eid -> live DOM node id. The action space is built from this. */
  nodes: Record<string, number>;
  recent: { action: string; text?: string | null; pageChanged?: boolean | null }[];
  /**
   * Standing instructions the user saved in their details: tone, defaults, things to
   * always or never do. Trusted — they are the user's own words, like the goal — and
   * loaded on every run, so they are the place a preference outlives one prompt.
   */
  instructions?: string | undefined;
}

export interface Decision {
  action: Action;
  /** The live DOM node the action resolves to, for the executor's guard check. */
  node?: number;
  operation: Operation;
  target?: TargetEntry;
  risk: Risk;
  /** Why the run must hand the browser back, if it must. */
  blocker: Blocker;
  mustHandOff: boolean;
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
export function buildQuestions(input: DecideInput & { space: ActionSpace }): Questions {
  const { space, goal, subgoal, success, instructions } = input;
  const context =
    (instructions ? `Standing instructions from the user: ${instructions}\n` : "") +
    `Goal: ${goal}\nSubgoal: ${subgoal}\nSucceeds when: ${success}`;

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
    blocker: {
      type: "choice",
      instructions: `${context}\n\n${BLOCKER}`,
      criteria: { ...BLOCKER_CRITERIA },
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
  const space = buildActionSpace(input.snapshot.elements, input.nodes, {
    canScrollDown: input.snapshot.viewport.scrollY < input.snapshot.viewport.maxScrollY,
    canScrollUp: input.snapshot.viewport.scrollY > 0,
    canAttach: Boolean(input.attachable),
  });
  const questions = buildQuestions({ ...input, space });
  const state = {
    ...(input.instructions ? { standing_instructions: input.instructions } : {}),
    goal: input.goal,
    subgoal: input.subgoal,
    success_criteria: input.success,
    page: {
      url: input.snapshot.url,
      title: input.snapshot.title,
      text: input.snapshot.text,
    },
    scroll: input.snapshot.viewport,
    elements: space.elements,
    recent_actions: input.recent.slice(-10),
  };

  const r = await jev.evaluate(state, questions);

  const opAnswer = r.answers.operation;
  validateChoice(opAnswer, Object.keys(space.operations));
  const operation = opAnswer.choice as Operation;

  let target: TargetEntry | undefined;
  let targetConfidence: number | undefined;

  const head = space.targets[operation as "CLICK" | "TYPE_TEXT" | "SELECT" | "ATTACH"];
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

  const blockerAnswer = r.answers.blocker;
  validateChoice(blockerAnswer, Object.keys(BLOCKER_CRITERIA));
  const blocker = blockerAnswer.choice as Blocker;

  const action = toAction(operation, target, input.attachable ?? "");

  // Confirmation is the model's call now — a word list only ever covered the sites
  // whoever wrote it had looked at, and gating on "apply" stopped runs before they
  // had done anything. The one exception below is not a judgement call.
  const typingSecret =
    action.kind === "type" && target !== undefined && FORBIDDEN_FIELD.test(target.label);
  const requiresConfirmation = risk !== "none" || typingSecret;

  return {
    action,
    ...(target ? { node: target.node } : {}),
    operation,
    ...(target ? { target } : {}),
    risk,
    blocker,
    mustHandOff: MUST_HAND_OFF.includes(blocker) || typingSecret,
    operationConfidence: opAnswer.probabilities?.[opAnswer.choice],
    targetConfidence,
    selfConfidence: opAnswer.confidence,
    requiresConfirmation,
    latencyMs: r.latencyMs,
    costUsd: r.costUsd,
    inputTokens: r.usage.inputTokens,
  };
}

/** Names the head that is too uncertain to act on, or null when both are fine. */
export function escalationReason(d: Decision, threshold = ACT_THRESHOLD): string | null {
  if (d.operationConfidence !== undefined && d.operationConfidence < threshold) {
    return `operation ${d.operation} at p=${d.operationConfidence.toFixed(2)}`;
  }
  if (d.targetConfidence !== undefined && d.targetConfidence < threshold) {
    return `target at p=${d.targetConfidence.toFixed(2)}`;
  }
  return null;
}

export function shouldEscalate(d: Decision, threshold = ACT_THRESHOLD): boolean {
  return escalationReason(d, threshold) !== null;
}

function toAction(operation: Operation, target?: TargetEntry, file = ""): Action {
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
    case "ATTACH":
      if (!target) throw new Error("ATTACH without a target");
      return { kind: "attach", eid: target.eid, file };
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
