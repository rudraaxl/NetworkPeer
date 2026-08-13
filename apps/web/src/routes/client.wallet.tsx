import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, CircleAlert, RefreshCw, Wallet } from "lucide-react";

import { api, ApiError, type WalletBalance } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/shell/portal-shell";
import { SectionCard, StatCard } from "@/components/marketplace/primitives";

export const Route = createFileRoute("/client/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet - NetworkPeers client" },
      { name: "description", content: "Authoritative escrow and ledger balance summary." },
    ],
  }),
  component: ClientWallet,
});

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return "Unable to load wallet balances. Check your connection and try again.";
}

function asCents(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 100 : 0;
}

function ClientWallet() {
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWallet = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.clientWallet();
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

  const totals = useMemo(
    () =>
      balances.reduce(
        (result, balance) => ({
          available: result.available + asCents(balance.availableBalanceCents),
          escrow: result.escrow + asCents(balance.pendingEscrowCents),
          spent: result.spent + asCents(balance.lifetimeSpendCents),
          earned: result.earned + asCents(balance.lifetimeEarningsCents),
        }),
        { available: 0, escrow: 0, spent: 0, earned: 0 },
      ),
    [balances],
  );

  return (
    <>
      <PageHeader
        title="Wallet"
        description="Live balances derived from immutable, double-entry ledger postings."
        action={
          <button
            type="button"
            onClick={() => void loadWallet()}
            disabled={isLoading}
            className="press inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-base font-semibold disabled:opacity-60"
          >
            <RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh
            balances
          </button>
        }
      />

      {error ? (
        <p
          role="alert"
          className="mb-6 flex gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Available balance"
          value={formatCurrency(totals.available)}
          icon={Wallet}
          hint="settled ledger balance"
        />
        <StatCard
          label="Held in escrow"
          value={formatCurrency(totals.escrow)}
          icon={ArrowUpRight}
          tone="warning"
          hint="funded active work"
        />
        <StatCard
          label="Lifetime spend"
          value={formatCurrency(totals.spent)}
          icon={ArrowDownLeft}
          tone="teal"
          hint="completed client settlements"
        />
        <StatCard
          label="Lifetime earnings"
          value={formatCurrency(totals.earned)}
          icon={ArrowDownLeft}
          tone="success"
          hint="credits recorded to this account"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCard
          title="Currency ledger summary"
          description="Each row is calculated server-side; browser totals never determine settlement."
        >
          {isLoading ? (
            <div className="h-28 animate-pulse rounded-xl bg-muted" />
          ) : balances.length === 0 ? (
            <p className="text-base text-muted-foreground">
              No completed ledger postings are available yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {balances.map((balance) => (
                <li key={balance.currency} className="grid gap-3 py-4 sm:grid-cols-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Currency</p>
                    <p className="font-semibold">{balance.currency}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Available</p>
                    <p className="font-semibold">
                      {formatCurrency(asCents(balance.availableBalanceCents))}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Escrow</p>
                    <p className="font-semibold">
                      {formatCurrency(asCents(balance.pendingEscrowCents))}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Lifetime spend</p>
                    <p className="font-semibold">
                      {formatCurrency(asCents(balance.lifetimeSpendCents))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
        <SectionCard title="Settlement guarantee">
          <p className="text-base leading-relaxed text-muted-foreground">
            Escrow is released only after the client approves submitted evidence. Payout delivery
            remains separately tracked until the payment gateway webhook confirms it.
          </p>
        </SectionCard>
      </div>
    </>
  );
}
