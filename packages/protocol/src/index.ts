import type { Decision, FieldMapping } from "@jev-browser/policy";
import {
  CheckoutRequest,
  ComposeRequest,
  type OrderSummary,
  type Pack,
  ReconcileRequest,
  CreateRunRequest,
  DecideRequest,
  type Explanation,
  ExplainRequest,
  ExtractRequest,
  FinishRunRequest,
  MapFieldsRequest,
  ProfileUpdate,
  type RunContext,
  type RunOutcome,
  TextRequest,
} from "@jev-browser/shared";
import type { z } from "zod";

/**
 * The API, as ONE table.
 *
 * The server registers its handlers from this table and parses every body with the
 * schema listed here; every client — the extension, the website, the tests — calls
 * through `ApiClient`, whose argument and result types come from the same table.
 * Neither side is written by hand, so they cannot drift.
 *
 * They did drift, repeatedly, while each side was hand-written: the extension sent
 * the subgoal in the `nodeId` slot; the server never forwarded `attachable`, so the
 * resume could not be uploaded through the extension at all; a profile response
 * changed shape and the extension kept reading the old one.
 */

export interface Me {
  id: string;
  email: string;
  name?: string;
  credits: number;
  /** The balance in the unit a person cares about. */
  approxTasks: number;
}

export interface RunSummary {
  id: string;
  goal: string;
  startUrl: string;
  status: string;
  creditsSpent: number;
  steps: number;
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  fields: Record<string, string>;
  instructions: string;
}

export interface LedgerEntry {
  kind: string;
  credits: number;
  runId?: string;
  at: string;
}

/** name → path params, request body and response. */
export interface Endpoints {
  authConfig: { params: Record<never, never>; body: undefined; result: { google: boolean; dev: boolean } };
  me: { params: Record<never, never>; body: undefined; result: Me };
  ledger: { params: Record<never, never>; body: undefined; result: { entries: LedgerEntry[] } };
  listRuns: { params: Record<never, never>; body: undefined; result: { runs: RunSummary[] } };
  getRun: { params: { id: string }; body: undefined; result: { run: RunSummary; steps: unknown[] } };
  createRun: { params: Record<never, never>; body: CreateRunRequest; result: RunContext };
  decide: { params: { id: string }; body: DecideRequest; result: { decision: Decision; balance: number } };
  text: { params: { id: string }; body: TextRequest; result: { text: string | null; balance: number } };
  extract: { params: { id: string }; body: ExtractRequest; result: { value: unknown; balance: number } };
  compose: { params: { id: string }; body: ComposeRequest; result: { value: unknown; balance: number } };
  explain: { params: { id: string }; body: ExplainRequest; result: { explanation: Explanation; balance: number } };
  fields: {
    params: { id: string };
    body: MapFieldsRequest;
    result: { mappings: FieldMapping[]; costUsd: number; balance: number };
  };
  finish: { params: { id: string }; body: FinishRunRequest; result: { ok: true } };
  billing: { params: Record<never, never>; body: undefined; result: { enabled: boolean; mode: "test" | "live" | null; packs: Pack[] } };
  checkout: { params: Record<never, never>; body: CheckoutRequest; result: { orderId: string; url: string } };
  listOrders: { params: Record<never, never>; body: undefined; result: { orders: OrderSummary[] } };
  reconcileOrder: { params: { id: string }; body: ReconcileRequest; result: { order: OrderSummary; credits: number } };
  getProfile: { params: Record<never, never>; body: undefined; result: Profile };
  putProfile: { params: Record<never, never>; body: ProfileUpdate; result: { ok: true } };
}

export type EndpointName = keyof Endpoints;

export interface Route {
  method: "GET" | "POST" | "PUT";
  path: string;
  /** The body schema, or null for a request without one. */
  schema: z.ZodType | null;
}

