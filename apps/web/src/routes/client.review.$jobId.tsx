import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Camera,
  Check,
  Clock3,
  Loader2,
  MapPin,
  Mic,
  ShieldCheck,
  ThumbsDown,
  Volume2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/portal-shell";
import {
  AnonymousBadge,
  Chip,
  SectionCard,
  SuccessCheck,
} from "@/components/marketplace/primitives";
import { api, ApiError, type EvidenceSummary, type Job } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

export const Route = createFileRoute("/client/review/$jobId")({
  component: ReviewPage,
});

const mediaIcon = { IMAGE: Camera, VIDEO: Camera, AUDIO: Volume2, DOCUMENT: Camera } as const;

function mediaLabel(type: EvidenceSummary["media_type"]): string {
  return type === "IMAGE"
    ? "Photo"
    : type === "VIDEO"
      ? "Video"
      : type === "AUDIO"
        ? "Audio"
        : "Document";
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return "Unable to load evidence. Check your connection and try again.";
}

function ReviewPage() {
  const { jobId } = Route.useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [evidence, setEvidence] = useState<EvidenceSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState(false);
  const [isDisputing, setIsDisputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approvalKeyRef = useRef<string | null>(null);

  const loadEvidence = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.clientJobEvidence(jobId);
      setJob(result.job);
      setEvidence(result.evidence);
      setError(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void loadEvidence();
  }, [loadEvidence]);

  const approveJob = useCallback(async () => {
    setIsApproving(true);
    try {
      approvalKeyRef.current ??= globalThis.crypto.randomUUID();
      await api.approveClientJob(jobId, approvalKeyRef.current);
      await loadEvidence();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsApproving(false);
    }
  }, [jobId, loadEvidence]);

  const downloadEvidence = useCallback(
    async (mediaId: string) => {
      try {
        const { url } = await api.clientEvidenceDownloadUrl(jobId, mediaId);
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (requestError) {
        setError(errorMessage(requestError));
      }
    },
    [jobId],
  );

  const openDispute = useCallback(async () => {
    setIsDisputing(true);
    try {
      const reason = window.prompt("Why are you disputing this submission? (min 3 characters)");
      if (!reason || reason.trim().length < 3) return;
      await api.openDispute(jobId, reason.trim());
      toast.success("Dispute opened. Escrow is frozen for review.");
      await loadEvidence();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsDisputing(false);
    }
  }, [jobId, loadEvidence]);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-6 p-6">
        <div className="h-24 rounded-2xl bg-muted" />
        <div className="h-80 rounded-2xl bg-muted" />
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

  const uploaded = evidence.filter((e) => e.status === "UPLOADED" || e.status === "VERIFIED");

  if (job.status === "APPROVED" || job.status === "COMPLETED") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
        <SuccessCheck />
        <h1 className="mt-6 text-4xl font-semibold">Work approved</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          {formatCurrency(job.budget_cents / 100)} released from escrow to the Verified Worker.
        </p>
        <Link
          to="/client/jobs"
          className="press gradient-brand mt-6 inline-flex rounded-xl px-4 py-2.5 text-base font-semibold text-primary-foreground"
        >
          Back to jobs
        </Link>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Review evidence"
        description={`${job.id} · ${uploaded.length} items captured in-app`}
        action={
          <Link
            to="/client/jobs/$jobId"
            params={{ jobId }}
            className="press inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-base font-medium"
          >
            <ArrowLeft className="h-4 w-4" /> Job details
          </Link>
        }
      />

      {error && (
        <p role="alert" className="mb-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            <div className="surface-grid relative grid h-[320px] place-items-center bg-muted/40 sm:h-[420px]">
              <div className="absolute inset-0 bg-[var(--gradient-surface)]" aria-hidden />
              {evidence.length > 0 ? (
                <div className="relative grid gap-3 p-6 text-center">
                  <ShieldCheck className="mx-auto h-16 w-16 text-success" />
                  <p className="text-lg font-semibold text-foreground">
                    {uploaded.length} verified evidence item{uploaded.length === 1 ? "" : "s"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Captured in-app with GPS, timestamp, and SHA-256 verification.
                  </p>
                </div>
              ) : (
                <ShieldCheck className="relative h-16 w-16 text-muted-foreground" />
              )}
            </div>
          </div>

          <SectionCard title="Evidence gallery" description="Uploaded and version-pinned media">
            {evidence.length === 0 ? (
              <p className="text-base text-muted-foreground">
                No evidence has been uploaded for this job yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {evidence.map((item) => {
                  const Icon = mediaIcon[item.media_type];
                  return (
                    <li key={item.id} className="rounded-xl border border-border bg-muted/40 p-4">
                      <div className="flex items-start gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                          <Icon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-semibold">
                            {mediaLabel(item.media_type)} evidence
                          </p>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {item.mime_type ?? "Unknown type"} ·{" "}
                            {item.file_size_bytes
                              ? `${Math.round(item.file_size_bytes / 1024)} KB`
                              : "Unknown size"}
                          </p>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            Captured {new Date(item.captured_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Chip
                            tone={
                              item.status === "UPLOADED" || item.status === "VERIFIED"
                                ? "success"
                                : "neutral"
                            }
                          >
                            {item.status.replaceAll("_", " ")}
                          </Chip>
                          {(item.status === "UPLOADED" || item.status === "VERIFIED") && (
                            <button
                              type="button"
                              onClick={() => void downloadEvidence(item.id)}
                              className="press rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-medium"
                            >
                              Download
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Submission summary">
            <div className="space-y-3 text-base">
              {[
                ["Evidence items", String(uploaded.length)],
                ["Job status", job.status.replaceAll("_", " ")],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-4">
              <AnonymousBadge role="Worker" />
            </div>
          </SectionCard>

          <SectionCard title="Approval">
            <p className="text-base text-muted-foreground">
              Approving releases escrow to the worker and records the settlement in the immutable
              ledger.
            </p>
            <button
              type="button"
              onClick={() => void approveJob()}
              disabled={isApproving || job.status !== "SUBMITTED"}
              className={cn(
                "press mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold",
                job.status === "SUBMITTED"
                  ? "bg-success text-success-foreground"
                  : "cursor-not-allowed bg-muted text-muted-foreground",
              )}
            >
              {isApproving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {isApproving ? "Approving..." : "Approve & release payout"}
            </button>
            <button
              type="button"
              onClick={() => void openDispute()}
              disabled={isDisputing || job.status !== "SUBMITTED"}
              className="press mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 text-base font-semibold text-destructive disabled:opacity-60"
            >
              {isDisputing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ThumbsDown className="h-4 w-4" />
              )}
              {isDisputing ? "Opening dispute..." : "Dispute submission"}
            </button>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
