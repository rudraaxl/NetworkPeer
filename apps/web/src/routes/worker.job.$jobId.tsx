import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Clock3, Loader2, MapPin, Wallet } from "lucide-react";
import { toast } from "sonner";

import { api, ApiError, type WorkerJobDetail } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { AnonymousBadge, Chip } from "@/components/marketplace/primitives";

export const Route = createFileRoute("/worker/job/$jobId")({
  head: () => ({
    meta: [
      { title: "Job details — NetworkPeers Worker" },
      {
        name: "description",
        content: "Review a privacy-safe job brief and accept available work.",
      },
    ],
  }),
  component: WorkerJob,
});

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return "Unable to load this job. Check your connection and try again.";
}

function JobDetailSkeleton() {
  return (
    <div className="animate-pulse space-y-4 px-4 py-6" aria-busy="true" aria-label="Loading job">
      <div className="h-32 rounded-2xl bg-muted" />
      <div className="h-48 rounded-2xl bg-muted" />
      <div className="h-12 rounded-2xl bg-muted" />
    </div>
  );
}

function WorkerJob() {
  const { jobId } = Route.useParams();
  const [job, setJob] = useState<WorkerJobDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJob = useCallback(async () => {
    setIsLoading(true);
    try {
      const detail = await api.workerJob(jobId);
      setJob(detail);
      setError(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void loadJob();
  }, [loadJob]);

  const acceptJob = useCallback(async () => {
    setIsAccepting(true);
    try {
      const acceptedJob = await api.acceptWorkerJob(jobId);
      setJob(acceptedJob);
      setError(null);
      toast.success("Job accepted. Its location and checklist are now available.");
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      toast.error(message);
    } finally {
      setIsAccepting(false);
    }
  }, [jobId]);

  if (isLoading) return <JobDetailSkeleton />;

  if (!job) {
    return (
      <div className="space-y-4 px-4 py-8">
        <Link
          to="/worker"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Back to nearby jobs
        </Link>
        <p role="alert" className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? "Job not found."}
        </p>
      </div>
    );
  }

  const assignmentVisible = job.is_assigned_to_requester;

  return (
    <div>
      <div className="gradient-brand relative px-4 pb-16 pt-4 text-primary-foreground">
        <Link
          to="/worker"
          className="press inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/15 px-3 py-1.5 text-xs font-medium"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
        <p className="mt-4 text-xs opacity-85">{job.category}</p>
        <h1 className="mt-1 text-2xl font-bold leading-snug">{job.title}</h1>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-primary-foreground/15 px-3 py-2.5">
            <p className="text-[11px] opacity-85">Payment</p>
            <p className="text-sm font-semibold">{formatCurrency(job.budget_cents / 100)}</p>
          </div>
          <div className="rounded-2xl bg-primary-foreground/15 px-3 py-2.5">
            <p className="text-[11px] opacity-85">Status</p>
            <p className="text-sm font-semibold">{job.status.replaceAll("_", " ")}</p>
          </div>
        </div>
      </div>

      <div className="-mt-10 space-y-4 px-4">
        {error && (
          <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-lift">
          <div className="flex items-center justify-between gap-3">
            <AnonymousBadge role="Client" />
            <Chip tone="neutral">{job.status.replaceAll("_", " ")}</Chip>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{job.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {job.scheduled_at && (
              <Chip>
                <Clock3 className="h-3.5 w-3.5" /> {new Date(job.scheduled_at).toLocaleString()}
              </Chip>
            )}
            {assignmentVisible && job.address && (
              <Chip>
                <MapPin className="h-3.5 w-3.5" /> {job.address}
              </Chip>
            )}
          </div>
          {!assignmentVisible && (
            <p className="mt-3 text-xs text-muted-foreground">
              The precise location, address, and evidence checklist are available only after
              acceptance.
            </p>
          )}
        </section>

        {assignmentVisible && (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <h2 className="text-sm font-semibold">Checklist ({job.subtasks.length} tasks)</h2>
            {job.subtasks.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {job.subtasks.map((subtask, index) => (
                  <li key={subtask.id} className="rounded-xl bg-muted/50 p-3">
                    <p className="text-sm font-medium">
                      {index + 1}. {subtask.title}
                    </p>
                    {subtask.description && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{subtask.description}</p>
                    )}
                    {subtask.is_required && <Chip tone="primary">Evidence required</Chip>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">This job has no checklist items.</p>
            )}
          </section>
        )}

        {assignmentVisible && job.status !== "SUBMITTED" && job.status !== "COMPLETED" && (
          <Link
            to="/worker/task/$jobId"
            params={{ jobId: job.id }}
            className="press gradient-brand shadow-glow flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-primary-foreground"
          >
            <CheckCircle2 className="h-4 w-4" /> Continue live task
          </Link>
        )}

        <section className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-success/20 text-success">
              <Wallet className="h-4 w-4" />
            </span>
            <p className="text-xs text-muted-foreground">
              Budget and settlement are enforced by the backend; the client identity remains
              private.
            </p>
          </div>
        </section>
      </div>

      {!assignmentVisible && (
        <div className="glass sticky bottom-20 z-20 mx-4 mt-4 rounded-2xl p-2">
          <button
            type="button"
            onClick={() => void acceptJob()}
            disabled={isAccepting}
            className="press gradient-brand shadow-glow flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isAccepting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {isAccepting
              ? "Accepting job"
              : `Accept job · ${formatCurrency(job.budget_cents / 100)}`}
          </button>
        </div>
      )}
    </div>
  );
}
