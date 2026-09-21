/**
 * What can be bought, defined once. The server credits an account from THIS table —
 * never from an amount a client or a webhook body claims — and the website renders its
 * pricing from it, so what is shown and what is granted cannot disagree.
 *
 * 1 credit = $0.001 of model usage. A ten-step task is typically 10–20 credits.
 */
export const SIGNUP_CREDITS = 500;

export interface Pack {
  id: "starter" | "pro" | "team";
  name: string;
  credits: number;
  /** Display price in US dollars. The charged price is the payment product's own. */
  priceUsd: number;
  /** Roughly how many ordinary tasks it covers, at ~16 credits each. */
  tasks: number;
  pitch: string;
  popular?: boolean;
}

export const PACKS: readonly Pack[] = [
  { id: "starter", name: "Starter", credits: 10_000, priceUsd: 9, tasks: 600, pitch: "For the weekly chores you keep putting off." },
  { id: "pro", name: "Pro", credits: 40_000, priceUsd: 29, tasks: 2_500, pitch: "For someone who lives in tabs all day.", popular: true },
  { id: "team", name: "Team", credits: 150_000, priceUsd: 99, tasks: 9_000, pitch: "Share across a team's ops, sales and support work." },
];

export const packById = (id: string): Pack | undefined => PACKS.find((p) => p.id === id);
