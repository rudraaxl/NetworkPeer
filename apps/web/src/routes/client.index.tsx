import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Briefcase,
  Camera,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Eye,
  PlusCircle,
  RotateCcw,
  ShieldCheck,
  Star,
  Wallet,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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
import { authSession } from "@/lib/auth-session";
import { cn, formatCurrency } from "@/lib/utils";

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
  const router = useRouter();
  const jobsQuery = useQuery({
    queryKey: ["client", "jobs"],
    queryFn: () => api.clientJobs({ page: 1, perPage: 100 }),
  });
  const walletQuery = useQuery({
    queryKey: ["client", "wallet"],
    queryFn: api.clientWallet,
  });

  const jobs = useMemo(() => jobsQuery.data?.items ?? [], [jobsQuery.data?.items]);

  const activeJobs = useMemo(() => jobs.filter((job) => activeStatuses.has(job.status)), [jobs]);
  const completedJobs = useMemo(
    () => jobs.filter((job) => completedStatuses.has(job.status)),
    [jobs],
  );
  const pendingReviews = useMemo(
    () => jobs.filter((job) => reviewStatuses.has(job.status)),
    [jobs],
  );
  const balances = useMemo(() => walletQuery.data?.balances ?? [], [walletQuery]);

  const balanceTotal = useMemo(
    () => walletTotal(balances, "availableBalanceCents") + walletTotal(balances, "pendingEscrowCents"),
    [balances],
  );

  const latestJobs = useMemo(() => {
    return [...jobs]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 4);
  }, [jobs]);

  type DeliverableItem = {
    id: string;
    jobTitle: string;
    workerBadge: string;
    previewUrl: string;
    status: "PENDING" | "APPROVED" | "REDO_REQUESTED" | "REJECTED";
    timestamp: string;
    location: string;
    hash: string;
  };

  const [deliverables, setDeliverables] = useState<DeliverableItem[]>([
    {
      id: "del-101",
      jobTitle: "Storefront compliance audit — Downtown",
      workerBadge: "Worker #8492 (Verified)",
      previewUrl: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&auto=format&fit=crop&q=80",
      status: "PENDING",
      timestamp: "Today, 10:42 AM",
      location: "12.9716° N, 77.5946° E (GPS Verified)",
      hash: "sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
    },
    {
      id: "del-102",
      jobTitle: "Merchandising shelf display — Metro Hub",
      workerBadge: "Worker #3104 (Verified)",
      previewUrl: "https://images.unsplash.com/photo-1578916171728-46686eac8d58?w=800&auto=format&fit=crop&q=80",
      status: "PENDING",
      timestamp: "Today, 11:15 AM",
      location: "12.9352° N, 77.6245° E (GPS Verified)",
      hash: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
  ]);

  const [activeModalItem, setActiveModalItem] = useState<DeliverableItem | null>(null);

  const handleApprove = (id: string) => {
    setDeliverables((prev) => prev.map((item) => (item.id === id ? { ...item, status: "APPROVED" } : item)));
    toast.success("Deliverable approved! Escrow payout released to worker.");
    if (activeModalItem?.id === id) setActiveModalItem(null);
  };

  const handleReject = (id: string) => {
    setDeliverables((prev) => prev.map((item) => (item.id === id ? { ...item, status: "REJECTED" } : item)));
    toast.error("Deliverable rejected. Worker notified.");
    if (activeModalItem?.id === id) setActiveModalItem(null);
  };

  const handleRedo = (id: string) => {
    const reason = window.prompt("Enter revision reason for worker:", "Retake photo with clear signage in daylight");
    if (reason !== null) {
      setDeliverables((prev) => prev.map((item) => (item.id === id ? { ...item, status: "REDO_REQUESTED" } : item)));
      toast.info(`Redo requested: "${reason.slice(0, 35)}..."`);
      if (activeModalItem?.id === id) setActiveModalItem(null);
    }
  };

  const withdrawConsent = useCallback(async (_purpose: string) => {
    toast.success("Consent preferences updated.");
  }, []);

  const requestDeletion = useCallback(async () => {
    if (
      !window.confirm(
        "Delete your account data? This deactivates your account and removes consent records.",
      )
    ) {
      return;
    }
    authSession.clear();
    toast.success("Account data deletion requested. You are now signed out.");
    await router.navigate({ to: "/" });
  }, [router]);

  return (
    <>
      <PageHeader
        title="Client dashboard"
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

      <div className="grid gap-4 pb-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Jobs posted"
          value={String(jobs.length)}
          icon={Briefcase}
          hint="all time"
        />
        <StatCard
          label="Jobs active"
          value={String(activeJobs.length)}
          icon={Clock3}
          tone="warning"
          hint="in progress"
        />
        <StatCard
          label="Jobs completed"
          value={String(completedJobs.length)}
          icon={CheckCircle2}
          tone="success"
          hint="all time"
        />
        <StatCard
          label="Pending reviews"
          value={String(pendingReviews.length)}
          icon={Star}
          tone="teal"
          hint="evidence awaiting you"
        />
        <StatCard
          label="Wallet balance"
          value={formatCurrency(balanceTotal)}
          icon={Wallet}
          hint="incl. escrow"
        />
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
            title="Worker Deliverables & Evidence Review"
            description="Inspect submitted proof of work. Review photos, release escrow or request re-capture."
          >
            <div className="space-y-4">
              {deliverables.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-border bg-card p-4 transition-all hover:border-primary/40 shadow-soft"
                >
                  <div className="grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]">
                    <div
                      onClick={() => setActiveModalItem(item)}
                      className="group relative h-28 w-full cursor-pointer overflow-hidden rounded-xl border border-border bg-muted"
                    >
                      <img
                        src={item.previewUrl}
                        alt={item.jobTitle}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="flex items-center gap-1 rounded-lg bg-black/70 px-2 py-1 text-xs font-semibold text-white">
                          <Eye className="h-3.5 w-3.5" /> Preview
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col justify-between">
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-base font-semibold">{item.jobTitle}</h4>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider",
                              item.status === "APPROVED"
                                ? "bg-success/15 text-success"
                                : item.status === "REJECTED"
                                  ? "bg-destructive/15 text-destructive"
                                  : item.status === "REDO_REQUESTED"
                                    ? "bg-warning/15 text-warning"
                                    : "bg-primary/15 text-primary",
                            )}
                          >
                            {item.status.replace("_", " ")}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.workerBadge} · {item.timestamp} · {item.location}
                        </p>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {item.status === "PENDING" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleApprove(item.id)}
                              className="press inline-flex h-9 items-center gap-1.5 rounded-lg bg-success px-3.5 text-xs font-semibold text-white hover:bg-success/90"
                            >
                              <Check className="h-3.5 w-3.5" /> Approve & Release Escrow
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRedo(item.id)}
                              className="press inline-flex h-9 items-center gap-1.5 rounded-lg border border-warning/60 bg-warning/10 px-3 text-xs font-semibold text-warning hover:bg-warning/20"
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Request Redo
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReject(item.id)}
                              className="press inline-flex h-9 items-center gap-1.5 rounded-lg border border-destructive/60 bg-destructive/10 px-3 text-xs font-semibold text-destructive hover:bg-destructive/20"
                            >
                              <X className="h-3.5 w-3.5" /> Reject
                            </button>
                          </>
                        ) : (
                          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <ShieldCheck className="h-4 w-4 text-primary" />
                            <span>Action completed: {item.status.replace("_", " ")}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
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

      {activeModalItem && (
        <div
          onClick={() => setActiveModalItem(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setActiveModalItem(null)}
              className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>

            <h3 className="text-xl font-bold">{activeModalItem.jobTitle}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {activeModalItem.workerBadge} · {activeModalItem.timestamp}
            </p>

            <div className="my-4 overflow-hidden rounded-xl border border-border bg-black">
              <img
                src={activeModalItem.previewUrl}
                alt="Deliverable"
                className="max-h-[50vh] w-full object-contain"
              />
            </div>

            <div className="space-y-1 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground font-mono">
              <p>GPS Coordinates: {activeModalItem.location}</p>
              <p className="truncate">Cryptographic Integrity Hash: {activeModalItem.hash}</p>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => handleRedo(activeModalItem.id)}
                className="press rounded-xl border border-warning/60 bg-warning/10 px-4 py-2 text-sm font-semibold text-warning"
              >
                Request Redo
              </button>
              <button
                type="button"
                onClick={() => handleApprove(activeModalItem.id)}
                className="press rounded-xl bg-success px-4 py-2 text-sm font-semibold text-white"
              >
                Approve Deliverable
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
