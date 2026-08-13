import { createFileRoute } from "@tanstack/react-router";
import { Briefcase, Eye, Filter, PlusCircle, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shell/portal-shell";
import { Chip, EmptyState, SectionCard } from "@/components/marketplace/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin/jobs")({
  head: () => ({
    meta: [
      { title: "Admin jobs — NetworkPeers" },
      { name: "description", content: "Review and manage jobs across the marketplace." },
    ],
  }),
  component: AdminJobs,
});

type JobStatus =
  "working" | "submitted" | "completed" | "cancelled" | "archived" | "reassigned" | "rejected";

type Job = {
  id: string;
  ref: string;
  title: string;
  status: JobStatus;
  owner: string;
  payout: string;
  assignee: string;
};

const seedJobs: Job[] = [
  {
    id: "j1",
    ref: "GF-1042",
    title: "Storefront compliance audit",
    status: "working",
    owner: "Verified Client",
    payout: "₹78",
    assignee: "A. Rivera",
  },
  {
    id: "j2",
    ref: "GF-1041",
    title: "Warehouse inventory photo set",
    status: "submitted",
    owner: "Verified Client",
    payout: "₹120",
    assignee: "L. Chen",
  },
  {
    id: "j3",
    ref: "GF-1037",
    title: "Retail shelf reset",
    status: "completed",
    owner: "Verified Client",
    payout: "₹96",
    assignee: "M. Singh",
  },
];

