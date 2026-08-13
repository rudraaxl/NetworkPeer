import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, ShieldCheck, Star } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { JobStatus, MediaKind } from "@/lib/mock-data";

/* ---------------------------------- chips --------------------------------- */

const statusMeta: Record<JobStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-muted text-muted-foreground" },
  open: { label: "Open", tone: "bg-primary-soft text-primary" },
  accepted: { label: "Accepted", tone: "bg-primary-soft text-primary" },
  en_route: {
    label: "En route",
    tone: "bg-brand-teal/20 text-brand-teal-foreground dark:text-brand-teal",
  },
  working: {
    label: "In progress",
    tone: "bg-warning/20 text-warning-foreground dark:text-warning",
  },
  submitted: { label: "Submitted", tone: "bg-info/15 text-info" },
  in_review: {
    label: "In review",
    tone: "bg-warning/20 text-warning-foreground dark:text-warning",
  },
  completed: {
    label: "Completed",
    tone: "bg-success/20 text-success-foreground dark:text-success",
  },
  rejected: { label: "Rejected", tone: "bg-destructive/15 text-destructive" },
  cancelled: { label: "Cancelled", tone: "bg-muted text-muted-foreground" },
};

export function StatusChip({ status, className }: { status: JobStatus; className?: string }) {
  const meta = statusMeta[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        meta.tone,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "primary" | "success" | "warning" | "danger" | "teal";
  className?: string;
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    primary: "bg-primary-soft text-primary",
    success: "bg-success/20 text-success-foreground dark:text-success",
    warning: "bg-warning/20 text-warning-foreground dark:text-warning",
    danger: "bg-destructive/15 text-destructive",
    teal: "bg-brand-teal/20 text-brand-teal-foreground dark:text-brand-teal",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function AnonymousBadge({ role = "Client" }: { role?: "Client" | "Worker" }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">
      <ShieldCheck className="h-3.5 w-3.5" />
      Verified {role}
    </span>
  );
}

export function Rating({ value, count }: { value: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium">
      <Star className="h-4 w-4 fill-warning text-warning" />
      {value.toFixed(1)}
      {count !== undefined && <span className="text-muted-foreground">({count})</span>}
    </span>
  );
}

/* ---------------------------------- cards --------------------------------- */

export function StatCard({
  label,
  value,
  delta,
  icon: Icon,
  tone = "primary",
  hint,
}: {
  label: string;
  value: string;
  delta?: number;
  icon: LucideIcon;
  tone?: "primary" | "teal" | "success" | "warning" | "danger";
  hint?: string;
}) {
  const tones = {
    primary: "bg-primary-soft text-primary",
    teal: "bg-brand-teal/20 text-brand-teal-foreground dark:text-brand-teal",
    success: "bg-success/20 text-success-foreground dark:text-success",
    warning: "bg-warning/20 text-warning-foreground dark:text-warning",
    danger: "bg-destructive/15 text-destructive",
  } as const;

  return (
    <div className="hover-lift animate-rise flex h-full min-h-[220px] flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-soft sm:min-h-[240px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium leading-relaxed text-muted-foreground sm:text-lg">
            {label}
          </p>
          <p className="mt-3 break-words text-4xl font-semibold tracking-tight leading-tight sm:text-[2.5rem]">
            {value}
          </p>
        </div>
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", tones[tone])}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs leading-5">
        {delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              delta >= 0 ? "text-success" : "text-destructive",
            )}
          >
            {delta >= 0 ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {Math.abs(delta)}%
          </span>
        )}
        {hint && <span className="break-words text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card shadow-soft",
        className,
      )}
    >
      <header className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/* --------------------------------- states --------------------------------- */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary">
        <Icon className="h-6 w-6" />
      </span>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="shimmer h-10 w-10 rounded-xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="shimmer h-3 w-1/3 rounded-full bg-muted" />
            <div className="shimmer h-3 w-1/2 rounded-full bg-muted" />
          </div>
          <div className="shimmer h-6 w-16 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function SuccessCheck({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "grid h-16 w-16 place-items-center rounded-full bg-success/20 text-success",
        className,
      )}
    >
      <svg
        viewBox="0 0 32 32"
        className="h-8 w-8"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
      >
        <path
          className="animate-draw-check"
          d="M7 17l6 6L25 10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/* -------------------------------- timeline -------------------------------- */

export interface TimelineStep {
  label: string;
  detail?: string;
  time?: string;
  state: "done" | "current" | "upcoming";
}

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="relative space-y-6 pl-7">
      <span className="absolute left-[9px] top-2 bottom-2 w-px bg-border" aria-hidden />
      {steps.map((step) => (
        <li key={step.label} className="relative">
          <span
            className={cn(
              "absolute -left-7 top-1 grid h-[18px] w-[18px] place-items-center rounded-full border-2",
              step.state === "done" && "border-success bg-success",
              step.state === "current" && "animate-soft-pulse border-primary bg-primary",
              step.state === "upcoming" && "border-border bg-card",
            )}
          >
            {step.state !== "upcoming" && <span className="h-1.5 w-1.5 rounded-full bg-card" />}
          </span>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
            <p
              className={cn(
                "text-sm font-medium",
                step.state === "upcoming" && "text-muted-foreground",
              )}
            >
              {step.label}
            </p>
            {step.time && <span className="text-xs text-muted-foreground">{step.time}</span>}
          </div>
          {step.detail && <p className="mt-0.5 text-sm text-muted-foreground">{step.detail}</p>}
        </li>
      ))}
    </ol>
  );
}

/* ----------------------------------- map ---------------------------------- */

export function MapCanvas({
  label = "Job location",
  className,
  pins = 1,
}: {
  label?: string;
  className?: string;
  pins?: number;
}) {
  return (
    <div
      className={cn(
        "surface-grid relative overflow-hidden rounded-2xl border border-border bg-muted/40",
        className,
      )}
    >
      <div className="absolute inset-0 bg-[var(--gradient-surface)]" aria-hidden />
      <svg className="absolute inset-0 h-full w-full opacity-40" aria-hidden>
        <path
          d="M-20 80 Q 120 40 260 130 T 620 90"
          stroke="currentColor"
          className="text-border"
          strokeWidth={10}
          fill="none"
        />
        <path
          d="M60 -20 Q 100 140 40 320"
          stroke="currentColor"
          className="text-border"
          strokeWidth={8}
          fill="none"
        />
      </svg>
      {Array.from({ length: pins }).map((_, i) => (
        <span
          key={i}
          className="absolute"
          style={{ left: `${25 + i * 17}%`, top: `${38 + (i % 3) * 14}%` }}
        >
          <span className="relative grid h-3 w-3 place-items-center">
            <span className="absolute h-6 w-6 animate-soft-pulse rounded-full bg-primary/25" />
            <span className="h-3 w-3 rounded-full border-2 border-card bg-primary" />
          </span>
        </span>
      ))}
      <span className="glass absolute bottom-3 left-3 rounded-full px-3 py-1.5 text-xs font-medium">
        {label}
      </span>
    </div>
  );
}

/* -------------------------------- media ----------------------------------- */

export const mediaMeta: Record<MediaKind, { label: string; tone: "primary" | "teal" | "warning" }> =
  {
    photo: { label: "Photo", tone: "primary" },
    video: { label: "Video", tone: "teal" },
    audio: { label: "Audio", tone: "warning" },
  };
