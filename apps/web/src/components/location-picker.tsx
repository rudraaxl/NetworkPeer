import "leaflet/dist/leaflet.css";
import { Crosshair, Loader2, MapPin, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const DEFAULT_CENTER: [number, number] = [12.9716, 77.5946]; // Bengaluru
const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

type LeafletModule = typeof import("leaflet");
type Marker = import("leaflet").Marker;
type Map = import("leaflet").Map;

function pinHtml(active: boolean): string {
  return `<span style="display:grid;place-items:center;width:22px;height:22px;transform:translate(-50%,-100%)">
    <span style="position:absolute;width:30px;height:30px;border-radius:9999px;background:oklch(0.63 0.19 262.9 / 0.35);animation:soft-pulse 2s ease-in-out infinite"></span>
    <span style="display:block;width:16px;height:16px;border-radius:9999px;border:2.5px solid #fff;background:linear-gradient(135deg,#4f7cff,#22c1a3);box-shadow:0 4px 12px oklch(0.2 0.03 265 / 0.5)"></span>
  </span>`;
}

export function LocationPicker({
  lat,
  lng,
  onPick,
  className,
}: {
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const leafletRef = useRef<LeafletModule | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Keep the marker in sync with the parent's coordinates (e.g. initial value).
  const syncMarker = useCallback(
    (L: LeafletModule, map: Map, nextLat: number, nextLng: number) => {
      const next: [number, number] = [nextLat, nextLng];
      if (markerRef.current) {
        markerRef.current.setLatLng(next);
      } else {
        markerRef.current = L.marker(next, {
          icon: L.divIcon({ html: pinHtml(true), className: "", iconSize: [22, 22], iconAnchor: [11, 22] }),
          draggable: true,
        })
          .addTo(map)
          .on("dragend", () => {
            const position = markerRef.current?.getLatLng();
            if (position) onPickRef.current(position.lat, position.lng);
          });
      }
      map.flyTo(next, Math.max(map.getZoom(), 14), { duration: 0.6 });
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    let map: Map | null = null;

    void import("leaflet").then((L) => {
      if (disposed || !containerRef.current) return;
      leafletRef.current = L;

      const instance = L.map(containerRef.current, {
        center: lat !== null && lng !== null ? [lat, lng] : DEFAULT_CENTER,
        zoom: lat !== null && lng !== null ? 14 : 11,
        zoomControl: true,
      });
      map = instance;
      L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(instance);

      instance.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        const { lat: nextLat, lng: nextLng } = event.latlng;
        syncMarker(L, instance, nextLat, nextLng);
        onPickRef.current(nextLat, nextLng);
      });

      if (lat !== null && lng !== null) {
        syncMarker(L, instance, lat, lng);
      }
    });

    return () => {
      disposed = true;
      map?.remove();
      markerRef.current = null;
    };
  }, [lat, lng, syncMarker]);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setStatus("Searching for the address…");
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok) throw new Error("search failed");
      const results = (await response.json()) as { lat: string; lon: string; display_name: string }[];
      const first = results[0];
      if (!first) {
        setStatus("No match found — try a different address or tap the map.");
        return;
      }
      const nextLat = Number(first.lat);
      const nextLng = Number(first.lon);
      if (leafletRef.current && mapRef.current) {
        syncMarker(leafletRef.current, mapRef.current, nextLat, nextLng);
      }
      onPickRef.current(nextLat, nextLng);
      setStatus(first.display_name);
    } catch {
      setStatus("Address search is unavailable right now — tap the map instead.");
    } finally {
      setSearching(false);
    }
  }, [query, syncMarker]);

  const useMyLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("Location is not available on this browser.");
      return;
    }
    setLocating(true);
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLat = position.coords.latitude;
        const nextLng = position.coords.longitude;
        if (leafletRef.current && mapRef.current) {
          syncMarker(leafletRef.current, mapRef.current, nextLat, nextLng);
        }
        onPickRef.current(nextLat, nextLng);
        setStatus("Location set from your device.");
        setLocating(false);
      },
      () => {
        setStatus("Could not read your location — search an address or tap the map.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, [syncMarker]);

  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void runSearch();
              }
            }}
            placeholder="Search an address or area…"
          />
        </div>
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={searching || !query.trim()}
          className="press inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Search
        </button>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="press inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm font-medium disabled:opacity-50"
          title="Use my current location"
        >
          {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
          <span className="hidden sm:inline">My location</span>
        </button>
      </div>

      <div
        ref={containerRef}
        className="h-72 w-full overflow-hidden rounded-2xl border border-border bg-muted/40 shadow-soft"
        aria-label="Interactive map — tap to set the job location"
      />

      {status ? (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 break-words">{status}</span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Tap the map (or drag the pin) to place the job. Coordinates are sent as GeoJSON in
          backend order: longitude, then latitude.
        </p>
      )}
    </div>
  );
}
