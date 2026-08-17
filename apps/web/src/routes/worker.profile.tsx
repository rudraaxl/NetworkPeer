import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CircleAlert, Loader2, LogOut, MapPin, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/shell/portal-shell";
import { Chip, SectionCard } from "@/components/marketplace/primitives";
import { api, ApiError } from "@/lib/api";
import { authSession } from "@/lib/auth-session";

export const Route = createFileRoute("/worker/profile")({
  head: () => ({
    meta: [
      { title: "Worker profile — NetworkPeers" },
      { name: "description", content: "Your worker profile and trust status." },
    ],
  }),
  component: WorkerProfile,
});

type WorkerProfileData = {
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";
  preferredRadiusKm: number;
  isAvailable: boolean;
  currentLocation: { type: "Point"; coordinates: [number, number] } | null;
  lastLocationUpdate: string | null;
};

function verificationTone(status: string): "success" | "warning" | "danger" | "primary" {
  switch (status) {
    case "VERIFIED":
      return "success";
    case "PENDING":
      return "warning";
    case "REJECTED":
    case "SUSPENDED":
      return "danger";
    default:
      return "primary";
  }
}

function verificationLabel(status: string): string {
  switch (status) {
    case "VERIFIED":
      return "Verified Worker";
    case "PENDING":
      return "Verification pending";
    case "REJECTED":
      return "Verification rejected";
    case "SUSPENDED":
      return "Suspended";
    default:
      return status.replaceAll("_", " ").toLowerCase();
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  return "The profile could not be loaded. Check your connection and try again.";
}

function WorkerProfile() {
  const router = useRouter();
  const [profile, setProfile] = useState<WorkerProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const user = authSession.get()?.user;

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      setProfile(await api.workerProfile());
      setError(null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const logout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await api.logout();
    } catch {
      // The session is cleared either way; the server revoke also runs.
    } finally {
      setIsLoggingOut(false);
      await router.navigate({ to: "/" });
    }
  }, [router]);

  const locationAgeMinutes =
    profile?.lastLocationUpdate === null || profile?.lastLocationUpdate === undefined
      ? null
      : Math.max(
          0,
          Math.round((Date.now() - new Date(profile.lastLocationUpdate).getTime()) / 60_000),
        );

  return (
    <div className="animate-rise px-3 py-3">
      <PageHeader title="Profile" description="Your identity and trust status." />

      <div className="mt-3 flex flex-col gap-3">
        <div className="w-full">
          <SectionCard title="Worker profile" description="Trusted partner profile">
            {isLoading ? (
              <div className="animate-pulse space-y-3">
                <div className="h-20 rounded-2xl bg-muted" />
                <div className="h-24 rounded-2xl bg-muted" />
              </div>
            ) : profile ? (
              <div className="worker-compact-card flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">
                    {user?.full_name?.trim() ? user.full_name : (user?.phone ?? "Worker")}
                  </h2>
                  <Chip tone={verificationTone(profile.verificationStatus)}>
                    <BadgeCheck className="h-3.5 w-3.5" />{" "}
                    {verificationLabel(profile.verificationStatus)}
                  </Chip>
                </div>
                {user?.full_name?.trim() ? (
                  <p className="-mt-1 text-xs text-muted-foreground">{user.phone}</p>
                ) : null}
                <div className="flex flex-wrap gap-3 text-sm">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <ShieldCheck className="h-4 w-4 text-success" />{" "}
                    {profile.isAvailable ? "Available for work" : "Currently unavailable"}
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <MapPin className="h-4 w-4 text-primary" /> {profile.preferredRadiusKm} km
                    search radius
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {profile.currentLocation
                    ? locationAgeMinutes === null
                      ? "Location on record."
                      : `Location updated ${locationAgeMinutes} minute${locationAgeMinutes === 1 ? "" : "s"} ago.`
                    : "No location on record yet. Refresh your location from the nearby jobs page."}
                </p>
              </div>
            ) : (
              <p
                role="alert"
                className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
              >
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error ?? "Profile not found."}
              </p>
            )}
          </SectionCard>
        </div>

        <div className="w-full">
          <SectionCard title="Settings" description="Account controls">
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => void logout()}
                disabled={isLoggingOut}
                className="press flex w-full items-center justify-between rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm font-medium text-destructive disabled:opacity-60"
              >
                <span className="flex items-center gap-2">
                  {isLoggingOut ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LogOut className="h-4 w-4" />
                  )}
                  {isLoggingOut ? "Signing out" : "Logout"}
                </span>
              </button>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
