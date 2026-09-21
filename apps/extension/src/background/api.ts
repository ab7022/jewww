import type { Capabilities } from "@jev-browser/runtime";
import { ApiClient, type RunOutcome, type TokenStore, type Tokens } from "@jev-browser/protocol";

/**
 * The extension's view of the server.
 *
 * Every endpoint call goes through `ApiClient`, whose request and result types come
 * from the same table the server registers its handlers from — the extension no longer
 * spells out any request shape itself. That is what stopped the drift: the subgoal in
 * the `nodeId` slot, `attachable` never forwarded, a profile read in its old shape.
 *
 * The extension holds NO model key. It holds a bearer token and a refresh token, and
 * refreshes transparently.
 */
const TOKENS = "tokens";

const chromeTokens: TokenStore = {
  async get() {
    const stored = await chrome.storage.local.get(TOKENS);
    return (stored[TOKENS] as Tokens | undefined) ?? null;
  },
  async set(tokens) {
    if (tokens) await chrome.storage.local.set({ [TOKENS]: tokens });
    else await chrome.storage.local.remove(TOKENS);
  },
};

export class Api {
  readonly client: ApiClient;

  constructor(private readonly base: string) {
    this.client = new ApiClient(base, chromeTokens);
  }

  tokens(): Promise<Tokens | null> {
    return chromeTokens.get();
  }

  config() {
    return this.client.call("authConfig");
  }

  /** Local development sign-in, offered only when the server says it is available. */
  async signInDev(): Promise<void> {
    const res = await fetch(`${this.base}/auth/dev`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dev@localhost" }),
    });
    if (!res.ok) throw new Error("dev sign-in is not available on this server");
    const { access, refresh } = (await res.json()) as Tokens;
    await chromeTokens.set({ access, refresh });
  }

  /**
   * Sign in through the user's own browser via launchWebAuthFlow. The extension never
   * sees the Google password — only our tokens, in the redirect fragment. The server
   * accepts this redirect only for an allow-listed extension id.
   */
  async signIn(): Promise<void> {
    const redirect = chrome.identity.getRedirectURL("google");
    const url = `${this.base}/auth/google/start?redirect=${encodeURIComponent(redirect)}`;
    const done = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    if (!done) throw new Error("sign-in was cancelled");
    const params = new URLSearchParams(new URL(done).hash.replace(/^#/, ""));
    const access = params.get("access");
    const refresh = params.get("refresh");
    if (!access || !refresh) throw new Error("sign-in returned no tokens");
    await chromeTokens.set({ access, refresh });
  }

  async signOut(): Promise<void> {
    const tokens = await chromeTokens.get();
    if (tokens) {
      await fetch(`${this.base}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: tokens.refresh }),
      }).catch(() => {});
    }
    await chromeTokens.set(null);
  }

  me() {
    return this.client.call("me");
  }

  createRun(goal: string, url: string) {
    return this.client.call("createRun", { goal, url });
  }

  finish(runId: string, status: RunOutcome, steps: number, summary?: string) {
    return this.client.call(
      "finish",
      { id: runId },
      { status, steps, ...(summary ? { summary: summary.slice(0, 8000) } : {}) },
    );
  }

  profile() {
    return this.client.call("getProfile");
  }

  saveProfile(fields: Record<string, string>, instructions: string) {
    return this.client.call("putProfile", { fields, instructions });
  }

  /**
   * The runtime's capabilities for one run, routed through the server. The goal and the
   * user's instructions are NOT sent: the server reads them from the run itself.
   */
  capabilities(runId: string): Capabilities {
    const id = { id: runId };
    return {
      decide: async (request) => (await this.client.call("decide", id, request)).decision,
      text: async (request) => (await this.client.call("text", id, request)).text,
      extract: async (request) => (await this.client.call("extract", id, request)).value,
      compose: async (request) => (await this.client.call("compose", id, request)).value,
      explain: async (request) => (await this.client.call("explain", id, request)).explanation,
      mapFields: async (request) => {
        const r = await this.client.call("fields", id, request);
        return { mappings: r.mappings, costUsd: r.costUsd };
      },
    };
  }
}
