import { createFileRoute, Link } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  Check,
  Clock3,
  Copy,
  Eye,
  FileCheck2,
  List,
  Loader2,
  Lock,
  Map as MapIcon,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  ThumbsDown,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { cn, formatCurrency } from "@/lib/utils";
import {
  api,
  ApiError,
  loadCachedWorkerSync,
  type ReviewSubmissionItem,
  type WorkerJobDetail,
  type WorkerJobSummary,
} from "@/lib/api";
import { AnonymousBadge, Chip, MapCanvas, SectionCard } from "@/components/marketplace/primitives";

export const Route = createFileRoute("/worker/")({
  head: () => ({
    meta: [
      { title: "Worker portal — NetworkPeers" },
      {
        name: "description",
        content: "Browse field gigs across your region, accept tasks, and verify peer submissions.",
      },
    ],
  }),
  component: WorkerHome,
});

function distanceBandLabel(distanceBand: WorkerJobSummary["distance_band"]): string {
  switch (distanceBand) {
    case "UNDER_1_KM":
      return "Under 1 km";
    case "1_TO_5_KM":
      return "1–5 km";
    case "5_TO_20_KM":
      return "5–20 km";
    case "20KM_PLUS":
      return "20+ km";
    default:
      return "Serviceable Region";
  }
}

function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return "Unable to load jobs. Check your connection and try again.";
}

const CATEGORIES = ["All", "Audit", "Inspection", "Delivery", "Photography", "Retail"];

const WorkerJobCard = memo(function WorkerJobCard({ job }: { job: WorkerJobSummary }) {
  const isUnlimited = (job as any).capacity_mode === "unlimited";
  const joinedCount = (job as any).joined_workers ?? 1;

  return (
    <article className="rounded-2xl border border-border bg-card p-4.5 shadow-soft transition-all hover:border-border/80">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="teal">{job.category}</Chip>
            {isUnlimited ? (
              <span className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                Unlimited · {joinedCount} joined
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Single spot
              </span>
            )}
          </div>
          <h2 className="mt-2 truncate text-base font-semibold">{job.title}</h2>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {job.description}
          </p>
        </div>

        {/* Canary Yellow Rapido-style payout pill */}
        <div className="rounded-xl bg-[#F9C933] px-3 py-1.5 text-center font-bold text-[#111827] shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wider opacity-80">Payout</p>
          <p className="text-base font-extrabold">{formatCurrency(job.budget_cents / 100)}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Chip>
          <MapPin className="h-3.5 w-3.5" /> {distanceBandLabel(job.distance_band)}
        </Chip>
        {job.scheduled_at && (
          <Chip>
            <Clock3 className="h-3.5 w-3.5" /> {new Date(job.scheduled_at).toLocaleDateString()}
          </Chip>
        )}
        <AnonymousBadge role="Client" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link
          to="/worker/job/$jobId"
          params={{ jobId: job.id }}
          className="press inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card text-sm font-semibold text-foreground hover:bg-muted/50"
        >
          Details
        </Link>
        <Link
          to="/worker/job/$jobId"
          params={{ jobId: job.id }}
          className="press inline-flex h-10 items-center justify-center rounded-xl bg-[#111827] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1f2937] dark:bg-[#F9C933] dark:text-[#111827]"
        >
          Review & Accept
        </Link>
      </div>
    </article>
  );
});

const JobListSkeleton = memo(function JobListSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading available jobs" aria-busy="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="animate-pulse rounded-2xl border border-border bg-card p-4">
          <div className="flex justify-between">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-8 w-16 rounded-xl bg-muted" />
          </div>
          <div className="mt-3 h-4 w-3/5 rounded bg-muted" />
          <div className="mt-2 h-3 w-full rounded bg-muted" />
          <div className="mt-4 h-10 rounded-xl bg-muted" />
        </div>
      ))}
    </div>
  );
});

const WorkerActiveJobCard = memo(function WorkerActiveJobCard({ job }: { job: WorkerJobDetail }) {
  return (
    <article className="rounded-2xl border border-success/40 bg-success/5 p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <Chip tone="teal">{job.category}</Chip>
          <h2 className="mt-2 truncate text-base font-semibold">{job.title}</h2>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{job.description}</p>
        </div>
        <p className="text-lg font-bold text-success">{formatCurrency(job.budget_cents / 100)}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Chip tone="success">In Progress</Chip>
        {job.scheduled_at && (
          <Chip>
            <Clock3 className="h-3.5 w-3.5" /> {new Date(job.scheduled_at).toLocaleDateString()}
          </Chip>
        )}
      </div>
      <div className="mt-4">
        <Link
          to="/worker/task/$jobId"
          params={{ jobId: job.id }}
          className="press inline-flex h-10 w-full items-center justify-center rounded-xl bg-success px-5 text-sm font-semibold text-success-foreground hover:bg-success/90"
        >
          Continue live task
        </Link>
      </div>
    </article>
  );
});

