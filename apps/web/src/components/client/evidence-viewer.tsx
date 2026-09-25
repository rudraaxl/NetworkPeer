import { useEffect, useState } from "react";
import { Download, FileText, Loader2, Maximize2, X } from "lucide-react";

import { api, type EvidenceSummary } from "@/lib/api";

/**
 * Shows the client what the worker actually photographed.
 *
 * The review screen listed each piece of evidence by type, size and capture
 * time behind a Download button, so approving a job meant opening files one at
 * a time in new tabs -- or approving without looking. The whole point of the
 * platform is that the client sees the proof before releasing the money, and
 * the one screen where that happens did not show it.
 *
 * Evidence lives in a private bucket, so each item needs its own signed URL
 * and those expire. Every item therefore fetches and holds its own, rather
 * than the page fetching a batch up front that may be stale by the time
 * someone scrolls to it.
 */

type Props = { jobId: string; item: EvidenceSummary };

export function EvidenceMedia({ jobId, item }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    api
      .clientEvidenceDownloadUrl(jobId, item.id)
      .then(({ url: signed }) => {
        if (!cancelled) setUrl(signed);
      })
      .catch(() => {
        // One unreachable item must not take the rest of the gallery with it;
        // the Download button beside it asks the server again.
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, item.id]);

  // Escape closes the lightbox, which is what anyone will try first.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  if (failed) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
        <FileText className="h-4 w-4 shrink-0" aria-hidden />
        Preview unavailable. Use Download to open this file.
      </div>
    );
  }

  if (!url) {
    return (
      <div className="mt-3 grid h-40 place-items-center rounded-xl border border-border bg-card">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Loading preview</span>
      </div>
    );
  }

  if (item.media_type === "VIDEO") {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        className="mt-3 max-h-96 w-full rounded-xl border border-border bg-black"
      />
    );
  }

  if (item.media_type === "AUDIO") {
    return <audio src={url} controls className="mt-3 w-full" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="press group relative mt-3 block w-full overflow-hidden rounded-xl border border-border bg-card"
      >
        <img src={url} alt="" className="max-h-96 w-full object-contain" />
        <span className="absolute right-2 top-2 rounded-lg bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize2 className="h-4 w-4" aria-hidden />
        </span>
        <span className="sr-only">View full size</span>
      </button>

      {expanded && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Evidence preview"
          onClick={() => setExpanded(false)}
        >
          <img
            src={url}
            alt=""
            className="max-h-full max-w-full rounded-xl object-contain"
            onClick={(event) => event.stopPropagation()}
          />
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-card px-4 py-2.5 text-sm font-semibold"
          >
            <Download className="h-4 w-4" aria-hidden />
            Open original
          </a>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute right-4 top-4 rounded-full bg-card p-2"
            aria-label="Close preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The evidence for a job, fetched and laid out as a gallery.
 *
 * The review screen has its own richer list -- per-item status chips and OCR
 * results, which only matter while deciding whether to approve. This is the
 * plain view for every other point in the job's life: the API serves evidence
 * from IN_PROGRESS through COMPLETED, but until now the site only ever asked
 * for it on the review screen, so approving a job made the photos the client
 * had paid for unreachable.
 */
export function JobEvidenceGallery({ jobId }: { jobId: string }) {
  const [evidence, setEvidence] = useState<EvidenceSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .clientJobEvidence(jobId)
      .then((result) => {
        if (!cancelled) setEvidence(result.evidence);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (error) {
    return (
      <p className="text-base text-muted-foreground">
        Unable to load the uploaded files. Refresh to try again.
      </p>
    );
  }

  if (!evidence) {
    return (
      <div className="grid h-24 place-items-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Loading uploaded files</span>
      </div>
    );
  }

  if (evidence.length === 0) {
    return (
      <p className="text-base text-muted-foreground">
        The worker has not uploaded anything for this job yet.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {evidence.map((item) => (
        <li key={item.id}>
          <p className="text-sm text-muted-foreground">
            Captured {new Date(item.captured_at).toLocaleString()}
          </p>
          <EvidenceMedia jobId={jobId} item={item} />
        </li>
      ))}
    </ul>
  );
}