function AdminJobs() {
  const [jobs, setJobs] = useState(seedJobs);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [confirmAction, setConfirmAction] = useState<
    "cancel" | "delete" | "archive" | "complete" | "reassign" | "reject" | "approve" | null
  >(null);
  const [draftTitle, setDraftTitle] = useState("");

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesQuery = `${job.ref} ${job.title}`.toLowerCase().includes(query.toLowerCase());
      const matchesFilter = filter === "All" || job.status === filter.toLowerCase();
      return matchesQuery && matchesFilter;
    });
  }, [filter, jobs, query]);

  const openView = (job: Job) => {
    setSelectedJob(job);
    setMode("view");
    setConfirmAction(null);
  };

  const openEdit = (job: Job) => {
    setSelectedJob(job);
    setDraftTitle(job.title);
    setMode("edit");
    setConfirmAction(null);
  };

  const requestAction = (
    job: Job,
    action: "cancel" | "delete" | "archive" | "complete" | "reassign" | "reject" | "approve",
  ) => {
    setSelectedJob(job);
    setConfirmAction(action);
    setMode("confirm");
  };

  const saveEdit = () => {
    if (!selectedJob) return;
    setJobs((prev) =>
      prev.map((job) => (job.id === selectedJob.id ? { ...job, title: draftTitle } : job)),
    );
    toast.success(`${draftTitle} updated in the mock queue.`);
    setSelectedJob(null);
    setMode("view");
  };

  const applyAction = () => {
    if (!selectedJob || !confirmAction) return;
    const statusMap: Record<NonNullable<typeof confirmAction>, JobStatus> = {
      cancel: "cancelled",
      delete: "cancelled",
      archive: "archived",
      complete: "completed",
      reassign: "reassigned",
      reject: "rejected",
      approve: "completed",
    };

    if (confirmAction === "delete") {
      setJobs((prev) => prev.filter((job) => job.id !== selectedJob.id));
      toast.success(`${selectedJob.ref} removed from the queue.`);
    } else {
      setJobs((prev) =>
        prev.map((job) =>
          job.id === selectedJob.id ? { ...job, status: statusMap[confirmAction] } : job,
        ),
      );
      const labels = {
        cancel: "cancelled",
        archive: "archived",
        complete: "force completed",
        reassign: "reassigned",
        reject: "rejected",
        approve: "approved",
      } as const;
      toast.success(`${selectedJob.ref} ${labels[confirmAction]}.`);
    }
    setSelectedJob(null);
    setConfirmAction(null);
    setMode("view");
  };

  return (
    <div className="animate-rise space-y-6">
      <PageHeader
        title="Job management"
        description="Review, update and moderate live marketplace work."
        action={
          <button
            type="button"
            className="press gradient-brand shadow-glow inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-base font-semibold text-primary-foreground"
          >
            <PlusCircle className="h-4 w-4" /> New review
          </button>
        }
      />

      <SectionCard title="Job queue" description="Search and filter by current state">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-base outline-none focus:ring-2 focus:ring-ring/40"
              placeholder="Search ref or title"
            />
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-base text-muted-foreground">
            <Filter className="h-4 w-4" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-transparent outline-none"
            >
              <option value="All">All</option>
              <option value="Working">Working</option>
              <option value="Submitted">Submitted</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {filteredJobs.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              icon={Briefcase}
              title="No jobs match this view"
              description="Try a different filter or review the queue later."
            />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {filteredJobs.map((job) => (
              <div
                key={job.id}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-base font-semibold">{job.title}</p>
                    <Chip tone="teal">{job.ref}</Chip>
                  </div>
                  <p className="mt-1 text-base text-muted-foreground">
                    {job.owner} · {job.payout} payout · {job.assignee}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Chip
                    tone={
                      job.status === "completed"
                        ? "success"
                        : job.status === "rejected" || job.status === "cancelled"
                          ? "danger"
                          : job.status === "archived"
                            ? "neutral"
                            : "warning"
                    }
                  >
                    {job.status}
                  </Chip>
                  <button
                    type="button"
                    onClick={() => openView(job)}
                    className="rounded-xl border border-border bg-card px-3 py-2.5 text-base font-medium"
                  >
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(job)}
                    className="rounded-xl border border-border bg-card px-3 py-2.5 text-base font-medium"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => requestAction(job, "cancel")}
                    className="rounded-xl border border-border bg-card px-3 py-2.5 text-base font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => requestAction(job, "delete")}
                    className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-base font-medium text-destructive"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <Dialog
        open={Boolean(selectedJob && mode === "view")}
        onOpenChange={(open) => !open && setSelectedJob(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Job overview</DialogTitle>
            <DialogDescription>
              Mock operational context for the selected assignment.
            </DialogDescription>
          </DialogHeader>
          {selectedJob && (
            <div className="space-y-3 text-base">
              <div className="rounded-2xl border border-border bg-muted/40 p-3">
                <p className="text-base uppercase tracking-wide text-muted-foreground">Reference</p>
                <p className="mt-1 font-semibold">{selectedJob.ref}</p>
                <p className="text-muted-foreground">{selectedJob.title}</p>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-border px-3 py-3">
                <span className="text-muted-foreground">Owner</span>
                <span className="font-medium">{selectedJob.owner}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-border px-3 py-3">
                <span className="text-muted-foreground">Assignee</span>
                <span className="font-medium">{selectedJob.assignee}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-border px-3 py-3">
                <span className="text-muted-foreground">Payout</span>
                <span className="font-medium">{selectedJob.payout}</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => selectedJob && requestAction(selectedJob, "archive")}
                className="rounded-xl border border-border bg-card px-3 py-2.5 text-base font-medium"
              >
                Archive
              </button>
              <button
                type="button"
                onClick={() => selectedJob && requestAction(selectedJob, "complete")}
                className="rounded-xl border border-border bg-card px-3 py-2.5 text-base font-medium"
              >
                Force complete
              </button>
              <button
                type="button"
                onClick={() => selectedJob && requestAction(selectedJob, "reassign")}
                className="rounded-xl border border-border bg-card px-3 py-2.5 text-base font-medium"
              >
                Reassign
              </button>
              <button
                type="button"
                onClick={() => selectedJob && requestAction(selectedJob, "reject")}
                className="rounded-xl border border-border bg-card px-3 py-2.5 text-base font-medium"
              >
                Reject submission
              </button>
              <button
                type="button"
                onClick={() => selectedJob && requestAction(selectedJob, "approve")}
                className="rounded-xl border border-border bg-card px-3 py-2.5 text-base font-medium"
              >
                Approve submission
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedJob && mode === "edit")}
        onOpenChange={(open) => !open && setSelectedJob(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit job</DialogTitle>
            <DialogDescription>
              Adjust the visible title and keep the change inside the mock state.
            </DialogDescription>
          </DialogHeader>
          {selectedJob && (
            <label className="block text-base">
              <span className="mb-1 block text-muted-foreground">Job title</span>
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
              />
            </label>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={saveEdit}
              className="press gradient-brand inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-base font-semibold text-primary-foreground"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedJob && mode === "confirm")}
        onOpenChange={(open) => !open && setSelectedJob(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "delete"
                ? "Delete job"
                : confirmAction === "archive"
                  ? "Archive job"
                  : confirmAction === "complete"
                    ? "Force complete"
                    : confirmAction === "reassign"
                      ? "Reassign job"
                      : confirmAction === "reject"
                        ? "Reject submission"
                        : confirmAction === "approve"
                          ? "Approve submission"
                          : "Cancel job"}
            </DialogTitle>
            <DialogDescription>Mock confirmation for operational administration.</DialogDescription>
          </DialogHeader>
          {selectedJob && (
            <div className="rounded-2xl border border-border bg-muted/40 p-3 text-base text-muted-foreground">
              {confirmAction === "delete"
                ? `Delete ${selectedJob.ref} from the console?`
                : confirmAction === "archive"
                  ? `Archive ${selectedJob.ref} for later review?`
                  : confirmAction === "complete"
                    ? `Force complete ${selectedJob.ref} and finalize payout?`
                    : confirmAction === "reassign"
                      ? `Reassign ${selectedJob.ref} to the next available operator?`
                      : confirmAction === "reject"
                        ? `Reject the submission for ${selectedJob.ref}?`
                        : confirmAction === "approve"
                          ? `Approve the submission for ${selectedJob.ref}?`
                          : `Cancel ${selectedJob.ref} and notify the client?`}
            </div>
          )}
          <DialogFooter>
            <button
              type="button"
              onClick={applyAction}
              className="press inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-base font-semibold text-primary-foreground"
            >
              Confirm
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
