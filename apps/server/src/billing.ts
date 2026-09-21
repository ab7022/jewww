import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { type Pack, packById, PACKS } from "@jev-browser/shared";
import { z } from "zod";
import type { LedgerEntry, Order, Store, User } from "./db.js";

/**
 * Payments, through Dodo Payments (merchant of record: it collects the money, handles
 * tax and sends the receipt). We never see a card.
 *
 * The rules this file exists to keep:
 *
 * - **Credits come from our table, not from the payment.** An order records the pack
 *   the person chose; a successful payment for THAT order grants THAT pack's credits.
 *   Nothing in a webhook body or a redirect decides how many credits anyone gets.
 * - **A payment is believed only when Dodo says so.** Either a webhook whose signature
 *   verifies against our secret, or a payment we fetched from Dodo's API ourselves. The
 *   `status=succeeded` in the return URL is for display, never for crediting.
 * - **Crediting happens once.** Webhooks are retried and the return page reconciles
 *   too, so the same success can arrive several times. The grant is one atomic update
 *   guarded by the order id, so every delivery after the first changes nothing.
 */

export interface DodoConfig {
  apiKey: string;
  /** `whsec_…` — from the Dodo dashboard's webhook settings. */
  webhookSecret: string;
  mode: "test" | "live";
  /** Dodo product id (`pdt_…`) for each pack. Its price is what is charged. */
  products: Record<Pack["id"], string>;
}

export const dodoBase = (mode: DodoConfig["mode"]) =>
  mode === "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com";

/** Read from the environment; undefined (payments off) unless ALL of it is present. */
export function dodoFromEnv(env: NodeJS.ProcessEnv = process.env): DodoConfig | undefined {
  const products = {
    starter: env.DODO_PRODUCT_STARTER,
    pro: env.DODO_PRODUCT_PRO,
    team: env.DODO_PRODUCT_TEAM,
  };
  if (!env.DODO_API_KEY || !env.DODO_WEBHOOK_SECRET || Object.values(products).some((p) => !p)) return undefined;
  return {
    apiKey: env.DODO_API_KEY,
    webhookSecret: env.DODO_WEBHOOK_SECRET,
    mode: env.DODO_MODE === "live" ? "live" : "test",
    products: products as Record<Pack["id"], string>,
  };
}

// --- webhook signatures (Standard Webhooks) -----------------------------------

/** How old a delivery may be. Bounds replay of a captured request. */
export const WEBHOOK_TOLERANCE_S = 5 * 60;

/**
 * Standard Webhooks: HMAC-SHA256 over `${id}.${timestamp}.${body}` with the secret's
 * base64 payload as the key; the header is a space-separated list of `v1,<base64>`
 * (several during a secret rotation). The body must be the RAW bytes received —
 * re-serialising parsed JSON changes them and every signature fails.
 */
export function verifyWebhook(
  secret: string,
  headers: { id?: string | undefined; timestamp?: string | undefined; signature?: string | undefined },
  rawBody: string,
  nowMs = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > WEBHOOK_TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Sign as Dodo would — for tests, and for exercising a local webhook by hand. */
export function signWebhook(secret: string, id: string, timestamp: string, rawBody: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64")}`;
}

// --- Dodo's API ---------------------------------------------------------------

/** The fields of a Dodo Payment we rely on. Anything else it carries is ignored. */
export const DodoPayment = z.object({
  payment_id: z.string(),
  status: z.string().nullish(),
  total_amount: z.number().nullish(),
  currency: z.string().nullish(),
  checkout_session_id: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  product_cart: z.array(z.object({ product_id: z.string(), quantity: z.number().optional() })).nullish(),
});
export type DodoPayment = z.infer<typeof DodoPayment>;

export const DodoEvent = z.object({
  type: z.string(),
  data: z.unknown(),
});

export class PaymentsUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentsUnavailable";
  }
}

