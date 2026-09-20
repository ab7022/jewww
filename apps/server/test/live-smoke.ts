/**
 * Live end-to-end check of the server: real plan, real metering, real ledger.
 * Costs a few credits. Google sign-in is bypassed by inserting a user directly —
 * that path is exercised by the unit tests.
 */
import { randomUUID } from "node:crypto";
import { signJwt } from "../src/auth.js";
import { connect } from "../src/db.js";

const base = process.env.BASE ?? "http://localhost:8787";
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("JWT_SECRET is not set");

const store = await connect(process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017");
const id = `u_smoke_${randomUUID().slice(0, 8)}`;
await store.users.insertOne({
  _id: id, email: `${id}@t.test`, credits: 500, createdAt: new Date(),
});
const auth = { Authorization: `Bearer ${signJwt({ sub: id }, secret)}`, "Content-Type": "application/json" };

const me = await (await fetch(`${base}/api/me`, { headers: auth })).json();
console.log(`me         ${me.credits} credits  (~${me.approxTasks} tasks)`);

const res = await fetch(`${base}/api/runs`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({
    goal: "find the pricing page and tell me what the pro plan costs",
    url: "https://vercel.com",
  }),
});
const run = await res.json();
if (!res.ok) throw new Error(`run failed ${res.status}: ${JSON.stringify(run)}`);
console.log(`run        ${run.runId}`);
console.log(`plan       ${run.plan.nodes.length} nodes: ${run.plan.nodes.map((n: { kind: string }) => n.kind).join(" -> ")}`);
console.log(`balance    ${me.credits} -> ${run.balance}  (spent ${(me.credits - run.balance).toFixed(3)})`);

const ledger = await (await fetch(`${base}/api/me/ledger`, { headers: auth })).json();
console.log(`ledger     ${ledger.entries.length} entr(ies): ${ledger.entries.map((e: { kind: string; credits: number }) => `${e.kind} ${e.credits.toFixed(3)}`).join(", ")}`);

const detail = await (await fetch(`${base}/api/runs/${run.runId}`, { headers: auth })).json();
console.log(`run row    status=${detail.run.status} creditsSpent=${detail.run.creditsSpent.toFixed(3)} steps=${detail.steps.length}`);

// Drain the balance and confirm the refusal is a clean 402.
await store.users.updateOne({ _id: id }, { $set: { credits: 0.5 } });
const broke = await fetch(`${base}/api/runs`, {
  method: "POST", headers: auth,
  body: JSON.stringify({ goal: "anything", url: "https://example.com" }),
});
console.log(`exhausted  HTTP ${broke.status} ${JSON.stringify(await broke.json())}`);

await store.users.deleteOne({ _id: id });
await store.close();
console.log(broke.status === 402 ? "\nall good" : "\nFINDING: exhausted balance did not return 402");
process.exitCode = broke.status === 402 ? 0 : 1;
