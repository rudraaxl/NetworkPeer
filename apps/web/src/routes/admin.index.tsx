import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Briefcase,
  Building2,
  CircleDollarSign,
  FileCheck2,
  ShieldCheck,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/shell/portal-shell";
import { Chip, SectionCard, StatCard } from "@/components/marketplace/primitives";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin dashboard — NetworkPeers" },
      { name: "description", content: "Operations overview with live marketplace metrics." },
    ],
  }),
  component: AdminDashboard,
});

function cents(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 100 : 0;
}

function AdminDashboard() {
  const analytics = useQuery({
    queryKey: ["admin", "analytics"],
    queryFn: api.adminAnalytics,
  });
  const users = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.adminUsers({ perPage: 100 }),
  });

  const activeJobs = analytics.data?.active_jobs ?? 0;
  const escrowVolume = (analytics.data?.escrow_hold_volume ?? []).reduce(
    (sum, entry) => sum + cents(entry.cents),
    0,
  );
  const platformRevenue = (analytics.data?.platform_fee_revenue ?? []).reduce(
    (sum, entry) => sum + cents(entry.cents),
    0,
  );
  const totalUsers = users.data?.total ?? 0;
  const activeUsers = users.data?.items.filter((user) => user.is_active).length ?? 0;

  return (
    <div className="animate-rise space-y-6">
      <PageHeader
        title="Operations overview"
        description="Live marketplace health from the authoritative ledger and audit trail."
        action={
          <Link
            to="/admin/jobs"
            className="press gradient-brand shadow-glow inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-base font-semibold text-primary-foreground"
          >
            <FileCheck2 className="h-4 w-4" /> Review jobs
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active jobs"
          value={String(activeJobs)}
          icon={Briefcase}
          tone="primary"
          hint="live across the platform"
        />
        <StatCard
          label="Escrow held"
          value={formatCurrency(escrowVolume)}
          icon={CircleDollarSign}
          tone="warning"
          hint="completed holds"
        />
        <StatCard
          label="Platform revenue"
          value={formatCurrency(platformRevenue)}
          icon={Building2}
          tone="success"
          hint="completed postings"
        />
        <StatCard
          label="Active users"
          value={`${activeUsers}/${totalUsers}`}
          icon={Users}
          tone="teal"
          hint="active accounts"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <SectionCard title="Financial basis" description="Ledger-derived, currency-safe aggregates">
          <div className="space-y-3 text-base">
            {(analytics.data?.escrow_hold_volume ?? []).map((entry) => (
              <div
                key={entry.currency}
                className="flex items-center justify-between rounded-xl border border-border px-3 py-3"
              >
                <span className="text-muted-foreground">Escrow held ({entry.currency})</span>
                <span className="font-semibold">{formatCurrency(cents(entry.cents))}</span>
              </div>
            ))}
            {(analytics.data?.platform_fee_revenue ?? []).map((entry) => (
              <div
                key={`fee-${entry.currency}`}
                className="flex items-center justify-between rounded-xl border border-border px-3 py-3"
              >
                <span className="text-muted-foreground">Platform revenue ({entry.currency})</span>
                <span className="font-semibold">{formatCurrency(cents(entry.cents))}</span>
              </div>
            ))}
            {!analytics.data?.escrow_hold_volume?.length &&
              !analytics.data?.platform_fee_revenue?.length && (
                <p className="text-muted-foreground">No completed ledger postings yet.</p>
              )}
          </div>
        </SectionCard>

        <SectionCard title="Quick actions">
          <div className="grid gap-3">
            {[
              { label: "Open job queue", to: "/admin/jobs" },
              { label: "Review worker quality", to: "/admin/workers" },
              { label: "Inspect payments", to: "/admin/payments" },
            ].map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="press flex items-center justify-between rounded-2xl border border-border bg-card px-3 py-3 text-base font-medium hover:border-primary/40"
              >
                <span>{item.label}</span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
          <div className="mt-4">
            <Chip tone="success">
              <ShieldCheck className="h-3.5 w-3.5" /> Backend authoritative
            </Chip>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
