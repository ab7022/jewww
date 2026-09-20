import { randomUUID } from "node:crypto";
import type { LedgerEntry, Store } from "./db.js";

/**
 * Credits.
 *
 * Denominated so a user can reason about them: **1 credit = $0.001 of underlying
 * model spend**. Raw dollars are the wrong unit to show someone and token counts are
 * worse. Phase 1 measurements make it concrete — a plan is ~1.4 credits, a decision
 * ~0.2, a field-mapping call ~0.3, a 20-step task ~13.
 */
export const USD_PER_CREDIT = 0.001;

export const toCredits = (costUsd: number): number =>
  Math.max(0, Math.ceil((costUsd / USD_PER_CREDIT) * 1000) / 1000);

export class InsufficientCredits extends Error {
  constructor(readonly balance: number) {
    super("insufficient credits");
    this.name = "InsufficientCredits";
  }
}

/**
 * Charge a user for one model call.
 *
 * The balance check and the decrement are ONE atomic findOneAndUpdate. A
 * read-then-write lets two concurrent runs both observe a positive balance and both
 * spend it — the exact bug you cannot ship in something that bills people.
 */
export async function meter(
  store: Store,
  userId: string,
  kind: LedgerEntry["kind"],
  costUsd: number,
  runId?: string,
): Promise<{ credits: number; balance: number }> {
  const credits = toCredits(costUsd);

  const updated = await store.users.findOneAndUpdate(
    { _id: userId, credits: { $gte: credits } },
    { $inc: { credits: -credits } },
    { returnDocument: "after" },
  );
  if (!updated) {
    const user = await store.users.findOne({ _id: userId });
    throw new InsufficientCredits(user?.credits ?? 0);
  }

  await store.ledger.insertOne({
    _id: randomUUID(),
    userId,
    ...(runId ? { runId } : {}),
    kind,
    credits: -credits,
    costUsd,
    at: new Date(),
  } as LedgerEntry);

  if (runId) {
    await store.runs.updateOne(
      { _id: runId },
      { $inc: { creditsSpent: credits }, $set: { updatedAt: new Date() } },
    );
  }
  return { credits, balance: updated.credits };
}

/**
 * Refuse before doing expensive work, so an empty balance yields a clean 402 rather
 * than a half-finished run. The atomic check in `meter` is what actually protects the
 * balance; this only avoids wasting a call.
 */
export async function assertBalance(store: Store, userId: string, atLeast = 1): Promise<number> {
  const user = await store.users.findOne({ _id: userId });
  if (!user) throw new InsufficientCredits(0);
  if (user.credits < atLeast) throw new InsufficientCredits(user.credits);
  return user.credits;
}

export async function topUp(store: Store, userId: string, credits: number): Promise<number> {
  const updated = await store.users.findOneAndUpdate(
    { _id: userId },
    { $inc: { credits } },
    { returnDocument: "after" },
  );
  if (!updated) throw new Error("no such user");
  await store.ledger.insertOne({
    _id: randomUUID(),
    userId,
    kind: "topup",
    credits,
    costUsd: 0,
    at: new Date(),
  } as LedgerEntry);
  return updated.credits;
}
