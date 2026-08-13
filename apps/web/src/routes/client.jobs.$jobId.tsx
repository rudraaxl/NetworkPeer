import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  CreditCard,
  Loader2,
  MapPin,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  type FundingResult,
  type Job,
  type JobStatus,
  type JobSubtask,
} from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { AnonymousBadge, Chip, SectionCard } from "@/components/marketplace/primitives";
import { PageHeader } from "@/components/shell/portal-shell";

export const Route = createFileRoute("/client/jobs/$jobId")({
  head: () => ({
    meta: [
      { title: "Job details — NetworkPeers client" },
      { name: "description", content: "Authoritative job details and checklist status." },
    ],
  }),
  component: JobDetails,
});

function statusTone(status: JobStatus): "neutral" | "primary" | "success" | "danger" | "teal" {
  if (status === "COMPLETED" || status === "APPROVED") return "success";
  if (status === "CANCELLED" || status === "DISPUTED") return "danger";
  if (status === "POSTED") return "teal";
  if (status === "SUBMITTED") return "primary";
  return "neutral";
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return "Unable to load this job. Check your connection and try again.";
}

function JobDetails() {
  const { jobId } = Route.useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [subtasks, setSubtasks] = useState<JobSubtask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [funding, setFunding] = useState<FundingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fundingKeyRef = useRef<string | null>(null);
  const approvalKeyRef = useRef<string | null>(null);

  const loadJob = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.clientJob(jobId);
      setJob(result.job);
      setSubtasks(result.subtasks);
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

  const cancelJob = useCallback(async () => {
    setIsCancelling(true);
    try {
      const result = await api.cancelClientJob(jobId);
      setJob(result.job);
      toast.success("Job cancelled.");
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      toast.error(message);
    } finally {
      setIsCancelling(false);
    }
  }, [jobId]);

  const fundJob = useCallback(async () => {
    setIsFunding(true);
    try {
      fundingKeyRef.current ??= globalThis.crypto.randomUUID();
      const result = await api.fundClientJob(jobId, fundingKeyRef.current);
      setFunding(result);
      await loadJob();
      toast.success(
        result.status === "PENDING"
          ? "Escrow funding is pending gateway confirmation."
          : `Funding operation is ${result.status.toLowerCase()}.`,
      );
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      toast.error(message);
    } finally {
      setIsFunding(false);
    }
  }, [jobId, loadJob]);

  const approveJob = useCallback(async () => {
    setIsApproving(true);
    try {
      approvalKeyRef.current ??= globalThis.crypto.randomUUID();
      const approval = await api.approveClientJob(jobId, approvalKeyRef.current);
      await loadJob();
      toast.success(
        approval.payoutDispatchPending
          ? "Work approved. Payout dispatch is queued."
          : "Work approved and payout dispatch started.",
      );
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      toast.error(message);
    } finally {
      setIsApproving(false);
    }
  }, [jobId, loadJob]);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-5 p-6">
        <div className="h-24 rounded-2xl bg-muted" />
        <div className="h-64 rounded-2xl bg-muted" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="space-y-4 p-6">
        <Link
          to="/client/jobs"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Back to jobs
        </Link>
        <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? "Job not found."}
        </p>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={job.title}
        description={`${job.id} · ${job.category} · posted ${new Date(job.created_at).toLocaleString()}`}
        action={
          <Link
            to="/client/jobs"
            className="press inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-base font-medium"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        }
      />

      {error && (
        <p role="alert" className="mb-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Chip tone={statusTone(job.status)}>{job.status.replaceAll("_", " ")}</Chip>
        {job.worker_id && <AnonymousBadge role="Worker" />}
        <Chip tone="teal">{formatCurrency(job.budget_cents / 100)} budget</Chip>
        {job.scheduled_at && (
          <Chip>
            <Clock3 className="h-3.5 w-3.5" /> {new Date(job.scheduled_at).toLocaleString()}
          </Chip>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-3">
        {job.status === "FUNDING" && (
          <button
            type="button"
            onClick={() => void fundJob()}
            disabled={isFunding}
            className="press gradient-brand inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-semibold text-primary-foreground disabled:opacity-60"
          >
            {isFunding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="h-4 w-4" />
            )}
            {isFunding ? "Starting escrow funding" : "Fund escrow"}
          </button>
        )}
        {job.status === "SUBMITTED" && (
          <button
            type="button"
            onClick={() => void approveJob()}
            disabled={isApproving}
            className="press gradient-brand inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-semibold text-primary-foreground disabled:opacity-60"
          >
            {isApproving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {isApproving ? "Approving work" : "Approve and release payout"}
          </button>
        )}
        {job.status === "FUNDING" && (
          <button
            type="button"
            onClick={() => void cancelJob()}
            disabled={isCancelling}
            className="press inline-flex h-11 items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 text-base font-semibold text-destructive disabled:opacity-60"
          >
            {isCancelling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            Cancel job
          </button>
        )}
      </div>
      {funding?.providerReference ? (
        <p className="mb-6 rounded-xl border border-primary/30 bg-primary-soft p-3 text-sm text-muted-foreground">
          Stripe test payment intent:{" "}
          <code className="font-semibold text-foreground">{funding.providerReference}</code>.
          Confirm it in Stripe test mode; the verified webhook publishes this job to nearby workers.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <SectionCard title="Brief">
            <p className="text-base leading-relaxed text-muted-foreground">{job.description}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-base text-muted-foreground">Address</p>
                <p className="mt-0.5 truncate text-base font-semibold">
                  {job.address ?? "Not provided"}
                </p>
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-base text-muted-foreground">Budget</p>
                <p className="mt-0.5 text-base font-semibold">
                  {formatCurrency(job.budget_cents / 100)}
                </p>
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-base text-muted-foreground">Coordinates</p>
                <p className="mt-0.5 truncate text-base font-semibold">
                  {job.location.coordinates[1].toFixed(5)}, {job.location.coordinates[0].toFixed(5)}
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Checklist"
            description="The backend enforces evidence for required items before submission."
          >
            {subtasks.length > 0 ? (
              <ul className="space-y-3">
                {subtasks.map((subtask, index) => (
                  <li key={subtask.id} className="rounded-2xl border border-border p-4">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold">
                          {index + 1}. {subtask.title}
                        </p>
                        {subtask.description && (
                          <p className="mt-0.5 text-base text-muted-foreground">
                            {subtask.description}
                          </p>
                        )}
                      </div>
                      <Chip tone={subtask.status === "COMPLETED" ? "success" : "neutral"}>
                        {subtask.status.replaceAll("_", " ")}
                      </Chip>
                    </div>
                    {subtask.is_required && <Chip tone="primary">Evidence required</Chip>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-base text-muted-foreground">
                No checklist items were added to this job.
              </p>
            )}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Location">
            <p className="flex items-start gap-2 text-base text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              {job.address ?? "Coordinates are available above."}
            </p>
          </SectionCard>
          <SectionCard title="Settlement state">
            <p className="text-base text-muted-foreground">
              {job.status === "FUNDING"
                ? "Funding is created through the API and published only after the payment gateway webhook settles escrow."
                : job.status === "SUBMITTED"
                  ? "The worker has submitted required evidence. Approve work to release the queued payout."
                  : "The backend is the source of truth for this job lifecycle and its escrow state."}
            </p>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
