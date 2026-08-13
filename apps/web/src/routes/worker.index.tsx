import { createFileRoute, Link } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, List, Loader2, Map as MapIcon, MapPin, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { cn, formatCurrency } from "@/lib/utils";
import { api, ApiError, type WorkerJobSummary } from "@/lib/api";
import { AnonymousBadge, Chip, MapCanvas } from "@/components/marketplace/primitives";

export const Route = createFileRoute("/worker/")({
  head: () => ({
    meta: [
      { title: "Nearby jobs — NetworkPeers Worker" },
      {
        name: "description",
        content: "Browse nearby field work without exposing exact job locations before assignment.",
      },
    ],
  }),
  component: WorkerHome,
});

function useDebouncedValue<Value>(value: Value, delayMs: number): Value {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debouncedValue;
}

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
  }
}

function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return "Unable to load nearby jobs. Check your connection and try again.";
}

const WorkerJobCard = memo(function WorkerJobCard({ job }: { job: WorkerJobSummary }) {
  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-soft">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <Chip tone="teal">{job.category}</Chip>
          <h2 className="mt-2 truncate text-sm font-semibold">{job.title}</h2>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{job.description}</p>
        </div>
        <p className="text-lg font-bold text-primary">{formatCurrency(job.budget_cents / 100)}</p>
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

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Link
          to="/worker/job/$jobId"
          params={{ jobId: job.id }}
          className="press inline-flex h-10 items-center justify-center rounded-xl border border-border bg-card text-sm font-semibold"
        >
          Details
        </Link>
        <Link
          to="/worker/job/$jobId"
          params={{ jobId: job.id }}
          className="press gradient-brand inline-flex h-10 items-center justify-center rounded-xl px-5 text-sm font-semibold text-primary-foreground"
        >
          Review
        </Link>
      </div>
    </article>
  );
});

const JobListSkeleton = memo(function JobListSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading nearby jobs" aria-busy="true">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="animate-pulse rounded-2xl border border-border bg-card p-4">
          <div className="h-4 w-20 rounded bg-muted" />
          <div className="mt-3 h-4 w-3/5 rounded bg-muted" />
          <div className="mt-2 h-3 w-full rounded bg-muted" />
          <div className="mt-4 h-10 rounded-xl bg-muted" />
        </div>
      ))}
    </div>
  );
});

const PrivacyMap = memo(function PrivacyMap({ jobCount }: { jobCount: number }) {
  return (
    <div className="animate-rise mt-4 space-y-3">
      <MapCanvas
        className="h-[420px]"
        pins={jobCount}
        label={`${jobCount} nearby job${jobCount === 1 ? "" : "s"} in coarse distance bands`}
      />
      <p className="text-center text-xs text-muted-foreground">
        Exact job locations and routes remain hidden until a worker is assigned.
      </p>
    </div>
  );
});

