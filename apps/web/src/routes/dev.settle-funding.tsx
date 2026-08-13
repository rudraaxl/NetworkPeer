import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";

// Demo-only funding settler. Only exists in builds where VITE_DEMO_WEBHOOK_SECRET
// is set at build time (demo/cloud-demo deployments). It reproduces exactly what
// `scripts/simulate-payment-webhook.mjs` does locally, but inside the browser, so
// a machine with no Node/Stripe tools can settle escrow during a live demo.
const webhookSecret = (import.meta.env.VITE_DEMO_WEBHOOK_SECRET as string | undefined) ?? "";

export const Route = createFileRoute("/dev/settle-funding")({
  head: () => ({
    meta: [
      { title: "Settle funding (demo) — NetworkPeers" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SettleFunding,
});

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function SettleFunding() {
  const defaultOrigin = useMemo(
    () => (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/api\/v1\/?$/, "") ?? "",
    [],
  );
  const [operationId, setOperationId] = useState("");
  const [providerReference, setProviderReference] = useState("");
  const [origin, setOrigin] = useState(defaultOrigin);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; body: string } | null>(null);

  if (!webhookSecret) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
        <ShieldAlert className="h-10 w-10 text-warning" />
        <h1 className="mt-4 text-xl font-semibold">Settler not enabled</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is disabled because <code>VITE_DEMO_WEBHOOK_SECRET</code> was not set at
          build time. It is a demo-only tool and is intentionally absent from normal builds.
        </p>
      </div>
    );
  }

  const settle = async () => {
    const trimmedOperationId = operationId.trim();
    const trimmedReference = providerReference.trim();
    const trimmedOrigin = origin.trim().replace(/\/$/, "");
    if (!trimmedOperationId || !trimmedReference) {
      setResult({ ok: false, body: "Operation ID and provider reference are both required." });
      return;
    }
    if (!/^https?:\/\//.test(trimmedOrigin)) {
      setResult({ ok: false, body: "API origin must start with http:// or https://" });
      return;
    }

    const payload = JSON.stringify({
      id: `evt_simulated_${Date.now()}`,
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: trimmedReference,
          metadata: { networkpeer_operation_id: trimmedOperationId },
        },
      },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${payload}`),
    );
    const signature = `t=${timestamp},v1=${hex(new Uint8Array(signatureBytes))}`;

    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`${trimmedOrigin}/api/v1/webhooks/payments`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "stripe-signature": signature,
        },
        body: payload,
      });
      setResult({ ok: response.ok, body: await response.text() });
    } catch (error) {
      setResult({
        ok: false,
        body: error instanceof Error ? error.message : "Network error while settling funding.",
      });
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full rounded-xl border border-border bg-card px-3.5 py-3 text-base outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40";

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Settle funding (demo tool)</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Simulates the Stripe <code>payment_intent.succeeded</code> webhook from the browser.
        Paste the <strong>Operation ID</strong> and <strong>Provider reference</strong> returned
        by the “Fund escrow” button, then click Settle. The job moves from{" "}
        <code>FUNDING</code> to <code>POSTED</code>.
      </p>

      <div className="mt-6 space-y-4 rounded-2xl border border-border bg-card p-5 shadow-soft">
        <label className="block">
          <span className="mb-1.5 block text-base font-medium">Operation ID</span>
          <input className={inputCls} value={operationId} onChange={(event) => setOperationId(event.target.value)} placeholder="paste operationId from the fund response" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-base font-medium">Provider reference</span>
          <input className={inputCls} value={providerReference} onChange={(event) => setProviderReference(event.target.value)} placeholder="paste providerReference (stub_pi_…)" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-base font-medium">API origin</span>
          <input className={inputCls} value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="https://api.example.com" />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void settle()}
          className="press gradient-brand shadow-glow inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold text-primary-foreground disabled:opacity-70"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Settle funding
        </button>
        {result && (
          <pre
            className={`max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl p-3 text-sm ${
              result.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
            }`}
          >
            HTTP {result.body}
          </pre>
        )}
        <p className="text-xs text-muted-foreground">
          Demo-only. The webhook secret is embedded in this page, which is acceptable only for a
          stub-payment demo deployment. Never enable this page in a real Stripe production build.
        </p>
      </div>
    </div>
  );
}
