import { ApiError } from "@/lib/api";

/**
 * The shapes, limits and formatting for a job being drafted.
 *
 * These lived at the top of the route that renders the form, which had grown
 * to just over a thousand lines. None of it is route-specific: the checklist
 * builder needs the same types and the same ceiling, and pulling them out is
 * what lets that builder move into its own file at all.
 */

/** One checklist item on a job being drafted, before the API has seen it. */
export type DraftSubtask = {
  id: number;
  title: string;
  instructions: string;
  isRequired: boolean;
};

/** A reference file the client attached while drafting. */
export type AttachedFile = {
  name: string;
  size: number;
  type: string;
};

export const jobCategories = [
  "Audit",
  "Delivery",
  "Inspection",
  "Photography",
  "Retail",
  "Other",
];

/**
 * Book mode can generate an item per page, so the ceiling is high. It exists
 * because the list is rendered and diffed in the browser, not because the API
 * imposes it.
 */
export const MAX_CHECKLIST_ITEMS = 5000;

/** Checklist items shown at once. The list pages rather than scrolls to 5000. */
export const PAGE_SIZE = 25;

export const inputCls =
  "w-full rounded-xl border border-border bg-card px-3.5 py-3 text-base outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40";

export function labelCls() {
  return "mb-1.5 block text-base font-medium";
}

/** Rupees, whole numbers only: the form never takes paise. */
export function normalizeWholeAmount(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 0 ? "" : String(Number.parseInt(digits, 10));
}

/**
 * An API error carries a code worth showing -- it tells the client whether the
 * job was rejected for something they can fix. Anything else is a transport
 * failure, where the code would mean nothing to them.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return "Unable to post the job. Check your connection and try again.";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
