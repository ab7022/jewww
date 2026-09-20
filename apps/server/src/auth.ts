import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Store, User } from "./db.js";

/**
 * Google sign-in with our own sessions. No auth vendor.
 *
 * Access tokens are short-lived JWTs the client holds in memory. Refresh tokens are
 * long-lived opaque random strings, stored only as a SHA-256, so a leak of the
 * sessions collection cannot be replayed. The extension needs bearer tokens rather
 * than a cookie session, which is why this is token-shaped rather than cookie-shaped.
 */

const ACCESS_TTL_S = 60 * 60 * 12;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const b64url = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  ttlS = ACCESS_TTL_S,
): string {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlS };
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = `${head}.${b64url(JSON.stringify(body))}`;
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  // Constant-time: a plain string compare leaks how much of the signature matched.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
    if (typeof claims.exp === "number" && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");

export async function issueRefresh(store: Store, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await store.sessions.insertOne({
    _id: randomUUID(),
    userId,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    createdAt: new Date(),
  });
  return token;
}

export async function redeemRefresh(store: Store, token: string): Promise<string | null> {
  const session = await store.sessions.findOne({ tokenHash: hash(token) });
  if (!session || session.expiresAt < new Date()) return null;
  return session.userId;
}

export async function revokeRefresh(store: Store, token: string): Promise<void> {
  await store.sessions.deleteOne({ tokenHash: hash(token) });
}

/** New users start with enough credits to actually try the product. */
export const SIGNUP_CREDITS = 500;

export async function upsertGoogleUser(
  store: Store,
  profile: { sub: string; email: string; name?: string; picture?: string },
): Promise<User> {
  const existing = await store.users.findOne({ email: profile.email });
  if (existing) return existing;

  const now = new Date();
  const user: User = {
    _id: `u_${profile.sub}`,
    email: profile.email,
    ...(profile.name ? { name: profile.name } : {}),
    ...(profile.picture ? { picture: profile.picture } : {}),
    credits: SIGNUP_CREDITS,
    createdAt: now,
  };
  await store.users.insertOne(user);
  await store.ledger.insertOne({
    _id: randomUUID(),
    userId: user._id,
    kind: "topup",
    credits: SIGNUP_CREDITS,
    costUsd: 0,
    at: now,
  });
  return user;
}

// --- Google OAuth ---------------------------------------------------------

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleAuthUrl(cfg: GoogleConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(
  cfg: GoogleConfig,
  code: string,
): Promise<{ sub: string; email: string; name?: string; picture?: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("google returned no id_token");

  // This token came straight from Google's own endpoint, over TLS, in response to our
  // client_secret — the transport is the trust anchor. An id_token accepted from
  // anywhere else would have to be signature-verified against Google's JWKS.
  const body = id_token.split(".")[1];
  if (!body) throw new Error("malformed id_token");
  const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (!claims.email || claims.email_verified === false) {
    throw new Error("google account has no verified email");
  }
  return {
    sub: claims.sub,
    email: claims.email,
    ...(claims.name ? { name: claims.name } : {}),
    ...(claims.picture ? { picture: claims.picture } : {}),
  };
}
