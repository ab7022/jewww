import type { OrderSummary } from "@jev-browser/protocol";
import type { Pack } from "@jev-browser/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../session.js";

/**
 * Credits and orders.
 *
 * Buying hands off to Dodo's hosted checkout — no card field ever exists on our pages.
 * Coming back, the page asks OUR server to confirm the payment with Dodo; the
 * `status=succeeded` Dodo puts on the return URL is never taken at its word.
 */

type Confirming =
  | { state: "idle" }
  | { state: "checking"; order: string }
  | { state: "done"; order: OrderSummary }
  | { state: "slow"; order: string };

const STATUS: Record<OrderSummary["status"], { text: string; tone: string }> = {
  paid: { text: "Paid", tone: "good" },
  pending: { text: "Awaiting payment", tone: "" },
  failed: { text: "Failed", tone: "bad" },
  cancelled: { text: "Cancelled", tone: "" },
};

export function Billing({ onCredits }: { onCredits: () => void }) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"test" | "live" | null>(null);
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming>({ state: "idle" });

  const loadOrders = useCallback(async () => {
    setOrders((await api.call("listOrders")).orders);
  }, []);

  useEffect(() => {
    api
      .call("billing")
      .then((b) => {
        setPacks(b.packs);
        setEnabled(b.enabled);
        setMode(b.mode);
      })
      .catch((e: unknown) => setError(message(e)));
    void loadOrders().catch((e: unknown) => setError(message(e)));
  }, [loadOrders]);

  // Back from checkout: ?order=…&payment_id=…&status=…
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const order = q.get("order");
    if (!order) return;
    const paymentId = q.get("payment_id") ?? undefined;
    history.replaceState(null, "", location.pathname + location.hash);
    setConfirming({ state: "checking", order });
    document.getElementById("billing")?.scrollIntoView({ block: "start" });

    let alive = true;
    void (async () => {
      // Dodo may finish processing a moment after the redirect; ask a few times.
      for (let i = 0; i < 12 && alive; i++) {
        const r = await api.call("reconcileOrder", { id: order }, paymentId ? { paymentId } : {}).catch(() => null);
        if (r && r.order.status !== "pending") {
          if (!alive) return;
          setConfirming({ state: "done", order: r.order });
          onCredits();
          await loadOrders();
          return;
        }
        await new Promise((res) => setTimeout(res, 2500));
      }
      if (alive) setConfirming({ state: "slow", order });
    })();
    return () => {
      alive = false;
    };
  }, [loadOrders, onCredits]);

  const buy = async (pack: Pack) => {
    setError(null);
    setBuying(pack.id);
    try {
      const { url } = await api.call("checkout", { packId: pack.id });
      location.href = url;
    } catch (e) {
      setError(message(e));
      setBuying(null);
    }
  };

  return (
    <section className="panel span-2 billing" id="billing">
      <div className="billing-head">
        <h2>Credits &amp; orders</h2>
        {mode === "test" && <span className="pill warn">Test mode — use card 4242 4242 4242 4242</span>}
      </div>

      {confirming.state === "checking" && (
        <p className="banner">
          <span className="spinner" aria-hidden /> Confirming your payment with Dodo Payments…
        </p>
      )}
      {confirming.state === "done" && confirming.order.status === "paid" && (
        <p className="banner good">
          ✓ Payment received — {confirming.order.credits.toLocaleString()} credits added to your account.
        </p>
      )}
      {confirming.state === "done" && confirming.order.status !== "paid" && (
        <p className="banner bad">
          The payment {confirming.order.status === "cancelled" ? "was cancelled" : "didn't go through"}. Nothing was
          charged; you can try again below.
        </p>
      )}
      {confirming.state === "slow" && (
        <p className="banner">
          Still waiting to hear from the payment provider. Your credits appear here as soon as it confirms — no need to
          pay again.
        </p>
      )}

      <div className="packs">
        {packs.map((p) => (
          <article key={p.id} className={`pack ${p.popular ? "popular" : ""}`}>
            {p.popular && <span className="pack-flag">Most picked</span>}
            <h3>{p.name}</h3>
            <p className="pack-price">
              ${p.priceUsd}
              <span> one-time</span>
            </p>
            <p className="pack-credits">
              {p.credits.toLocaleString()} credits · about {p.tasks.toLocaleString()} tasks
            </p>
            <p className="fine">{p.pitch}</p>
            <button
              type="button"
              className={`btn block ${p.popular ? "primary" : "ghost"}`}
              disabled={!enabled || buying !== null}
              onClick={() => void buy(p)}
            >
              {buying === p.id ? "Opening checkout…" : `Buy ${p.name}`}
            </button>
          </article>
        ))}
      </div>
      {enabled === false && (
        <p className="fine">Buying credits isn't switched on for this server yet. Your free credits work as normal.</p>
      )}
      {error && <p className="error">{error}</p>}
      <p className="fine">
        Packs never expire. Payments are handled by Dodo Payments, our merchant of record — it takes care of tax and
        emails your receipt. Jev never sees your card.
      </p>

      <h3 className="orders-title">Your orders</h3>
      {orders === null ? (
        <p className="muted">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="muted">No orders yet.</p>
      ) : (
        <div className="orders">
          <div className="orders-row head">
            <span>Date</span>
            <span>Pack</span>
            <span>Credits</span>
            <span>Amount</span>
            <span>Status</span>
            <span />
          </div>
          {orders.map((o) => (
            <div key={o.id} className="orders-row">
              <span>{new Date(o.paidAt ?? o.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
              <span>{o.packName}</span>
              <span>{o.credits.toLocaleString()}</span>
              <span>{amount(o)}</span>
              <span className={`pill ${STATUS[o.status].tone}`}>{STATUS[o.status].text}</span>
              <span>
                {o.invoiceUrl ? (
                  <a href={o.invoiceUrl} target="_blank" rel="noreferrer">
                    Invoice
                  </a>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function amount(o: OrderSummary): string {
  if (o.amount != null && o.currency) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: o.currency }).format(o.amount / 100);
  }
  return `$${o.priceUsd}`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
