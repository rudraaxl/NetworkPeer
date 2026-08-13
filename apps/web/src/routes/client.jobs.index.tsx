import { createFileRoute, Link } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Briefcase, PlusCircle, Search, XCircle } from "lucide-react";
import { toast } from "sonner";

import { cn, formatCurrency } from "@/lib/utils";
import { api, ApiError, type Job, type JobStatus } from "@/lib/api";
import { PageHeader } from "@/components/shell/portal-shell";
import { AnonymousBadge, Chip, EmptyState } from "@/components/marketplace/primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/client/jobs/")({
  head: () => ({
    meta: [
      { title: "My jobs — NetworkPeers client" },
      {
        name: "description",
        content: "Filter and manage jobs posted through the NetworkPeers API.",
      },
    ],
  }),
  component: ClientJobs,
});

const filters = ["All", "Open", "In progress", "In review", "Completed"] as const;

function statusLabel(status: JobStatus): string {
  return status.replaceAll("_", " ");
}

function statusTone(status: JobStatus): "neutral" | "primary" | "success" | "danger" | "teal" {
  if (status === "COMPLETED" || status === "APPROVED") return "success";
  if (status === "CANCELLED" || status === "DISPUTED") return "danger";
  if (status === "POSTED") return "teal";
  if (status === "SUBMITTED") return "primary";
  return "neutral";
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return "Unable to load your jobs. Check your connection and try again.";
}

const JobsSkeleton = memo(function JobsSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft"
      aria-busy="true"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="animate-pulse border-b border-border px-5 py-5 last:border-b-0">
          <div className="h-4 w-2/5 rounded bg-muted" />
          <div className="mt-3 h-3 w-3/5 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
});

function ClientJobs() {
  const [filter, setFilter] = useState<(typeof filters)[number]>("All");
  const [query, setQuery] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.clientJobs({ page: 1, perPage: 100 });
      setJobs(result.items);
      setTotal(result.total);
      setError(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return jobs.filter((job) => {
      const matchesQuery =
        !normalizedQuery ||
        `${job.title} ${job.category} ${job.id}`.toLocaleLowerCase().includes(normalizedQuery);
      const matchesFilter =
        filter === "All" ||
        (filter === "Open" && job.status === "POSTED") ||
        (filter === "In progress" &&
          ["ASSIGNED", "EN_ROUTE", "AT_LOCATION", "IN_PROGRESS"].includes(job.status)) ||
        (filter === "In review" && job.status === "SUBMITTED") ||
        (filter === "Completed" && ["APPROVED", "COMPLETED"].includes(job.status));
      return matchesQuery && matchesFilter;
    });
  }, [filter, jobs, query]);

  const awaitingReview = useMemo(
    () => jobs.filter((job) => job.status === "SUBMITTED").length,
    [jobs],
  );

  const cancelJob = useCallback(async (jobId: string) => {
    setCancellingJobId(jobId);
    try {
      const result = await api.cancelClientJob(jobId);
      setJobs((current) => current.map((job) => (job.id === jobId ? result.job : job)));
      toast.success("Job cancelled.");
    } catch (requestError) {
      toast.error(errorMessage(requestError));
    } finally {
      setCancellingJobId(null);
    }
  }, []);

  const summary = `${total} ${total === 1 ? "job" : "jobs"} posted · ${awaitingReview} awaiting your review`;

  return (
    <>
      <PageHeader
        title="My jobs"
        description={summary}
        action={
          <Link
            to="/client/jobs/new"
            className="press gradient-brand shadow-glow inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-base font-semibold text-primary-foreground"
          >
            <PlusCircle className="h-4 w-4" /> Post a job
          </Link>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, category, or ID"
            className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-base outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
          {filters.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-base font-medium transition-all",
                filter === value
                  ? "bg-card shadow-soft"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {isLoading ? (
        <JobsSkeleton />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No jobs created yet"
          description="Create your first job and it will appear here with its authoritative API status."
          action={
            <Link
              to="/client/jobs/new"
              className="press gradient-brand inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-base font-semibold text-primary-foreground"
            >
              <PlusCircle className="h-4 w-4" /> Post a job
            </Link>
          }
        />
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No jobs match this view"
          description="Try another filter or search term."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_1fr_1fr_1fr_auto_auto] gap-4 border-b border-border px-5 py-3 text-[15px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
            <span>Job</span>
            <span>Worker</span>
            <span>Budget</span>
            <span>Scheduled</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          <ul className="divide-y divide-border">
            {filteredJobs.map((job) => (
              <li key={job.id} className="px-5 py-4 transition-colors hover:bg-accent/60">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,2.2fr)_1fr_1fr_1fr_auto_auto] lg:items-center lg:gap-4">
                  <Link to="/client/jobs/$jobId" params={{ jobId: job.id }} className="min-w-0">
                    <p className="truncate text-base font-semibold">{job.title}</p>
                    <p className="truncate text-base text-muted-foreground">
                      {job.id} · {job.category}
                    </p>
                  </Link>
                  <div className="min-w-0">
                    {job.worker_id ? (
                      <AnonymousBadge role="Worker" />
                    ) : (
                      <Chip>Awaiting assignment</Chip>
                    )}
                  </div>
                  <p className="text-base font-semibold">
                    {formatCurrency(job.budget_cents / 100)}
                  </p>
                  <p className="text-base text-muted-foreground">
                    {job.scheduled_at
                      ? new Date(job.scheduled_at).toLocaleString()
                      : "Not scheduled"}
                  </p>
                  <Chip tone={statusTone(job.status)}>{statusLabel(job.status)}</Chip>
                  <div className="flex items-center gap-2">
                    <Link
                      to="/client/jobs/$jobId"
                      params={{ jobId: job.id }}
                      className="press inline-flex h-10 items-center rounded-xl border border-border bg-card px-3 text-base font-medium"
                    >
                      View
                    </Link>
                    {job.status === "POSTED" && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            type="button"
                            disabled={cancellingJobId === job.id}
                            className="press inline-flex h-10 items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/10 px-3 text-base font-medium text-destructive disabled:opacity-60"
                          >
                            <XCircle className="h-4 w-4" /> Cancel
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Cancel this posted job?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Cancellation is permanent and is allowed only while the job remains
                              unassigned.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep job</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void cancelJob(job.id)}>
                              Cancel job
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
