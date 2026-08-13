import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  Clock3,
  PlusCircle,
  Star,
  Wallet,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageHeader } from "@/components/shell/portal-shell";
import {
  AnonymousBadge,
  Chip,
  MapCanvas,
  SectionCard,
  StatCard,
} from "@/components/marketplace/primitives";
import { api, type Job, type WalletBalance } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/client/")({
  head: () => ({
    meta: [
      { title: "Client dashboard — NetworkPeers" },
      {
        name: "description",
        content:
          "Track posted, active and completed jobs, pending evidence reviews and wallet balance in one workspace.",
      },
      { property: "og:title", content: "Client dashboard — NetworkPeers" },
      { property: "og:description", content: "Your on-demand field work command centre." },
    ],
  }),
  component: ClientDashboard,
});

const activeStatuses = new Set(["ASSIGNED", "EN_ROUTE", "AT_LOCATION", "IN_PROGRESS"]);
const completedStatuses = new Set(["APPROVED", "COMPLETED"]);
const reviewStatuses = new Set(["SUBMITTED", "DISPUTED"]);

function cents(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 100 : 0;
}

function walletTotal(balances: WalletBalance[], key: keyof WalletBalance): number {
  return balances.reduce((sum, balance) => {
    const value = balance[key];
    return sum + (typeof value === "string" ? cents(value) : 0);
  }, 0);
}

function statusLabel(status: Job["status"]): string {
  return status.replaceAll("_", " ");
}

function ClientDashboard() {
  const jobsQuery = useQuery({
    queryKey: ["client", "jobs"],
    queryFn: () => api.clientJobs({ page: 1, perPage: 100 }),
  });
  const walletQuery = useQuery({
    queryKey: ["client", "wallet"],
    queryFn: api.clientWallet,
  });

  const jobs = jobsQuery.data?.items ?? [];
  const activeJobs = jobs.filter((job) => activeStatuses.has(job.status));
  const completedJobs = jobs.filter((job) => completedStatuses.has(job.status));
  const pendingReviews = jobs.filter((job) => reviewStatuses.has(job.status));
  const balances = walletQuery.data?.balances ?? [];

  const balanceTotal = useMemo(
    () => walletTotal(balances, "availableBalanceCents") + walletTotal(balances, "pendingEscrowCents"),
    [balances],
  );

  const latestJobs = useMemo(() => {
    return [...jobs]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 4);
  }, [jobs]);

  const withdrawConsent = useCallback(async (purpose: string) => {
    try {
      await api.withdrawConsent(purpose);
      toast.success("Consent withdrawn. You can re-grant it at any time.");
    } catch {
      toast.error("Could not withdraw consent. Please try again.");
    }
  }, []);

  const requestDeletion = useCallback(async () => {
    if (!window.confirm("Delete your account data? This deactivates your account and removes consent records.")) {
      return;
    }
    try {
      await api.deleteAccount();
      toast.success("Account data deletion requested.");
    } catch {
      toast.error("Could not delete account data. Please try again.");
    }
  }, []);

  return (
    <>
      <PageHeader
        title="Good afternoon"
        description="Here's what's happening across your jobs today."
        action={
          <Link
            to="/client/jobs/new"
            className="press gradient-brand shadow-glow inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-base font-semibold text-primary-foreground"
          >
            <PlusCircle className="h-4 w-4" /> Post a job
          </Link>
        }
      />

      <div className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible xl:grid-cols-5">
        <div className="min-w-[260px] max-w-[280px] flex-none snap-start sm:min-w-0 sm:max-w-none">
          <StatCard
            label="Jobs posted"
            value={String(jobs.length)}
            icon={Briefcase}
            hint="all time"
          />
        </div>
        <div className="min-w-[260px] max-w-[280px] flex-none snap-start sm:min-w-0 sm:max-w-none">
          <StatCard
            label="Jobs active"
            value={String(activeJobs.length)}
            icon={Clock3}
            tone="warning"
            hint="in progress"
          />
        </div>
        <div className="min-w-[260px] max-w-[280px] flex-none snap-start sm:min-w-0 sm:max-w-none">
          <StatCard
            label="Jobs completed"
            value={String(completedJobs.length)}
            icon={CheckCircle2}
            tone="success"
            hint="all time"
          />
        </div>
        <div className="min-w-[260px] max-w-[280px] flex-none snap-start sm:min-w-0 sm:max-w-none">
          <StatCard
            label="Pending reviews"
            value={String(pendingReviews.length)}
            icon={Star}
            tone="teal"
            hint="evidence awaiting you"
          />
        </div>
        <div className="min-w-[260px] max-w-[280px] flex-none snap-start sm:min-w-0 sm:max-w-none">
          <StatCard
            label="Wallet balance"
            value={formatCurrency(balanceTotal)}
            icon={Wallet}
            hint="incl. escrow"
          />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <SectionCard
            title="Recent jobs"
            description="Latest activity from your client workspace"
            action={
              <Link
                to="/client/jobs"
                className="text-base font-medium text-primary hover:underline"
              >
                View all
              </Link>
            }
          >
            <div className="space-y-3">
              {latestJobs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-6 text-center">
                  <p className="text-base font-semibold">No jobs created yet</p>
                  <p className="mt-1 text-base text-muted-foreground">
                    Post a job and it will appear here instantly.
                  </p>
                </div>
              ) : (
                latestJobs.map((job) => (
                  <Link
                    key={job.id}
                    to="/client/jobs/$jobId"
                    params={{ jobId: job.id }}
                    className="hover-lift block rounded-2xl border border-border bg-card p-4"
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold">{job.title}</p>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {job.id} · {job.category}
                        </p>
                      </div>
                      <Chip>{statusLabel(job.status)}</Chip>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <AnonymousBadge role="Worker" />
                      <Chip tone="teal">{formatCurrency(job.budget_cents / 100)}</Chip>
                      {job.scheduled_at && (
                        <Chip>
                          <Clock3 className="h-3.5 w-3.5" />{" "}
                          {new Date(job.scheduled_at).toLocaleString()}
                        </Chip>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Live worker map"
            description="Anonymous positions, updated every 30 seconds"
          >
            <MapCanvas className="h-64" pins={4} label="4 verified workers on site" />
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Quick actions">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {[
                { label: "Post a new job", to: "/client/jobs/new", icon: PlusCircle },
                { label: "Review evidence", to: "/client/jobs", icon: ClipboardList },
                { label: "View wallet", to: "/client/wallet", icon: Wallet },
              ].map((a) => (
                <Link
                  key={a.label}
                  to={a.to}
                  className="press grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-base font-medium hover:border-primary/40"
                >
                  <a.icon className="h-4 w-4 text-primary" />
                  <span className="truncate">{a.label}</span>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Settlement state">
            <p className="text-base leading-relaxed text-muted-foreground">
              Jobs stay in <span className="font-medium text-foreground">FUNDING</span> until the
              escrow webhook settles. Only then do they become visible to nearby workers.
            </p>
          </SectionCard>

          <SectionCard title="Privacy & data">
            <p className="text-base leading-relaxed text-muted-foreground">
              You control how NetworkPeers uses your data. Withdraw consent or request account
              deletion under DPDP Act.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void withdrawConsent("LOCATION")}
                className="press rounded-xl border border-border bg-card px-3 py-2 text-base font-medium"
              >
                Withdraw location consent
              </button>
              <button
                type="button"
                onClick={() => void requestDeletion()}
                className="press rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-base font-medium text-destructive"
              >
                Delete my account data
              </button>
            </div>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
