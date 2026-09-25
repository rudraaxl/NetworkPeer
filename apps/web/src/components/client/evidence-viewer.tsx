import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Loader2, Maximize2, X } from "lucide-react";

import { api, type EvidenceSummary } from "@/lib/api";

/**
 * Shows the client what the worker actually photographed.
 *
 * The review screen listed each item by type, size and capture time behind a
 * Download button that called an endpoint which does not exist -- there is no
 * /client/jobs/:jobId/evidence/:mediaId/download route on the API, so every
 * press 404'd. The signed URL was in the list response the whole time:
 * ClientEvidenceReviewService builds one per item into `download.url`.
 *
 * So nothing here fetches. The URL arrives with the list and is used directly,
 * which is also why an expired one is recoverable -- reloading the list mints
 * new URLs for every item at once.
 */

type Props = {
  item: EvidenceSummary;
  /**
   * Called when the browser refuses the signed URL. These expire after ten
   * minutes by default, which is well within the time someone can spend
   * deciding whether to approve a job, so the gallery reloads rather than
   * showing a broken image to a client who is about to release money.
   */
  onExpired?: () => void;
};

export function EvidenceMedia({ item, onExpired }: Props) {
  const [broken, setBroken] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const url = item.download?.url;

  // A new URL for this item means a fresh attempt is worth making.
  useEffect(() => {
    setBroken(false);
  }, [url]);

  const handleError = useCallback(() => {
    setBroken(true);
    onExpired?.();
  }, [onExpired]);

  // Escape closes the lightbox, which is what anyone will try first.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  if (!url || broken) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-muted-foreground">
        <FileText className="h-4 w-4 shrink-0" aria-hidden />
        {url
          ? "This preview link expired. Refresh the page to load it again."
          : "No preview is available for this file."}
      </div>
    );
  }

  if (item.media_type === "VIDEO") {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        onError={handleError}
        className="mt-3 max-h-96 w-full rounded-xl border border-border bg-black"
      />
    );
  }

  if (item.media_type === "AUDIO") {
    return <audio src={url} controls onError={handleError} className="mt-3 w-full" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="press group relative mt-3 block w-full overflow-hidden rounded-xl border border-border bg-card"
      >
        <img
          src={url}
          alt=""
          onError={handleError}
          className="max-h-96 w-full object-contain"
        />
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

/** Opens the original in a new tab. The signed URL is already in hand. */
export function EvidenceDownloadButton({
  item,
  className,
}: {
  item: EvidenceSummary;
  className?: string;
}) {
  if (!item.download?.url) return null;
  return (
    <a
      href={item.download.url}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "press inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-medium"
      }
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      Download
    </a>
  );
}

/**
 * The evidence for a job, fetched and laid out as a gallery.
 *
 * The review screen has its own richer list -- status chips and OCR results,
 * which only matter while deciding whether to approve. This is the plain view
 * for every other point in the job's life: the API serves evidence from
 * IN_PROGRESS through COMPLETED, but the site only ever asked for it on the
 * review screen, so approving a job made the photos the client had paid for
 * unreachable.
 */
export function JobEvidenceGallery({ jobId }: { jobId: string }) {
  const [evidence, setEvidence] = useState<EvidenceSummary[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    api
      .clientJobEvidence(jobId)
      .then((result) => {
        if (!cancelled) {
          setEvidence(result.evidence);
          setError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => load(), [load]);

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
    <ul className="space-y-5">
      {evidence.map((item) => (
        <li key={item.id}>
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              Captured {new Date(item.captured_at).toLocaleString()}
            </span>
            <EvidenceDownloadButton item={item} />
          </div>
          <EvidenceMedia item={item} onExpired={load} />
        </li>
      ))}
    </ul>
  );
}