function WorkerHome() {
  const [view, setView] = useState<"list" | "map">("list");
  const [query, setQuery] = useState("");
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [maximumRadiusKm, setMaximumRadiusKm] = useState<number | null>(null);
  const [jobs, setJobs] = useState<WorkerJobSummary[]>([]);
  const [isLocating, setIsLocating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [locationReadyVersion, setLocationReadyVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const initialLocationRequested = useRef(false);
  const locationRequestInFlight = useRef(false);
  const requestSequence = useRef(0);
  const debouncedRadiusKm = useDebouncedValue(radiusKm, 450);

  const refreshLocation = useCallback(() => {
    if (locationRequestInFlight.current) return;
    if (!("geolocation" in navigator)) {
      setError(
        "Geolocation is not available in this browser. Enable location access to search for work.",
      );
      return;
    }

    locationRequestInFlight.current = true;
    setIsLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void (async () => {
          try {
            await api.updateWorkerLocation({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
            setLocationReadyVersion((version) => version + 1);
          } catch (requestError) {
            const message = apiErrorMessage(requestError);
            setError(message);
            toast.error(message);
          } finally {
            locationRequestInFlight.current = false;
            setIsLocating(false);
          }
        })();
      },
      (positionError) => {
        locationRequestInFlight.current = false;
        setIsLocating(false);
        setError(`Location access failed: ${positionError.message}`);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }, []);

  useEffect(() => {
    if (initialLocationRequested.current) return;
    initialLocationRequested.current = true;
    refreshLocation();
  }, [refreshLocation]);

  useEffect(() => {
    if (locationReadyVersion === 0) return;
    const sequence = ++requestSequence.current;
    let active = true;
    setIsLoading(true);
    setError(null);

    void api
      .nearbyWorkerJobs({
        ...(debouncedRadiusKm === null ? {} : { radiusKm: debouncedRadiusKm }),
        page: 1,
        perPage: 20,
      })
      .then((result) => {
        if (active && sequence === requestSequence.current) {
          setJobs(result.items);
          setMaximumRadiusKm(result.radius_km);
          setRadiusKm((currentRadius) => currentRadius ?? result.radius_km);
        }
      })
      .catch((requestError: unknown) => {
        if (active && sequence === requestSequence.current) setError(apiErrorMessage(requestError));
      })
      .finally(() => {
        if (active && sequence === requestSequence.current) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [debouncedRadiusKm, locationReadyVersion]);

  const visibleJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return jobs;
    return jobs.filter((job) =>
      `${job.title} ${job.description} ${job.category}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    );
  }, [jobs, query]);

  const radiusOptions = useMemo(() => {
    if (maximumRadiusKm === null) return [];
    const standardOptions = [1, 5, 10, 20].filter((radius) => radius <= maximumRadiusKm);
    return standardOptions.includes(maximumRadiusKm)
      ? standardOptions
      : [...standardOptions, maximumRadiusKm].sort((left, right) => left - right);
  }, [maximumRadiusKm]);

  return (
    <div className="px-4 pt-4">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Available near your current location</p>
          <h1 className="flex items-center gap-1 truncate text-lg font-semibold">
            <MapPin className="h-4 w-4 shrink-0 text-primary" /> Nearby jobs
          </h1>
        </div>
        <button
          type="button"
          onClick={refreshLocation}
          disabled={isLocating}
          className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-success/20 px-3 text-xs font-semibold text-success disabled:opacity-60"
        >
          {isLocating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {isLocating ? "Locating" : "Refresh"}
        </button>
      </header>

      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter loaded jobs"
            className="h-11 w-full rounded-2xl border border-border bg-card pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <select
          value={radiusKm ?? ""}
          onChange={(event) => setRadiusKm(Number(event.target.value))}
          disabled={maximumRadiusKm === null}
          className="h-11 rounded-2xl border border-border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          aria-label="Search radius"
        >
          {radiusOptions.length === 0 && <option value="">Loading radius</option>}
          {radiusOptions.map((radius) => (
            <option key={radius} value={radius}>
              {radius} km radius
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
        {(
          [
            { id: "list", label: "List", icon: List },
            { id: "map", label: "Map", icon: MapIcon },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setView(item.id)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition-all",
              view === item.id ? "bg-card shadow-soft" : "text-muted-foreground",
            )}
          >
            <item.icon className="h-4 w-4" /> {item.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {view === "map" ? (
        <PrivacyMap jobCount={visibleJobs.length} />
      ) : (
        <div className="animate-rise mt-4 space-y-3">
          {isLoading ? (
            <JobListSkeleton />
          ) : visibleJobs.length > 0 ? (
            visibleJobs.map((job) => <WorkerJobCard key={job.id} job={job} />)
          ) : locationReadyVersion > 0 ? (
            <p className="rounded-2xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
              No nearby jobs match this search.
            </p>
          ) : (
            <p className="rounded-2xl border border-border bg-card p-5 text-center text-sm text-muted-foreground">
              Allow location access to find nearby work.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
