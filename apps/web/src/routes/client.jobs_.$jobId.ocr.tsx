import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Download,
  Info,
  Loader2,
  Save,
  XCircle,
} from "lucide-react";

import { PageHeader } from "@/components/shell/portal-shell";
import { Chip, SectionCard } from "@/components/marketplace/primitives";
import { api, ApiError, type EvidenceSummary } from "@/lib/api";

/**
 * Page-by-page transcription review.
 *
 * The prototype this is modelled on drove the whole screen from mock-data.ts:
 * invented Hindi book pages, a grey box captioned "Scanned image preview
 * placeholder" where the scan should be, and Accept/Reject buttons that fired
 * a toast and changed nothing. This keeps its shape and replaces its content
 * with the job's real evidence -- the actual photographs the worker uploaded,
 * served from S3 by presigned URL.
 *
 * WHAT IS HONESTLY NOT HERE: no OCR engine runs anywhere in this system. The
 * API says so itself, returning ocr_status "unavailable" for every item
 * (client-jobs.ts), and an earlier cleanup removed a fabricated ocrResult that
 * had named "tesseract-5.3.0" at a fixed 0.96 confidence. So the transcription
 * pane starts empty and is typed by the reviewer. It does not display machine
 * output, because there is none, and inventing some is how the last version of
 * this screen came to be misleading.
 *
 * Review decisions are also not yet persisted -- there is no endpoint and no
 * table behind them. The banner says so rather than letting a toast imply a
 * save that did not happen.
 */
export const Route = createFileRoute("/client/jobs_/$jobId/ocr")({
  head: () => ({
    meta: [
      { title: "Transcription review — NetworkPeers" },
      { name: "description", content: "Review uploaded pages and transcribe them." },
    ],
  }),
  component: TranscriptionReview,
});

type PageStatus = "pending" | "accepted" | "rejected" | "edited";

const statusMeta: Record<PageStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "Pending", tone: "warning" },
  accepted: { label: "Accepted", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  edited: { label: "Edited", tone: "neutral" },
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return "Unable to load the uploaded pages. Check your connection and try again.";
}

/** Only visual evidence can be transcribed; audio cannot. */
function isPage(item: EvidenceSummary): boolean {
  return (
    (item.media_type === "IMAGE" || item.media_type === "DOCUMENT") &&
    (item.status === "UPLOADED" || item.status === "VERIFIED")
  );
}

/**
 * Writes the transcriptions out as a .docx.
 *
 * The docx library is around half a megabyte, and most visits to this screen
 * never export anything, so it is imported inside the handler rather than at
 * module scope -- Vite splits it into its own chunk that is fetched on the
 * first click.
 *
 * The font is set explicitly because of what is being transcribed. Word's
 * default body font has no Devanagari coverage, so Hindi text lands as empty
 * boxes; "Nirmala UI" ships with Windows and covers it, and Word on macOS
 * substitutes a Devanagari face of its own rather than failing. The complex-
 * script slot (cs) is the one that governs Devanagari, so it is set alongside
 * the Latin slots rather than instead of them.
 */
