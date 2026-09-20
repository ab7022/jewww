import { type Collection, type Db, MongoClient } from "mongodb";

/** Collections. No ODM — the driver is enough and the shapes are small. */

export interface User {
  _id: string;
  email: string;
  name?: string;
  picture?: string;
  /** Balance in credits. 1 credit = $0.001 of underlying model spend. */
  credits: number;
  createdAt: Date;
}

export interface Session {
  _id: string;
  userId: string;
  /** SHA-256 of the refresh token. The token itself is never stored, so a dump of
   *  this collection cannot be replayed. */
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

/** Append-only. Every model call lands here. */
export interface LedgerEntry {
  _id: string;
  userId: string;
  runId?: string;
  kind: "plan" | "decide" | "text" | "extract" | "compose" | "topup";
  /** Negative for spend, positive for a top-up. */
  credits: number;
  costUsd: number;
  at: Date;
}

export interface Run {
  _id: string;
  userId: string;
  goal: string;
  startUrl: string;
  status: "running" | "done" | "blocked" | "suspended" | "budget";
  creditsSpent: number;
  createdAt: Date;
  updatedAt: Date;
}

/** One row per decision: the audit trail, and later the eval set. */
export interface Step {
  _id: string;
  runId: string;
  userId: string;
  nodeId: string;
  operation: string;
  target?: string;
  risk: string;
  confidence?: number;
  selfConfidence?: number;
  requiresConfirmation: boolean;
  url: string;
  contentHash: string;
  inputTokens: number;
  costUsd: number;
  latencyMs: number;
  at: Date;
}

export interface Profile {
  _id: string;
  userId: string;
  fields: Record<string, string>;
  updatedAt: Date;
}

export interface Store {
  db: Db;
  users: Collection<User>;
  sessions: Collection<Session>;
  ledger: Collection<LedgerEntry>;
  runs: Collection<Run>;
  steps: Collection<Step>;
  profiles: Collection<Profile>;
  close(): Promise<void>;
}

export async function connect(uri: string, dbName = "jevbrowser"): Promise<Store> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const store: Store = {
    db,
    users: db.collection<User>("users"),
    sessions: db.collection<Session>("sessions"),
    ledger: db.collection<LedgerEntry>("ledger"),
    runs: db.collection<Run>("runs"),
    steps: db.collection<Step>("steps"),
    profiles: db.collection<Profile>("profiles"),
    close: () => client.close(),
  };

  await Promise.all([
    store.users.createIndex({ email: 1 }, { unique: true }),
    store.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    // Mongo evicts expired sessions for us.
    store.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    store.ledger.createIndex({ userId: 1, at: -1 }),
    store.runs.createIndex({ userId: 1, createdAt: -1 }),
    store.steps.createIndex({ runId: 1, at: 1 }),
    store.profiles.createIndex({ userId: 1 }, { unique: true }),
  ]);

  return store;
}