async function dodo(cfg: DodoConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${dodoBase(cfg.mode)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.apiKey}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new PaymentsUnavailable(`payments provider answered ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

// --- orders -------------------------------------------------------------------

/** Start a purchase: an order row first, then Dodo's hosted checkout for it. */
export async function startCheckout(
  store: Store,
  cfg: DodoConfig,
  user: User,
  packId: string,
  returnTo: string,
): Promise<{ orderId: string; url: string }> {
  const pack = packById(packId);
  if (!pack) throw new Error(`no pack "${packId}"`);
  const now = new Date();
  const order: Order = {
    _id: randomUUID(),
    userId: user._id,
    packId: pack.id,
    credits: pack.credits,
    priceUsd: pack.priceUsd,
    status: "pending",
    provider: "dodo",
    mode: cfg.mode,
    createdAt: now,
    updatedAt: now,
  };
  await store.orders.insertOne(order);

  const session = z
    .object({ session_id: z.string(), checkout_url: z.string().url() })
    .parse(
      await dodo(cfg, "POST", "/checkouts", {
        product_cart: [{ product_id: cfg.products[pack.id], quantity: 1 }],
        customer: { email: user.email, ...(user.name ? { name: user.name } : {}) },
        // Dodo appends ?payment_id=…&status=… — the page reconciles with the id.
        return_url: `${returnTo}${returnTo.includes("?") ? "&" : "?"}order=${order._id}`,
        metadata: { order_id: order._id, user_id: user._id, pack_id: pack.id },
      }),
    );
  await store.orders.updateOne({ _id: order._id }, { $set: { sessionId: session.session_id, updatedAt: new Date() } });
  return { orderId: order._id, url: session.checkout_url };
}

export async function fetchPayment(cfg: DodoConfig, paymentId: string): Promise<DodoPayment> {
  return DodoPayment.parse(await dodo(cfg, "GET", `/payments/${encodeURIComponent(paymentId)}`));
}

export type Settlement = "credited" | "already" | "recorded" | "mismatch" | "unknown-order";

/**
 * Apply what Dodo reported about a payment to its order. Safe to call any number of
 * times with the same payment: the grant is guarded by the order id on the user row.
 */
export async function settle(store: Store, cfg: DodoConfig, payment: DodoPayment): Promise<Settlement> {
  const orderId = typeof payment.metadata?.order_id === "string" ? payment.metadata.order_id : undefined;
  if (!orderId) return "unknown-order";
  const order = await store.orders.findOne({ _id: orderId });
  if (!order) return "unknown-order";

  // The payment must be for THIS order's checkout and THIS pack's product. A valid
  // payment for a $9 pack must not settle an order for the $99 one.
  const product = cfg.products[order.packId];
  const sessionMatches = !order.sessionId || !payment.checkout_session_id || payment.checkout_session_id === order.sessionId;
  const productMatches = !payment.product_cart?.length || payment.product_cart.some((p) => p.product_id === product);
  if (!sessionMatches || !productMatches) {
    console.error(`payment ${payment.payment_id} does not match order ${orderId}`);
    return "mismatch";
  }

  const now = new Date();
  const facts = {
    paymentId: payment.payment_id,
    ...(payment.total_amount != null ? { amount: payment.total_amount } : {}),
    ...(payment.currency ? { currency: payment.currency } : {}),
    updatedAt: now,
  };

  if (payment.status !== "succeeded") {
    const status = payment.status === "failed" ? "failed" : payment.status === "cancelled" ? "cancelled" : undefined;
    // A late failure never overwrites a success.
    if (status) await store.orders.updateOne({ _id: orderId, status: { $ne: "paid" } }, { $set: { status, ...facts } });
    return "recorded";
  }

  // The grant: one atomic update of one document, which cannot apply twice.
  const granted = await store.users.updateOne(
    { _id: order.userId, creditedOrders: { $ne: orderId } },
    { $inc: { credits: order.credits }, $push: { creditedOrders: orderId } },
  );
  // Written after the grant, and idempotently, so a crash between the two is repaired
  // by the next delivery rather than leaving a paid order that looks unpaid.
  await store.ledger.updateOne(
    { _id: `order:${orderId}` },
    {
      $setOnInsert: {
        userId: order.userId,
        kind: "topup",
        credits: order.credits,
        costUsd: 0,
        orderId,
        at: now,
      } satisfies Omit<LedgerEntry, "_id">,
    },
    { upsert: true },
  );
  await store.orders.updateOne(
    { _id: orderId },
    { $set: { status: "paid", ...facts, paidAt: order.paidAt ?? now } },
  );
  return granted.modifiedCount === 1 ? "credited" : "already";
}

export function invoiceUrl(cfg: DodoConfig | undefined, order: Order): string | undefined {
  if (!order.paymentId || order.status !== "paid") return undefined;
  return `${dodoBase(order.mode ?? cfg?.mode ?? "test")}/invoices/payments/${encodeURIComponent(order.paymentId)}`;
}

export { PACKS };
