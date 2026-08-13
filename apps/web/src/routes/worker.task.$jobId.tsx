import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  CircleAlert,
  Loader2,
  MapPin,
  Send,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import {
  api,
  ApiError,
  type EvidenceSummary,
  type JobStatus,
  type WorkerJobDetail,
} from "@/lib/api";
import { cn, formatCurrency } from "@/lib/utils";
import { Chip } from "@/components/marketplace/primitives";

export const Route = createFileRoute("/worker/task/$jobId")({
  head: () => ({
    meta: [
      { title: "Live task execution - NetworkPeers" },
      {
        name: "description",
        content:
          "Advance work, upload version-pinned evidence, and submit completion to the NetworkPeer API.",
      },
    ],
  }),
  component: TaskExecution,
});

const nextWorkStatus: Partial<Record<JobStatus, "EN_ROUTE" | "AT_LOCATION" | "IN_PROGRESS">> = {
  ASSIGNED: "EN_ROUTE",
  EN_ROUTE: "AT_LOCATION",
  AT_LOCATION: "IN_PROGRESS",
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return "The task action could not be completed. Check your connection and try again.";
}

function mediaTypeFor(file: File): "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" | null {
  if (file.type.startsWith("image/")) return "IMAGE";
  if (file.type.startsWith("video/")) return "VIDEO";
  if (file.type.startsWith("audio/")) return "AUDIO";
  if (file.type === "application/pdf") return "DOCUMENT";
  return null;
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function TaskExecution() {
  const { jobId } = Route.useParams();
  const [job, setJob] = useState<WorkerJobDetail | null>(null);
  const [evidenceBySubtask, setEvidenceBySubtask] = useState<Record<string, EvidenceSummary>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [uploadingSubtaskId, setUploadingSubtaskId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJob = useCallback(async () => {
    setIsLoading(true);
    try {
      setJob(await api.workerJob(jobId));
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

  const requiredSubtasks = useMemo(
    () => job?.subtasks.filter((subtask) => subtask.is_required) ?? [],
    [job],
  );
  const completedEvidenceCount = requiredSubtasks.filter(
    (subtask) => evidenceBySubtask[subtask.id]?.status === "UPLOADED",
  ).length;
  const readyToSubmit =
    job?.status === "IN_PROGRESS" && completedEvidenceCount === requiredSubtasks.length;
  const nextStatus = job ? nextWorkStatus[job.status] : undefined;

  const advanceWork = useCallback(async () => {
    if (!nextStatus) return;
    setIsAdvancing(true);
    try {
      const updated = await api.advanceWorkStatus(jobId, nextStatus);
      setJob((current) => (current ? { ...current, status: updated.status } : current));
      toast.success(`Work status updated to ${nextStatus.replaceAll("_", " ")}.`);
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      toast.error(message);
    } finally {
      setIsAdvancing(false);
    }
  }, [jobId, nextStatus]);

  const uploadEvidence = useCallback(
    async (subtaskId: string, file: File) => {
      if (!job || job.status !== "IN_PROGRESS") {
        const message = "Advance the job to IN PROGRESS before capturing evidence.";
        setError(message);
        toast.error(message);
        return;
      }
      const mediaType = mediaTypeFor(file);
      if (!mediaType || !file.type) {
        const message = "Choose a JPEG, PNG, WebP, MP4, MOV, WebM, MP3, WAV, or PDF evidence file.";
        setError(message);
        toast.error(message);
        return;
      }

      setUploadingSubtaskId(subtaskId);
      try {
        const reservation = await api.reserveEvidenceUpload({
          jobId,
          subtaskId,
          mediaType,
          mimeType: file.type,
          fileSizeBytes: file.size,
          capturedAt: new Date().toISOString(),
          checksumSha256: await sha256Hex(file),
          idempotencyKey: crypto.randomUUID(),
        });
        if (reservation.upload) await api.uploadEvidenceToStorage(reservation.upload, file);
        const confirmed = await api.confirmEvidence(reservation.evidence.id);
        setEvidenceBySubtask((current) => ({ ...current, [subtaskId]: confirmed }));
        setError(null);
        toast.success("Evidence uploaded, version-pinned, and confirmed.");
      } catch (requestError) {
        const message = errorMessage(requestError);
        setError(message);
        toast.error(message);
      } finally {
        setUploadingSubtaskId(null);
      }
    },
    [job, jobId],
  );

  const submitWork = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const submitted = await api.submitWork(jobId);
      setJob((current) => (current ? { ...current, status: submitted.status } : current));
      setError(null);
      toast.success("Evidence submitted for client review and escrow release.");
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [jobId]);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 p-4">
        <div className="h-24 rounded-2xl bg-muted" />
        <div className="h-64 rounded-2xl bg-muted" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="space-y-4 p-6">
        <Link
          to="/worker"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"
        >
          <ArrowLeft className="h-4 w-4" /> Back to nearby jobs
        </Link>
        <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {error ?? "Job not found."}
        </p>
      </div>
    );
  }

  if (job.status === "SUBMITTED" || job.status === "APPROVED" || job.status === "COMPLETED") {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-full bg-success/20 text-success">
          <CheckCircle2 className="h-10 w-10" />
        </span>
        <h1 className="mt-5 text-xl font-bold">Work submitted</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          The API recorded the required evidence and the job is now{" "}
          {job.status.replaceAll("_", " ").toLowerCase()}.
        </p>
        <Link
          to="/worker/wallet"
          className="press gradient-brand mt-6 inline-flex h-11 items-center rounded-xl px-6 text-sm font-semibold text-primary-foreground"
        >
          View wallet
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4">
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <Link
          to="/worker/job/$jobId"
          params={{ jobId }}
          aria-label="Back"
          className="press grid h-9 w-9 place-items-center rounded-xl border border-border bg-card"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{job.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {formatCurrency(job.budget_cents / 100)} · {job.status.replaceAll("_", " ")}
          </p>
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="mt-4 flex gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      ) : null}

      <section className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div>
            <p className="text-sm font-medium">Live job state</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every transition is validated by PostgreSQL before evidence can be accepted.
            </p>
          </div>
          <Chip tone={job.status === "IN_PROGRESS" ? "success" : "primary"}>
            {job.status.replaceAll("_", " ")}
          </Chip>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip tone="success">
            <MapPin className="h-3.5 w-3.5" /> Assigned location
          </Chip>
          <Chip tone="primary">
            <ShieldCheck className="h-3.5 w-3.5" /> SHA-256 verified
          </Chip>
        </div>
        {nextStatus ? (
          <button
            type="button"
            onClick={() => void advanceWork()}
            disabled={isAdvancing}
            className="press gradient-brand mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-primary-foreground disabled:opacity-70"
          >
            {isAdvancing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {isAdvancing ? "Updating job" : `Mark ${nextStatus.replaceAll("_", " ")}`}
          </button>
        ) : null}
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Required evidence</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              S3 accepts the upload only after the API reserves its exact checksum, type, and size.
            </p>
          </div>
          <span className="text-sm font-bold text-primary">
            {completedEvidenceCount}/{requiredSubtasks.length}
          </span>
        </div>
        {job.subtasks.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No checklist evidence is required for this job.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {job.subtasks.map((subtask, index) => {
              const evidence = evidenceBySubtask[subtask.id];
              const confirmed = evidence?.status === "UPLOADED";
              const uploading = uploadingSubtaskId === subtask.id;
              return (
                <li
                  key={subtask.id}
                  className={cn(
                    "rounded-xl border p-3",
                    confirmed ? "border-success/50 bg-success/10" : "border-border bg-muted/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {index + 1}. {subtask.title}
                      </p>
                      {subtask.description ? (
                        <p className="mt-1 text-xs text-muted-foreground">{subtask.description}</p>
                      ) : null}
                    </div>
                    {confirmed ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" /> : null}
                  </div>
                  {subtask.is_required ? (
                    <label
                      className={cn(
                        "press mt-3 flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border text-sm font-semibold",
                        job.status === "IN_PROGRESS"
                          ? "border-primary/40 bg-card text-primary"
                          : "cursor-not-allowed border-border text-muted-foreground",
                      )}
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Camera className="h-4 w-4" />
                      )}
                      {confirmed
                        ? "Evidence confirmed"
                        : uploading
                          ? "Uploading evidence"
                          : "Capture or select evidence"}
                      <input
                        type="file"
                        className="sr-only"
                        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/wav,audio/webm,application/pdf"
                        capture="environment"
                        disabled={job.status !== "IN_PROGRESS" || uploading || confirmed}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) void uploadEvidence(subtask.id, file);
                        }}
                      />
                    </label>
                  ) : (
                    <Chip>Optional evidence</Chip>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="glass sticky bottom-20 z-20 mt-4 rounded-2xl p-2">
        <button
          type="button"
          disabled={!readyToSubmit || isSubmitting}
          onClick={() => void submitWork()}
          className={cn(
            "press flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all",
            readyToSubmit && !isSubmitting
              ? "gradient-brand shadow-glow text-primary-foreground"
              : "cursor-not-allowed bg-muted text-muted-foreground",
          )}
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {isSubmitting
            ? "Submitting work"
            : readyToSubmit
              ? "Submit evidence for review"
              : `${Math.max(0, requiredSubtasks.length - completedEvidenceCount)} required captures remaining`}
        </button>
      </div>
    </div>
  );
}