async function exportTranscriptions(
  jobId: string,
  entries: { pageNumber: number; capturedAt: string; text: string }[],
): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");

  const font = { ascii: "Nirmala UI", hAnsi: "Nirmala UI", cs: "Nirmala UI" };

  const children = entries.flatMap((entry) => [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `Page ${entry.pageNumber}`, font })],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Captured ${new Date(entry.capturedAt).toLocaleString()}`,
          italics: true,
          size: 18,
          font,
        }),
      ],
    }),
    // A blank line, then the body. Newlines inside a run are not rendered by
    // Word, so each typed line becomes its own paragraph.
    new Paragraph({ children: [] }),
    ...entry.text.split("\n").map(
      (line) => new Paragraph({ children: [new TextRun({ text: line, font })] }),
    ),
    new Paragraph({ children: [] }),
  ]);

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: "Transcription", font })],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: `Job ${jobId}`, italics: true, size: 18, font }),
            ],
          }),
          new Paragraph({ children: [] }),
          ...children,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `transcription-${jobId.slice(0, 8)}.docx`;
  anchor.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function TranscriptionReview() {
  const { jobId } = Route.useParams();
  const [evidence, setEvidence] = useState<EvidenceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, PageStatus>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const result = await api.clientJobEvidence(jobId);
      setEvidence(result.evidence);
      setError(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const [exporting, setExporting] = useState(false);

  const pages = useMemo(() => (evidence ?? []).filter(isPage), [evidence]);
  const selected = pages.find((page) => page.id === selectedId) ?? null;
  const statusOf = (item: EvidenceSummary): PageStatus => statuses[item.id] ?? "pending";

  // Only pages that actually have text; exporting a file of empty headings
  // would be worse than the button being disabled.
  const transcribed = pages
    .map((page, index) => ({
      pageNumber: index + 1,
      capturedAt: page.captured_at,
      text: (drafts[page.id] ?? "").trim(),
    }))
    .filter((entry) => entry.text.length > 0);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportTranscriptions(jobId, transcribed);
      toast.success("Word document downloaded.");
    } catch {
      toast.error("Could not build the document. Try again.");
    } finally {
      setExporting(false);
    }
  };

  const decide = (item: EvidenceSummary, status: PageStatus, message: string) => {
    setStatuses((current) => ({ ...current, [item.id]: status }));
    toast.success(message);
  };

  if (error) {
    return (
      <div className="space-y-4 p-6">
        <Link to="/client/jobs/$jobId" params={{ jobId }} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
          <ArrowLeft className="h-4 w-4" /> Back to job
        </Link>
        <p role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!evidence) {
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Loading pages</span>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Transcription review"
        description={`${pages.length} page${pages.length === 1 ? "" : "s"} uploaded for this job`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exporting || transcribed.length === 0}
              title={
                transcribed.length === 0
                  ? "Transcribe at least one page first"
                  : `Download ${transcribed.length} transcribed page${transcribed.length === 1 ? "" : "s"}`
              }
              className="press inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-base font-medium disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="h-4 w-4" aria-hidden />
              )}
              Download as Word
            </button>
            <Link
              to="/client/jobs/$jobId"
              params={{ jobId }}
              className="press inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-base font-medium"
            >
              <ArrowLeft className="h-4 w-4" /> Job details
            </Link>
          </div>
        }
      />

      <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          No text-extraction engine is running, so transcriptions are typed here rather than read
          from the page. Decisions and edits are kept for this session only — saving them needs an
          API endpoint that does not exist yet.
        </p>
      </div>

      {pages.length === 0 ? (
        <SectionCard title="No pages yet">
          <p className="text-base text-muted-foreground">
            The worker has not uploaded any photographs or documents for this job.
          </p>
        </SectionCard>
      ) : selected ? (
        <div className="space-y-6">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="press inline-flex items-center gap-1.5 text-sm font-medium text-primary"
          >
            <ArrowLeft className="h-4 w-4" /> All pages
          </button>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Uploaded page" description="The photograph the worker captured on site">
              <div className="overflow-hidden rounded-2xl border border-border bg-muted/40">
                {selected.download?.url ? (
                  <img
                    src={selected.download.url}
                    alt=""
                    className="max-h-[520px] w-full object-contain"
                    onError={() => void load()}
                  />
                ) : (
                  <div className="grid h-72 place-items-center text-sm text-muted-foreground">
                    Preview unavailable
                  </div>
                )}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Captured {new Date(selected.captured_at).toLocaleString()}
              </p>
            </SectionCard>

            <SectionCard title="Transcription" description="Type what the page says">
              <textarea
                id={`transcription-${selected.id}`}
                value={drafts[selected.id] ?? ""}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [selected.id]: event.target.value }))
                }
                placeholder="Transcribe this page…"
                className="h-[420px] w-full rounded-xl border border-border bg-card p-4 text-base leading-relaxed outline-none transition-shadow focus:ring-2 focus:ring-ring/40"
              />
            </SectionCard>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => decide(selected, "rejected", "Page flagged for re-scan.")}
              className="press inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-base font-medium text-destructive"
            >
              <XCircle className="h-4 w-4" /> Reject page
            </button>
            <button
              type="button"
              onClick={() => decide(selected, "edited", "Transcription kept for this session.")}
              className="press inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-base font-medium"
            >
              <Save className="h-4 w-4" /> Save transcription
            </button>
            <button
              type="button"
              onClick={() => decide(selected, "accepted", "Page accepted.")}
              className="press gradient-brand inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-base font-semibold text-primary-foreground"
            >
              <CheckCircle2 className="h-4 w-4" /> Accept page
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pages.map((page, index) => {
            const meta = statusMeta[statusOf(page)];
            return (
              <button
                key={page.id}
                type="button"
                onClick={() => setSelectedId(page.id)}
                className="press overflow-hidden rounded-2xl border border-border bg-card text-left"
              >
                <div className="aspect-[3/4] bg-muted">
                  {page.download?.url ? (
                    <img src={page.download.url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-muted-foreground">
                      <FileText className="h-6 w-6" aria-hidden />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 p-3">
                  <span className="flex-1 truncate text-base font-semibold">Page {index + 1}</span>
                  <Chip tone={meta.tone}>{meta.label}</Chip>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
