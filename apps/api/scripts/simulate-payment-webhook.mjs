#!/usr/bin/env node
// Demo helper: simulate the Stripe `payment_intent.succeeded` webhook against the
// local API so the fund -> POSTED lifecycle works without Stripe CLI or an account.
//
// Usage (from NetworkPeer-main, with the API running):
//   node scripts/simulate-payment-webhook.mjs <operationId> <providerReference> [apiOrigin]
//
// The <operationId> and <providerReference> are returned by the "Fund escrow"
// button in the UI (POST /api/v1/client/jobs/:jobId/fund returns
// { operationId, providerReference, status: "PENDING" }).
//
// In development with PAYMENT_GATEWAY=stub the signature uses PAYMENT_WEBHOOK_SECRET.
// This script exists only for local demos/tests; production uses real Stripe delivery.
import "dotenv/config";
import { createHmac } from "node:crypto";

const [operationId, providerReference, apiOrigin = "http://localhost:3000"] = process.argv.slice(2);

if (!operationId || !providerReference) {
  console.error(
    "Usage: node scripts/simulate-payment-webhook.mjs <operationId> <providerReference> [apiOrigin]",
  );
  process.exit(1);
}

const webhookSecret =
  (process.env.PAYMENT_GATEWAY === "stripe"
    ? process.env.STRIPE_WEBHOOK_SECRET
    : process.env.PAYMENT_WEBHOOK_SECRET) ?? "development-payment-webhook-secret";

const payload = JSON.stringify({
  id: `evt_simulated_${Date.now()}`,
  type: "payment_intent.succeeded",
  data: {
    object: {
      id: providerReference,
      metadata: { networkpeer_operation_id: operationId },
    },
  },
});

const timestamp = Math.floor(Date.now() / 1000);
const signature = createHmac("sha256", webhookSecret)
  .update(`${timestamp}.${payload}`)
  .digest("hex");

const response = await fetch(`${apiOrigin}/api/v1/webhooks/payments`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "stripe-signature": `t=${timestamp},v1=${signature}`,
  },
  body: payload,
});

const body = await response.text();
console.log(`HTTP ${response.status}`);
console.log(body);
if (!response.ok) process.exit(1);
