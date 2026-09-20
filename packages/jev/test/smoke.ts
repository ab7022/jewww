/**
 * Live smoke test. Confirms the key works and answers the three open questions the
 * plan flagged, which no amount of reading docs could settle:
 *
 *   1. What does JEV actually cost per million input tokens?
 *   2. Which exact model build serves `jev-1.13`?
 *   3. Does a `choice` answer carry a probability distribution?
 *
 * Question 3 matters most: the escalation threshold is the entire reason we picked
 * JEV over a small LLM, and it reads that distribution.
 *
 *   pnpm smoke                 # openrouter
 *   pnpm smoke -- --vercel     # cross-check
 */
import { confidenceOf } from "@jev-browser/shared";
import { fromEnv } from "../src/index.js";

const useVercel = process.argv.includes("--vercel");
const provider = fromEnv(useVercel ? "vercel" : "openrouter");

const result = await provider.evaluate(
  {
    ticket: "I was charged twice for my subscription and I want my money back.",
    elements: [
      { eid: "e1", role: "button", name: "Request refund" },
      { eid: "e2", role: "link", name: "Contact support" },
      { eid: "e3", role: "button", name: "Close" },
    ],
  },
  {
    refund: {
      type: "boolean",
      instructions: "Is the customer asking for money back?",
    },
    target: {
      type: "choice",
      instructions: "Which element best resolves the ticket?",
      criteria: {
        e1: "button: Request refund",
        e2: "link: Contact support",
        e3: "button: Close",
      },
    },
    urgency: {
      type: "score",
      instructions: "How urgent is this ticket?",
      criteria: ["low", "medium", "high"],
    },
  },
);

const { answers, usage, costUsd, model, latencyMs } = result;
const perMillion = usage.inputTokens > 0 ? (costUsd / usage.inputTokens) * 1_000_000 : 0;
const choiceHasProbs = answers.target.probabilities !== undefined;

console.log(`\nprovider      ${provider.name}`);
console.log(`model build   ${model}`);
console.log(`latency       ${latencyMs}ms`);
console.log(`tokens        ${usage.inputTokens} in / ${usage.outputTokens} out`);
console.log(`cost          $${costUsd}  ->  $${perMillion.toFixed(3)}/M input`);
console.log(`\nanswers`);
console.log(`  refund      p(true)=${answers.refund.probability}`);
console.log(`  target      ${answers.target.choice}  conf=${confidenceOf(answers.target) ?? "n/a"}`);
console.log(`  urgency     ${answers.urgency.score}`);

console.log(`\n--- open questions ---`);
console.log(`cost/M input        $${perMillion.toFixed(3)}`);
console.log(`exact build         ${model}`);
console.log(`choice probabilities ${choiceHasProbs ? "YES" : "NO"}`);

const problems: string[] = [];
if (answers.refund.probability < 0.8) problems.push("refund probability unexpectedly low");
if (answers.target.choice !== "e1") problems.push(`target picked ${answers.target.choice}, want e1`);
if (!choiceHasProbs)
  problems.push(
    "choice answers carry NO probabilities — the confidence gate has nothing to read. " +
      "Escalation would have to key off something else. This is architecturally significant.",
  );

if (problems.length) {
  console.log(`\nFINDINGS:`);
  for (const p of problems) console.log(`  ! ${p}`);
  process.exitCode = 1;
} else {
  console.log(`\nall good — key works, answers sane, probabilities present`);
}
