import type { Decision, DecideInput, FieldMapping, TextContext } from "@jev-browser/policy";
import type { Plan } from "@jev-browser/shared";

/**
 * Server client.
 *
 * The extension holds NO model key — every model call is a server call, which is the
 * whole reason the server exists. It holds only a bearer token, and refreshes it
 * transparently when it expires.
 */
const TOKENS = "tokens";

interface Tokens {
  access: string;
  refresh: string;
}

export class Api {
  constructor(private readonly base: string) {}

  async tokens(): Promise<Tokens | null> {
    const stored = await chrome.storage.local.get(TOKENS);
    return (stored[TOKENS] as Tokens | undefined) ?? null;
  }

  async setTokens(tokens: Tokens | null): Promise<void> {
    if (tokens) await chrome.storage.local.set({ [TOKENS]: tokens });
    else await chrome.storage.local.remove(TOKENS);
  }

  /**
   * Sign in through the user's own browser via launchWebAuthFlow. The extension
   * never sees the Google password — it only receives our tokens back in the
   * redirect fragment.
   */
  /** What sign-in the server actually supports right now. */
  async config(): Promise<{ google: boolean; dev: boolean }> {
    const res = await fetch(`${this.base}/auth/config`);
    if (!res.ok) throw new Error("server unreachable");
    return (await res.json()) as { google: boolean; dev: boolean };
  }

  /** Local development sign-in, offered only when the server says it is available. */
  async signInDev(): Promise<void> {
    const res = await fetch(`${this.base}/auth/dev`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dev@localhost" }),
    });
    if (!res.ok) throw new Error("dev sign-in is not available on this server");
    const { access, refresh } = (await res.json()) as { access: string; refresh: string };
    await this.setTokens({ access, refresh });
  }

  async signIn(): Promise<void> {
    const redirect = chrome.identity.getRedirectURL("google");
    const url = `${this.base}/auth/google/start?redirect=${encodeURIComponent(redirect)}`;
    const done = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    if (!done) throw new Error("sign-in was cancelled");
    const fragment = new URL(done).hash.replace(/^#/, "");
    const params = new URLSearchParams(fragment);
    const access = params.get("access");
    const refresh = params.get("refresh");
    if (!access || !refresh) throw new Error("sign-in returned no tokens");
    await this.setTokens({ access, refresh });
  }

  async signOut(): Promise<void> {
    const tokens = await this.tokens();
    if (tokens) {
      await fetch(`${this.base}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: tokens.refresh }),
      }).catch(() => {});
    }
    await this.setTokens(null);
  }

  /** One retry after a refresh, so an expired access token is invisible to callers. */
  private async call<T>(path: string, body?: unknown, retried = false): Promise<T> {
    const tokens = await this.tokens();
    if (!tokens) throw new Error("not signed in");

    const res = await fetch(`${this.base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${tokens.access}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (res.status === 401 && !retried) {
      const refreshed = await fetch(`${this.base}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: tokens.refresh }),
      });
      if (!refreshed.ok) {
        await this.setTokens(null);
        throw new Error("session expired, sign in again");
      }
      const { access } = (await refreshed.json()) as { access: string };
      await this.setTokens({ ...tokens, access });
      return this.call<T>(path, body, true);
    }

    if (res.status === 402) {
      const { balance } = (await res.json()) as { balance: number };
      throw new Error(`out of credits (${balance} left)`);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      throw new Error(body.message ?? body.error ?? `${path} failed with ${res.status}`);
    }
    return (await res.json()) as T;
  }

  me = () =>
    this.call<{ email: string; credits: number; approxTasks: number }>("/api/me");

  createRun = (goal: string, url: string) =>
    this.call<{ runId: string; plan: Plan; stated?: Record<string, string>; balance: number }>(
      "/api/runs",
      { goal, url },
    );

  decide = async (runId: string, nodeId: string, input: DecideInput): Promise<Decision> =>
    (
      await this.call<{ decision: Decision }>(`/api/runs/${runId}/decide`, {
        nodeId,
        subgoal: input.subgoal,
        success: input.success,
        snapshot: input.snapshot,
        nodes: input.nodes,
        recent: input.recent,
      })
    ).decision;

  text = async (runId: string, ctx: TextContext): Promise<string | null> =>
    (await this.call<{ text: string | null }>(`/api/runs/${runId}/text`, ctx)).text;

  extract = async (runId: string, intent: string, schema: unknown, pageText: string) =>
    (await this.call<{ value: unknown }>(`/api/runs/${runId}/extract`, { intent, schema, pageText }))
      .value;

  compose = async (runId: string, intent: string, inputs: Record<string, unknown>, goal: string) =>
    (await this.call<{ value: unknown }>(`/api/runs/${runId}/compose`, { intent, inputs, goal })).value;

  mapFields = async (runId: string, input: unknown): Promise<FieldMapping[]> =>
    (await this.call<{ mappings: FieldMapping[] }>(`/api/runs/${runId}/fields`, input)).mappings;

  profile = async (): Promise<{ fields: Record<string, string>; instructions: string }> => {
    const r = await this.call<{ fields: Record<string, string>; instructions?: string }>(
      "/api/profile",
    );
    return { fields: r.fields ?? {}, instructions: r.instructions ?? "" };
  };

  saveProfile = async (fields: Record<string, string>, instructions: string): Promise<void> => {
    const tokens = await this.tokens();
    if (!tokens) throw new Error("not signed in");
    const res = await fetch(`${this.base}/api/profile`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${tokens.access}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields, instructions }),
    });
    if (!res.ok) throw new Error("could not save your details");
  };

  finish = (runId: string, status: string) =>
    this.call<{ ok: true }>(`/api/runs/${runId}/finish`, { status });
}