export const ROUTES: { readonly [K in EndpointName]: Route } = {
  authConfig: { method: "GET", path: "/auth/config", schema: null },
  me: { method: "GET", path: "/api/me", schema: null },
  ledger: { method: "GET", path: "/api/me/ledger", schema: null },
  listRuns: { method: "GET", path: "/api/runs", schema: null },
  getRun: { method: "GET", path: "/api/runs/:id", schema: null },
  createRun: { method: "POST", path: "/api/runs", schema: CreateRunRequest },
  decide: { method: "POST", path: "/api/runs/:id/decide", schema: DecideRequest },
  text: { method: "POST", path: "/api/runs/:id/text", schema: TextRequest },
  extract: { method: "POST", path: "/api/runs/:id/extract", schema: ExtractRequest },
  compose: { method: "POST", path: "/api/runs/:id/compose", schema: ComposeRequest },
  explain: { method: "POST", path: "/api/runs/:id/explain", schema: ExplainRequest },
  fields: { method: "POST", path: "/api/runs/:id/fields", schema: MapFieldsRequest },
  finish: { method: "POST", path: "/api/runs/:id/finish", schema: FinishRunRequest },
  billing: { method: "GET", path: "/api/billing", schema: null },
  checkout: { method: "POST", path: "/api/billing/checkout", schema: CheckoutRequest },
  listOrders: { method: "GET", path: "/api/orders", schema: null },
  reconcileOrder: { method: "POST", path: "/api/orders/:id/reconcile", schema: ReconcileRequest },
  getProfile: { method: "GET", path: "/api/profile", schema: null },
  putProfile: { method: "PUT", path: "/api/profile", schema: ProfileUpdate },
};

export type { OrderSummary, RunOutcome };

// --- client ------------------------------------------------------------------

export interface Tokens {
  access: string;
  /** Empty when the refresh token lives in an httpOnly cookie (the website). */
  refresh: string;
}

/** Where a client keeps its tokens: chrome.storage, memory, … */
export interface TokenStore {
  get(): Promise<Tokens | null>;
  set(tokens: Tokens | null): Promise<void>;
}

/** An API failure with the server's own error code, so callers can branch on it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function fillPath(path: string, params: Record<string, string>): string {
  return path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`missing path parameter "${key}" for ${path}`);
    return encodeURIComponent(value);
  });
}

type CallArgs<K extends EndpointName> = Endpoints[K]["body"] extends undefined
  ? keyof Endpoints[K]["params"] extends never
    ? []
    : [params: Endpoints[K]["params"]]
  : keyof Endpoints[K]["params"] extends never
    ? [body: Endpoints[K]["body"]]
    : [params: Endpoints[K]["params"], body: Endpoints[K]["body"]];

export class ApiClient {
  constructor(
    private readonly base: string,
    private readonly tokens: TokenStore,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  /** Call an endpoint by name. Params and body are typed from `Endpoints`. */
  async call<K extends EndpointName>(name: K, ...args: CallArgs<K>): Promise<Endpoints[K]["result"]> {
    const route = ROUTES[name];
    const takesParams = route.path.includes(":");
    const params = (takesParams ? args[0] : {}) as Record<string, string>;
    const body = route.schema ? (takesParams ? args[1] : args[0]) : undefined;
    // Validated on the way OUT too: a malformed request is a bug here, and failing
    // before the network says so far more clearly than a 400 would.
    if (route.schema) route.schema.parse(body);
    return this.send<Endpoints[K]["result"]>(route, fillPath(route.path, params), body, false);
  }

  private async send<T>(route: Route, path: string, body: unknown, retried: boolean): Promise<T> {
    const tokens = await this.tokens.get();
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: route.method,
      credentials: "include",
      headers: {
        ...(tokens?.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (res.status === 401 && !retried && tokens) {
      if (await this.refresh(tokens)) return this.send<T>(route, path, body, true);
      await this.tokens.set(null);
      throw new ApiError(401, "session_expired", "Your session ended — sign in again.");
    }

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = String(payload.error ?? `http_${res.status}`);
      if (res.status === 402) {
        throw new ApiError(402, code, `Out of credits (${Number(payload.balance ?? 0)} left).`, payload);
      }
      const message = String(payload.message ?? payload.error ?? `${path} failed with ${res.status}`);
      throw new ApiError(res.status, code, message, payload.issues ?? payload.detail);
    }
    return payload as T;
  }

  /** Exchange the refresh token (body or cookie) for a new access token. */
  private async refresh(tokens: Tokens): Promise<boolean> {
    const res = await this.fetchImpl(`${this.base}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokens.refresh ? { refresh: tokens.refresh } : {}),
    });
    if (!res.ok) return false;
    const { access } = (await res.json()) as { access: string };
    await this.tokens.set({ ...tokens, access });
    return true;
  }
}
