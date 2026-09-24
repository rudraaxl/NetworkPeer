import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  FileText,
  GripVertical,
  Layers,
  Loader2,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { cn, formatCurrency } from "@/lib/utils";
import { api, ApiError, type Job } from "@/lib/api";
import { PageHeader } from "@/components/shell/portal-shell";
import { LocationPicker } from "@/components/location-picker";
import { SectionCard, SuccessCheck } from "@/components/marketplace/primitives";
import {
  MAX_CHECKLIST_ITEMS,
  PAGE_SIZE,
  errorMessage,
  formatFileSize,
  inputCls,
  jobCategories,
  labelCls,
  normalizeWholeAmount,
  type AttachedFile,
  type DraftSubtask,
} from "@/lib/job-draft";
import { useChecklistDraft } from "@/hooks/use-checklist-draft";
import { ChecklistBuilder } from "@/components/client/checklist-builder";

export const Route = createFileRoute("/client/jobs/new")({
  head: () => ({
    meta: [
      { title: "Create a job — NetworkPeers client" },
      {
        name: "description",
        content:
          "Post a field job with a validated location, budget, schedule, infinite task builder, and evidence checklist.",
      },
    ],
  }),
  component: CreateJob,
});


function CreateJob() {
  // The checklist owns nine pieces of state, nine callbacks and three
  // derived values. They live in their own hook so the builder can be its
  // own component without a twenty-four prop signature.
  const checklist = useChecklistDraft();
  const { items, summary: checklistSummary, setItems, setCountInput, setCurrentPage } = checklist;
  const router = useRouter();
  const idempotencyKeyRef = useRef<string | null>(null);

  // Job Basics State
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(jobCategories[0]);
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [description, setDescription] = useState("");
  const [publicTitle, setPublicTitle] = useState("");
  const [publicDescription, setPublicDescription] = useState("");
  const [paymentInput, setPaymentInput] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  // Worker Capacity Mode (§24)
  const [capacityMode, setCapacityMode] = useState<"single" | "team" | "unlimited">("single");
  const [teamSize, setTeamSize] = useState("5");

  // Attached Reference Media (§24)
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Submission State
  const [submitState, setSubmitState] = useState<"idle" | "saving" | "posted">("idle");
  const [createdJob, setCreatedJob] = useState<Job | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const paymentRupees = useMemo(
    () => (paymentInput === "" ? 0 : Number.parseInt(paymentInput, 10)),
    [paymentInput],
  );
  const budgetCents = useMemo(() => paymentRupees * 100, [paymentRupees]);

  const handleBudgetChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setPaymentInput(normalizeWholeAmount(event.target.value));
  }, []);

  // Book Mode Generator (§24)
  const handleFileUpload = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const added: AttachedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 25 * 1024 * 1024) {
        toast.error(`File "${file.name}" exceeds 25 MB platform limit.`);
        continue;
      }
      added.push({
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
      });
    }
    if (added.length > 0) {
      setAttachments((previous) => [...previous, ...added]);
      toast.success(`Attached ${added.length} reference file(s).`);
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((previous) => previous.filter((_, i) => i !== index));
  }, []);

  // Filtered & Paginated items for high-volume performance (§24)
  const handleSubmit = useCallback(async () => {
    const normalizedTitle = title.trim();
    const normalizedDescription = description.trim();
    const normalizedAddress = address.trim();

    if (normalizedTitle.length < 3) {
      setFormError("Job title must contain at least 3 characters.");
      return;
    }
    if (normalizedDescription.length < 10) {
      setFormError("Description must contain at least 10 characters.");
      return;
    }
    const normalizedPublicTitle = publicTitle.trim();
    if (normalizedPublicTitle && normalizedPublicTitle.length < 3) {
      setFormError("Public title must contain at least 3 characters.");
      return;
    }
    if (!Number.isSafeInteger(budgetCents) || budgetCents <= 0 || budgetCents > 1_000_000_000) {
      setFormError("Payment must be a whole INR amount between ₹1 and ₹10,000,000.");
      return;
    }
    if (!location) {
      setFormError("Tap the map to set the job location before posting.");
      return;
    }

    const populatedItems = items.filter((item) => item.title.trim() || item.instructions.trim());
    if (populatedItems.some((item) => item.title.trim().length === 0)) {
      setFormError("Every checklist item with instructions needs a title.");
      return;
    }

    let deadlineIso: string | undefined;
    if (scheduledAt) {
      const deadline = new Date(scheduledAt);
      if (Number.isNaN(deadline.getTime())) {
        setFormError("Enter a valid scheduled date and time.");
        return;
      }
      deadlineIso = deadline.toISOString();
    }

    // Capacity and attachment notes
    const capacityNote =
      capacityMode === "team"
        ? `\n[Staffing: Capped Team (${teamSize} workers)]`
        : capacityMode === "unlimited"
          ? "\n[Staffing: Open Pool / Multi-Worker]"
          : "\n[Staffing: Single Assigned Worker]";

    const attachmentsNote =
      attachments.length > 0
        ? `\n[Attached Reference Files: ${attachments.map((a) => a.name).join(", ")}]`
        : "";

    const combinedDescription = `${normalizedDescription}${capacityNote}${attachmentsNote}`;

    setFormError(null);
    setSubmitState("saving");
    try {
      idempotencyKeyRef.current ??= globalThis.crypto.randomUUID();
      const job = await api.createClientJob({
        title: normalizedTitle,
        description: combinedDescription,
        category,
        budget_cents: budgetCents,
        currency: "INR",
        location: { type: "Point", coordinates: [location.lng, location.lat] },
        ...(normalizedAddress ? { address: normalizedAddress } : {}),
        ...(deadlineIso ? { scheduled_at: deadlineIso } : {}),
        idempotency_key: idempotencyKeyRef.current,
        public_title: normalizedPublicTitle || normalizedTitle,
        public_description: publicDescription.trim() || normalizedDescription.slice(0, 2000),
        subtasks: populatedItems.map((item) => ({
          title: item.title.trim(),
          ...(item.instructions.trim() ? { description: item.instructions.trim() } : {}),
          is_required: item.isRequired,
        })),
      });
      setCreatedJob(job);
      setSubmitState("posted");
      toast.success("Job created. Fund escrow to publish it to verified workers.");
    } catch (error) {
      const message = errorMessage(error);
      setFormError(message);
      toast.error(message);
      setSubmitState("idle");
    }
  }, [
    address,
    attachments,
    budgetCents,
    capacityMode,
    category,
    description,
    items,
    location,
    publicDescription,
    publicTitle,
    scheduledAt,
    teamSize,
    title,
  ]);

  const postAnother = useCallback(() => {
    idempotencyKeyRef.current = null;
    setCreatedJob(null);
    setSubmitState("idle");
    setTitle("");
    setDescription("");
    setAddress("");
    setPublicTitle("");
    setPublicDescription("");
    setPaymentInput("");
    setScheduledAt("");
    setAttachments([]);
    setItems([
      {
        id: 1,
        title: "Capture storefront evidence",
        instructions: "Capture the full signage and entrance.",
        isRequired: true,
      },
    ]);
    setCountInput("1");
    setCurrentPage(1);
  }, []);

  if (submitState === "posted" && createdJob) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
        <SuccessCheck />
        <h1 className="mt-6 text-4xl font-semibold">Job created</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          {formatCurrency(createdJob.budget_cents / 100)} is awaiting escrow funding with status{" "}
          <span className="font-semibold text-foreground">{createdJob.status}</span>.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => router.navigate({ to: "/client/jobs" })}
            className="press gradient-brand inline-flex rounded-xl px-4 py-2.5 text-base font-semibold text-primary-foreground shadow-md"
          >
            View my jobs
          </button>
          <button
            type="button"
            onClick={postAnother}
            className="press rounded-xl border border-border bg-card px-4 py-2.5 text-base font-semibold transition hover:border-primary/40"
          >
            Post another
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Create a job"
        description="Define the work, a precise location, and checklist evidence requirements."
        action={
          <Link
            to="/client/jobs"
            className="press inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-base font-medium transition hover:border-primary/40"
          >
            <ArrowLeft className="h-4 w-4" /> Cancel
          </Link>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {/* Job Basics */}
          <SectionCard title="Job basics" description="All fields are validated again by the API.">
            <div className="grid gap-4">
              <label>
                <span className={labelCls()}>Job title</span>
                <input
                  className={inputCls}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={255}
                  placeholder="e.g. Rare Manuscript Digitization & Verification"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className={labelCls()}>Category</span>
                  <select
                    className={inputCls}
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                  >
                    {jobCategories.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={labelCls()}>Address (optional)</span>
                  <input
                    className={inputCls}
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    maxLength={500}
                    placeholder="412 Market St, Downtown"
                  />
                </label>
              </div>
              <label>
                <span className={labelCls()}>Job location</span>
                <LocationPicker
                  lat={location?.lat ?? null}
                  lng={location?.lng ?? null}
                  onPick={(nextLat, nextLng) => setLocation({ lat: nextLat, lng: nextLng })}
                />
              </label>
              <label>
                <span className={labelCls()}>Description</span>
                <textarea
                  rows={4}
                  className={inputCls}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={10_000}
                  placeholder="Describe the task, access instructions, and anything the worker should know."
                />
              </label>
            </div>
          </SectionCard>

          {/* Worker Capacity & Staffing (§24) */}
          <SectionCard
            title="Worker capacity & staffing"
            description="Configure how many verified field collectionists can participate in this task."
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setCapacityMode("single")}
                className={cn(
                  "press flex flex-col items-start rounded-2xl border p-4 text-left transition",
                  capacityMode === "single"
                    ? "border-amber-400 bg-amber-400/10 shadow-sm"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                <Users className="h-5 w-5 text-amber-500" />
                <span className="mt-2 text-base font-semibold">Single Worker</span>
                <span className="text-xs text-muted-foreground">1 assigned collectionist</span>
              </button>

              <button
                type="button"
                onClick={() => setCapacityMode("team")}
                className={cn(
                  "press flex flex-col items-start rounded-2xl border p-4 text-left transition",
                  capacityMode === "team"
                    ? "border-amber-400 bg-amber-400/10 shadow-sm"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                <Layers className="h-5 w-5 text-amber-500" />
                <span className="mt-2 text-base font-semibold">Capped Team</span>
                <span className="text-xs text-muted-foreground">Up to N workers simultaneously</span>
              </button>

              <button
                type="button"
                onClick={() => setCapacityMode("unlimited")}
                className={cn(
                  "press flex flex-col items-start rounded-2xl border p-4 text-left transition",
                  capacityMode === "unlimited"
                    ? "border-amber-400 bg-amber-400/10 shadow-sm"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                <Sparkles className="h-5 w-5 text-amber-500" />
                <span className="mt-2 text-base font-semibold">Open Pool</span>
                <span className="text-xs text-muted-foreground">Distributed multi-worker units</span>
              </button>
            </div>

            {capacityMode === "team" && (
              <div className="mt-4 rounded-xl border border-border bg-muted/20 p-4">
                <label className="flex items-center gap-3">
                  <span className="text-sm font-medium">Maximum concurrent workers:</span>
                  <input
                    type="number"
                    min={2}
                    max={100}
                    value={teamSize}
                    onChange={(e) => setTeamSize(e.target.value)}
                    className="h-9 w-20 rounded-lg border border-border bg-card text-center text-base font-semibold outline-none focus:ring-2 focus:ring-ring/40"
                  />
                  <span className="text-xs text-muted-foreground">Between 2 and 100 workers</span>
                </label>
              </div>
            )}
          </SectionCard>

          {/* Reference Media Upload (§24) */}
          <SectionCard
            title="Reference media & guidelines"
            description="Attach guidelines, sample pages, or reference documents for field workers."
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => handleFileUpload(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="press flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-6 text-center transition hover:border-amber-400 hover:bg-amber-400/5"
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <div>
                <span className="font-semibold text-foreground">Click to upload reference files</span>
                <span className="text-muted-foreground"> or drag & drop</span>
              </div>
              <p className="text-xs text-muted-foreground">PDF, JPEG, PNG, or WebP up to 25 MB each</p>
            </button>

            {attachments.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-semibold text-muted-foreground">
                  Attached files ({attachments.length}):
                </p>
                {attachments.map((file, idx) => (
                  <div
                    key={file.name + idx}
                    className="flex items-center justify-between rounded-xl border border-border bg-card p-3"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FileText className="h-4 w-4 shrink-0 text-amber-500" />
                      <span className="truncate text-sm font-medium">{file.name}</span>
                      <span className="text-xs text-muted-foreground">({formatFileSize(file.size)})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(idx)}
                      className="press rounded-lg p-1 text-muted-foreground hover:text-destructive"
                      aria-label="Remove attachment"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Public Preview */}
          <SectionCard
            title="What workers will see"
            description="Workers see this anonymized version until they are assigned the job. Leave blank to show your title and description."
          >
            <div className="grid gap-4">
              <label>
                <span className={labelCls()}>Public title</span>
                <input
                  className={inputCls}
                  value={publicTitle}
                  onChange={(event) => setPublicTitle(event.target.value)}
                  maxLength={255}
                  placeholder={title.trim() || "e.g. Photography task near you"}
                />
              </label>
              <label>
                <span className={labelCls()}>Public description</span>
                <textarea
                  rows={3}
                  className={inputCls}
                  value={publicDescription}
                  onChange={(event) => setPublicDescription(event.target.value)}
                  maxLength={2000}
                  placeholder="Privacy-safe summary. Keep exact addresses and business names out of this field."
                />
              </label>
            </div>
          </SectionCard>

          <ChecklistBuilder draft={checklist} />
        </div>

        {/* Sidebar: Budget, Timing & Summary */}
        <div className="space-y-6">
          <SectionCard title="Payment & timing">
            <div className="grid gap-4">
              <label>
                <span className={labelCls()}>Payment (INR)</span>
                <input
                  className={inputCls}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={paymentInput}
                  onChange={handleBudgetChange}
                  placeholder="e.g. 500"
                  aria-describedby="budget-help"
                />
                <span id="budget-help" className="mt-1.5 block text-sm text-muted-foreground">
                  Whole rupees only. Sent to the API as {budgetCents.toLocaleString("en-IN")} cents.
                </span>
              </label>
              <label>
                <span className={labelCls()}>Scheduled time (optional)</span>
                <input
                  className={inputCls}
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                />
              </label>
            </div>
          </SectionCard>

          <SectionCard title="Summary">
            <dl className="space-y-3 text-base">
              {[
                ["Checklist items", String(checklistSummary.total)],
                ["Evidence required", String(checklistSummary.required)],
                [
                  "Staffing mode",
                  capacityMode === "single"
                    ? "Single Worker"
                    : capacityMode === "team"
                      ? `Capped Team (${teamSize})`
                      : "Open Pool",
                ],
                ["Reference files", String(attachments.length)],
                ["Job budget", formatCurrency(paymentRupees)],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {formError && (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
              >
                {formError}
              </p>
            )}
            <button
              type="button"
              disabled={submitState === "saving"}
              onClick={() => void handleSubmit()}
              className={cn(
                "press gradient-brand shadow-glow mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold text-primary-foreground",
                submitState === "saving" && "cursor-not-allowed opacity-70",
              )}
            >
              {submitState === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
              Post job
            </button>
            <p className="mt-3 text-sm text-muted-foreground">
              Once posted, deposit budget to escrow to immediately dispatch to verified field collectionists.
            </p>
          </SectionCard>
        </div>
      </div>
    </>
  );
}