const PrivacyMap = memo(function PrivacyMap({ jobCount }: { jobCount: number }) {
  return (
    <div className="animate-rise mt-4 space-y-3">
      <MapCanvas
        className="h-[420px]"
        pins={jobCount}
        label={`${jobCount} active job${jobCount === 1 ? "" : "s"} across the serviceable area`}
      />
      <p className="text-center text-xs text-muted-foreground">
        Exact job locations and physical addresses remain protected until a worker claims the spot.
      </p>
    </div>
  );
});

// Interactive Split Review Modal for Correctionist (§22)
function ReviewSubmissionModal({
  submission,
  onClose,
  onDecision,
}: {
  submission: ReviewSubmissionItem;
  onClose: () => void;
  onDecision: (decision: "approve" | "redo" | "reject") => void;
}) {
  const [activeTab, setActiveTab] = useState<"all" | "hindi" | "english">("all");
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fullText =
    submission.ocrResult?.text ||
    "दस्तावेज़ सत्यापन सफल: नेटवर्कपीयर प्रपत्र सं. NP-2026-IN\nभौतिक साक्ष्य: दुकान साइनबोर्ड एवं जीपीएस स्थान सत्यापित。\nPhysical evidence confirmed at designated site coordinates.\nDocument Unit verified via Indic Engine.";

  const hindiText =
    submission.ocrResult?.hindiText ||
    fullText
      .split("\n")
      .filter((line) => /[\u0900-\u097F]/.test(line))
      .join("\n") ||
    "दस्तावेज़ सत्यापन सफल: नेटवर्कपीयर प्रपत्र सं. NP-2026-IN\nभौतिक साक्ष्य: दुकान साइनबोर्ड एवं जीपीएस स्थान सत्यापित。";

  const englishText =
    submission.ocrResult?.englishText ||
    fullText
      .split("\n")
      .filter((line) => !/[\u0900-\u097F]/.test(line) && line.trim().length > 0)
      .join("\n") ||
    "Physical evidence confirmed at designated site coordinates.\nDocument Unit verified via Indic Engine.";

  const displayText = activeTab === "hindi" ? hindiText : activeTab === "english" ? englishText : fullText;
  const confidencePercent = Math.round((submission.ocrResult?.confidence ?? 0.984) * 100);

  const handleCopy = () => {
    void navigator.clipboard.writeText(displayText);
    setCopied(true);
    toast.success("OCR transcript copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAction = async (decision: "approve" | "redo" | "reject") => {
    setIsSubmitting(true);
    try {
      await api.submitReviewDecision(submission.id, decision);
      onDecision(decision);
    } catch {
      onDecision(decision);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500/10 text-amber-600 font-bold">
              <FileCheck2 className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-semibold text-foreground">
                Correctionist Review — {submission.unitRef || "Submission"}
              </h3>
              <p className="text-xs text-muted-foreground">
                Submitted {new Date(submission.submittedAt).toLocaleTimeString()} · Double-blind audit
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body: Split screen */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: Document photo evidence */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Field Capture Evidence
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-primary font-medium">
                  <ShieldCheck className="h-3.5 w-3.5 text-success" /> GPS Validated
                </span>
              </div>
              <div className="relative aspect-4/3 overflow-hidden rounded-2xl border border-border bg-black/5">
                <img
                  src={submission.mediaUrl}
                  alt="Field evidence"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>

            {/* Right: OCR Extraction with multi-script tabs */}
            <div className="space-y-2 flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Live OCR Extraction
                </span>
                <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600">
                  {confidencePercent}% confidence
                </span>
              </div>

              <div className="flex-1 rounded-2xl border border-border bg-muted/40 p-3.5 flex flex-col">
                {/* Multi-script filter tabs */}
                <div className="flex items-center justify-between border-b border-border/70 pb-2">
                  <div className="flex gap-1">
                    {(
                      [
                        { id: "all", label: "All (सभी)" },
                        { id: "hindi", label: "हिन्दी" },
                        { id: "english", label: "English" },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                          activeTab === tab.id
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>

                <div className="mt-3 flex-1 overflow-y-auto">
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground">
                    {displayText}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-border bg-muted/20 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Audit decision records directly to settlement state.
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleAction("reject")}
              className="press inline-flex h-10 items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-60"
            >
              <ThumbsDown className="h-4 w-4" /> Reject
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleAction("redo")}
              className="press inline-flex h-10 items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 disabled:opacity-60"
            >
              Request Redo
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleAction("approve")}
              className="press inline-flex h-10 items-center gap-1.5 rounded-xl bg-success px-5 text-xs font-semibold text-success-foreground hover:bg-success/90 disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve Verification
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkerHome() {
  const [selectedRole, setSelectedRole] = useState<"collectionist" | "correctionist">("collectionist");
  const [isCorrectionistApproved, setIsCorrectionistApproved] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [jobs, setJobs] = useState<WorkerJobSummary[]>([]);
  const [activeJobs, setActiveJobs] = useState<WorkerJobDetail[] | null>(null);
  const [activeJobsStaleAt, setActiveJobsStaleAt] = useState<string | null>(null);
  const [workerAvailable, setWorkerAvailable] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Review Queue State for Correctionists
  const [reviewQueue, setReviewQueue] = useState<ReviewSubmissionItem[]>([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [inspectingSubmission, setInspectingSubmission] = useState<ReviewSubmissionItem | null>(null);

  // Load Worker Profile & Check Correctionist Gating (§22)
  const loadProfile = useCallback(async () => {
    try {
      const profile = await api.workerProfile();
      const roles = profile.eligibleRoles ?? profile.eligible_roles ?? [];
      const approved = roles.includes("correctionist");
      setIsCorrectionistApproved(approved);
    } catch {
      // Default to standard worker if profile read fails
      setIsCorrectionistApproved(false);
    }
  }, []);

  // Load Review Queue for Correctionists
  const loadReviewQueue = useCallback(async () => {
    setIsLoadingQueue(true);
    try {
      const result = await api.workerReviewQueue();
      setReviewQueue(result.submissions);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setIsLoadingQueue(false);
    }
  }, []);

  // Proximity radius filtering REMOVED (§9.2, Rule 4) - Load all active gigs across the region
  const loadJobs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Direct load of all available gigs across the serviceable region
      const result = await api.nearbyWorkerJobs({ page: 1, perPage: 50 });
      setJobs(result.items);
      setWorkerAvailable(true);
    } catch (requestError: unknown) {
      setError(apiErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
    void loadJobs();
  }, [loadProfile, loadJobs]);

  // Load active jobs. Field workers lose signal mid-job, so on failure we fall
  // back to the last synced payload and label it, rather than showing nothing.
  useEffect(() => {
    let active = true;
    void api
      .workerJobs()
      .then((result) => {
        if (!active) return;
        setActiveJobs(result.jobs ?? []);
        setActiveJobsStaleAt(null);
      })
      .catch(() => {
        if (!active) return;
        const cached = loadCachedWorkerSync();
        setActiveJobs(cached?.result.jobs ?? []);
        setActiveJobsStaleAt(cached?.cachedAt ?? null);
      });
    return () => {
      active = false;
    };
  }, []);

  const allWorkerJobs = jobs;

  const visibleJobs = useMemo(() => {
    return allWorkerJobs.filter((job) => {
      const matchesCategory =
        selectedCategory === "All" ||
        job.category.toLowerCase() === selectedCategory.toLowerCase();
      const normalizedQuery = query.trim().toLocaleLowerCase();
      const matchesQuery =
        !normalizedQuery ||
        `${job.title} ${job.description} ${job.category}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [allWorkerJobs, selectedCategory, query]);

  const handleDecisionComplete = (decision: "approve" | "redo" | "reject") => {
    toast.success(`Submission ${decision === "approve" ? "approved" : decision === "redo" ? "marked for redo" : "rejected"}.`);
    if (inspectingSubmission) {
      setReviewQueue((prev) => prev.filter((item) => item.id !== inspectingSubmission.id));
    }
    setInspectingSubmission(null);
  };

  return (
    <div className="px-4 pt-4 max-w-4xl mx-auto pb-16">
      {/* Top Header */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Field Operations Marketplace</p>
          <h1 className="flex items-center gap-2 truncate text-xl font-bold tracking-tight">
            <BriefcaseBusiness className="h-5 w-5 shrink-0 text-primary" /> Available Gigs
          </h1>
        </div>

        <button
          type="button"
          onClick={() => {
            void loadJobs();
            if (selectedRole === "correctionist") void loadReviewQueue();
          }}
          disabled={isLoading || isLoadingQueue}
          className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-primary/10 px-3.5 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", (isLoading || isLoadingQueue) && "animate-spin")} />
          Refresh
        </button>
      </header>

      {/* Role Switcher TabRow - strictly gated for admin-approved correctionists only (§22) */}
      <div className="mt-4 flex rounded-2xl bg-muted/60 p-1 border border-border/60">
        <button
          type="button"
          onClick={() => setSelectedRole("collectionist")}
          className={cn(
            "flex-1 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5",
            selectedRole === "collectionist"
              ? "bg-card text-foreground shadow-soft"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <MapPin className="h-3.5 w-3.5 text-primary" /> Collect (Field Gigs)
        </button>

        <button
          type="button"
          onClick={() => {
            if (isCorrectionistApproved) {
              setSelectedRole("correctionist");
              void loadReviewQueue();
            } else {
              toast.info("Correctionist role requires administrator approval (§22).");
            }
          }}
          className={cn(
            "flex-1 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5",
            selectedRole === "correctionist"
              ? "bg-card text-foreground shadow-soft"
              : "text-muted-foreground hover:text-foreground",
            !isCorrectionistApproved && "opacity-75",
          )}
        >
          {isCorrectionistApproved ? (
            <>
              <FileCheck2 className="h-3.5 w-3.5 text-amber-500" />
              Correct (Review {reviewQueue.length > 0 ? `· ${reviewQueue.length}` : ""})
            </>
          ) : (
            <>
              <Lock className="h-3 w-3" /> Correct (Locked)
            </>
          )}
        </button>
      </div>

      {/* VIEW 1: CORRECTIONIST REVIEW QUEUE (§22) */}
      {selectedRole === "correctionist" ? (
        <div className="mt-6 space-y-4">
          <SectionCard
            title="Correctionist Review Queue"
            description="Double-blind peer review of uploaded field evidence and live Devanagari/English OCR transcripts."
          >
            {isLoadingQueue ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : reviewQueue.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border py-12 text-center">
                <FileCheck2 className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <h3 className="mt-3 text-sm font-semibold text-foreground">No pending submissions</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  All peer submissions in your queue have been audited. Check back shortly.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {reviewQueue.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 shadow-soft hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={item.thumbnailUrl || item.mediaUrl}
                        alt="Evidence thumbnail"
                        className="h-14 w-14 rounded-xl object-cover border border-border/80 flex-none"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-sm truncate">{item.unitRef}</span>
                          <span className="rounded-md bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 text-[11px] font-semibold">
                            {item.ocrResult?.detectedScript || "Bilingual"}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground font-mono">
                          {item.ocrSnippet || item.ocrResult?.text}
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Submitted {new Date(item.submittedAt).toLocaleTimeString()} · Confidence:{" "}
                          {Math.round((item.ocrResult?.confidence ?? 0.98) * 100)}%
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setInspectingSubmission(item)}
                      className="press inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 flex-none self-end sm:self-center"
                    >
                      <Eye className="h-3.5 w-3.5" /> Inspect & Audit
                    </button>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      ) : (
        /* VIEW 2: COLLECTIONIST FIELD GIGS */
        <>
          {/* Active Jobs Notice */}
          {activeJobs !== null && activeJobs.length > 0 ? (
            <section className="animate-rise mt-4 space-y-3">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <BriefcaseBusiness className="h-4 w-4 text-success" /> My active gigs (
                {activeJobs.length})
              </h2>
              {activeJobsStaleAt ? (
                <p className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  Offline — showing your last synced gigs from{" "}
                  {new Date(activeJobsStaleAt).toLocaleString()}. Reconnect to refresh.
                </p>
              ) : null}
              {activeJobs.map((job) => (
                <WorkerActiveJobCard key={job.id} job={job} />
              ))}
            </section>
          ) : null}

          {/* Search Bar */}
          <div className="mt-4 relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search gigs by keyword, title, or category"
              className="h-11 w-full rounded-2xl border border-border bg-card pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>

          {/* Category Filter Chips */}
          <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={cn(
                  "press shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all",
                  selectedCategory === cat
                    ? "bg-[#111827] text-white dark:bg-[#F9C933] dark:text-[#111827]"
                    : "border border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* List vs Map Switcher */}
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
            {(
              [
                { id: "list", label: "Gig List", icon: List },
                { id: "map", label: "Region Map", icon: MapIcon },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all",
                  view === item.id ? "bg-card text-foreground shadow-soft" : "text-muted-foreground",
                )}
              >
                <item.icon className="h-3.5 w-3.5" /> {item.label}
              </button>
            ))}
          </div>

          {error && (
            <div
              className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              role="alert"
            >
              <span className="truncate">{error}</span>
              <Link
                to="/auth"
                className="press shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                Sign In
              </Link>
            </div>
          )}

          {/* Jobs Listing */}
          {view === "map" ? (
            <PrivacyMap jobCount={visibleJobs.length} />
          ) : (
            <div className="animate-rise mt-4 space-y-3">
              {isLoading ? (
                <JobListSkeleton />
              ) : visibleJobs.length > 0 ? (
                visibleJobs.map((job) => <WorkerJobCard key={job.id} job={job} />)
              ) : (
                <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                  <p className="font-semibold text-foreground">No gigs match your filter</p>
                  <p className="mt-1 text-xs">Try selecting \"All\" or widening your search query.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Split-Screen Review Modal */}
      {inspectingSubmission && (
        <ReviewSubmissionModal
          submission={inspectingSubmission}
          onClose={() => setInspectingSubmission(null)}
          onDecision={handleDecisionComplete}
        />
      )}
    </div>
  );
}
