import { createFileRoute } from "@tanstack/react-router";
import { Smartphone } from "lucide-react";

import { api } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";

/**
 * Where a worker lands on the website.
 *
 * This site is for clients: posting jobs, funding escrow, reviewing evidence
 * and releasing payment. Finding and doing the work happens in the Android
 * app, so the worker portal that used to live under this path -- a job feed, a
 * task flow, a wallet and a profile, about two thousand lines of it -- has
 * been removed rather than maintained as a second, worse copy of the app.
 *
 * The route itself stays, because RouteGuard sends a signed-in worker to their
 * role's home and a dangling path would be a blank screen instead of an
 * explanation.
 */
export const Route = createFileRoute("/worker")({
  component: WorkerOnMobile,
});

function WorkerOnMobile() {
  const session = useAuthSession();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
        <Smartphone className="h-7 w-7 text-muted-foreground" aria-hidden />
      </div>

      <h1 className="mt-8 text-3xl font-bold tracking-tight">Your work is in the app</h1>

      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        {session?.user.full_name ? `${session.user.full_name}, your` : "Your"} account is a worker
        account. Finding jobs near you, capturing evidence on site and getting paid all happen in
        the NetworkPeer Android app. This site is where clients post the work and pay for it.
      </p>

      <div className="mt-8 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-medium">Get the app</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Install it on the phone you will be working from, and sign in with this same email
          address.
        </p>
      </div>

      <button
        type="button"
        onClick={() => {
          void api.logout();
        }}
        className="press mt-8 self-start rounded-xl border border-border px-5 py-3 text-sm font-semibold"
      >
        Sign out
      </button>
    </main>
  );
}
