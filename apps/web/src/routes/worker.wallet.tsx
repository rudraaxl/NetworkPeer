import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Banknote,
  CircleAlert,
  CreditCard,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { PageHeader } from "@/components/shell/portal-shell";
import { api, ApiError, type WalletBalance } from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/worker/wallet")({
  head: () => ({
    meta: [
      { title: "Worker wallet — NetworkPeers" },
      { name: "description", content: "Wallet and pending earnings for workers." },
    ],
  }),
  component: WorkerWallet,
});

function asCents(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 100 : 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return "Unable to load wallet balances. Check your connection and try again.";
}

function WorkerWallet() {
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWallet = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.workerWallet();
      setBalances(result.balances);
      setError(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  const totals = useMemo(() => {
    return balances.reduce(
      (result, balance) => ({
        available: result.available + asCents(balance.availableBalanceCents),
        escrow: result.escrow + asCents(balance.pendingEscrowCents),
        lifetime: result.lifetime + asCents(balance.lifetimeEarningsCents),
      }),
      { available: 0, escrow: 0, lifetime: 0 },
    );
  }, [balances]);

  return (
    <div className="animate-rise space-y-4 px-3 py-3">
      <PageHeader
        title="Wallet"
        description="Live balances derived from immutable, double-entry ledger postings."
        action={
          <button
            type="button"
            onClick={() => void loadWallet()}
            disabled={isLoading}
            className="press inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
          >
            <RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh
          </button>
        }
      />

      {error ? (
        <p
          role="alert"
          className="mb-4 flex gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-muted-foreground">Available balance</p>
              <p className="mt-2 whitespace-nowrap text-2xl font-semibold tracking-tight">
                {formatCurrency(totals.available)}
              </p>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">Ready to withdraw</p>
            </div>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
              <Wallet className="h-5 w-5" />
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-warning/10 p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground">Pending earnings</p>
                <p className="mt-2 whitespace-nowrap text-2xl font-semibold tracking-tight">
                  {formatCurrency(totals.escrow)}
                </p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">Held in escrow</p>
              </div>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-warning/20 text-warning">
                <ArrowUpRight className="h-5 w-5" />
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-success/10 p-4 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground">Total earnings</p>
                <p className="mt-2 whitespace-nowrap text-2xl font-semibold tracking-tight">
                  {formatCurrency(totals.lifetime)}
                </p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">Lifetime credits</p>
              </div>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-success/20 text-success">
                <CreditCard className="h-5 w-5" />
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Currency ledger summary</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Each row is computed server-side; the browser never determines settlement.
            </p>
          </div>
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary-soft text-primary">
            <ShieldCheck className="h-5 w-5" />
          </span>
        </div>

        {isLoading ? (
          <div className="mt-4 h-28 animate-pulse rounded-xl bg-muted" />
        ) : balances.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No completed ledger postings are available yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {balances.map((balance) => (
              <li key={balance.currency} className="grid gap-2 py-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Currency</p>
                  <p className="font-semibold">{balance.currency}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Available</p>
                  <p className="font-semibold">
                    {formatCurrency(asCents(balance.availableBalanceCents))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pending escrow</p>
                  <p className="font-semibold">
                    {formatCurrency(asCents(balance.pendingEscrowCents))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
            <Banknote className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Withdrawals</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Payouts are dispatched to the gateway after escrow release. Withdrawal controls
              are not exposed by the current API yet.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled
          className={cn(
            "press mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-muted px-3 py-2.5 text-sm font-semibold text-muted-foreground",
          )}
        >
          Withdraw unavailable
        </button>
      </div>
    </div>
  );
}
