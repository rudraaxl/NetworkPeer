import { createFileRoute, Outlet, Link, useRouterState } from "@tanstack/react-router";
import { Home, User, Wallet } from "lucide-react";

import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { RouteGuard } from "@/components/route-guard";

export const Route = createFileRoute("/worker")({
  component: WorkerLayout,
});

const tabs = [
  { label: "Jobs", to: "/worker", icon: Home },
  { label: "Wallet", to: "/worker/wallet", icon: Wallet },
  { label: "Profile", to: "/worker/profile", icon: User },
];

function WorkerLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <RouteGuard role="WORKER">
      <div className="worker-portal-container min-h-screen bg-muted/40 px-3 py-3 sm:px-6 sm:py-6">
        <div className="mx-auto flex w-full max-w-[430px] flex-col">
          <div className="hidden items-center justify-between pb-3 sm:flex">
            <Link to="/" className="flex items-center gap-2 text-sm font-semibold">
              <span className="gradient-brand grid h-8 w-8 place-items-center rounded-xl text-xs font-bold text-primary-foreground">
                N
              </span>
              NetworkPeers Worker
            </Link>
            <ThemeToggle />
          </div>

          <div className="relative flex h-dvh min-h-screen w-full flex-col overflow-hidden rounded-[2rem] border border-border bg-background shadow-lift">
            <div className="glass sticky top-0 z-30 flex items-center justify-between border-b border-border/70 px-4 py-3 text-sm font-medium">
              <span className="font-semibold">Worker Portal</span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-success" /> Live
              </span>
            </div>

            <div className="flex-1 overflow-y-auto pb-24">
              <Outlet />
            </div>

            <nav className="glass sticky bottom-0 z-30 grid grid-cols-3 border-t border-border/70 px-2 py-2">
              {tabs.map((t) => {
                const active = pathname === t.to;
                return (
                  <Link
                    key={t.to}
                    to={t.to}
                    className={cn(
                      "press flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-8 w-14 place-items-center rounded-full transition-colors",
                        active && "bg-primary-soft",
                      )}
                    >
                      <t.icon className="h-4.5 w-4.5" />
                    </span>
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </div>
    </RouteGuard>
  );
}
