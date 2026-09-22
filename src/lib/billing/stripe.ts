import Stripe from "stripe";

/**
 * Stripe client singleton. Only constructed when STRIPE_SECRET_KEY is set — every caller must check
 * isBillingConfigured() (src/lib/billing/config.ts) first, or handle the null. Keys are env-only,
 * never persisted (docs/deployment.md's rotation posture applies to these too).
 */
const globalForStripe = globalThis as unknown as { stripe?: Stripe | null };

export function getStripe(): Stripe | null {
  if (globalForStripe.stripe !== undefined) return globalForStripe.stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  const client = key ? new Stripe(key) : null;
  if (process.env.NODE_ENV !== "production") {
    globalForStripe.stripe = client;
  }
  return client;
}
