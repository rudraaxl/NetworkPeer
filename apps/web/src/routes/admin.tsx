import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Briefcase,
  Building2,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { RouteGuard } from "@/components/route-guard";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

const nav = [
  { label: "Dashboard", to: "/admin", icon: Activity },
  { label: "Jobs", to: "/admin/jobs", icon: Briefcase },
  { label: "Workers", to: "/admin/workers", icon: Users },
  { label: "Clients", to: "/admin/clients", icon: Building2 },
  { label: "Reviews", to: "/admin/reviews", icon: ClipboardCheck },
  { label: "Payments", to: "/admin/payments", icon: CircleDollarSign },
  { label: "Analytics", to: "/admin/analytics", icon: BarChart3 },
  { label: "Settings", to: "/admin/settings", icon: Settings },
] as const;

function AdminLayout() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <RouteGuard role="ADMIN">
      <div className="admin-portal-root min-h-screen bg-background text-base">
        <div className="flex min-h-screen">
          <aside className="hidden w-72 shrink-0 border-r border-border bg-card/80 px-4 py-5 lg:flex lg:flex-col">
            <Link to="/admin" className="flex items-center gap-3 px-2">
              <span className="gradient-brand grid h-11 w-11 place-items-center rounded-2xl text-lg font-bold text-primary-foreground">
                N
              </span>
              <div>
                <p className="text-lg font-semibold">NetworkPeers Admin</p>
                <p className="text-base text-muted-foreground">Operations console</p>
              </div>
            </Link>

            <nav className="mt-8 space-y-1">
              {nav.map((item) => {
                const active =
                  pathname === item.to || (item.to !== "/admin" && pathname.startsWith(item.to));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "group flex items-center justify-between rounded-2xl px-3 py-2.75 text-base font-medium transition-all",
                      active
                        ? "bg-primary text-primary-foreground shadow-glow"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="h-4.5 w-4.5" />
                      {item.label}
                    </span>
                    <ChevronRight
                      className={cn("h-4 w-4 transition-transform", active && "translate-x-0.5")}
                    />
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto rounded-2xl border border-border bg-gradient-to-br from-primary-soft to-transparent p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <span className="text-base font-semibold">Fraud-ready</span>
              </div>
              <p className="mt-2 text-base leading-relaxed text-muted-foreground">
                Every action is logged with device and evidence context for the operations team.
              </p>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="glass sticky top-0 z-40 flex items-center justify-between border-b px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Open menu"
                  onClick={() => setOpen(true)}
                  className="press grid h-9 w-9 place-items-center rounded-xl border border-border bg-card lg:hidden"
                >
                  <Menu className="h-4 w-4" />
                </button>
                <div>
                  <p className="text-lg font-semibold">Operations overview</p>
                  <p className="text-base text-muted-foreground">
                    Trusted workspace for fraud-safe field work
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <Link
                  to="/"
                  className="hidden rounded-xl border border-border bg-card px-3 py-2 text-base font-medium sm:inline-flex"
                >
                  View app
                </Link>
              </div>
            </header>

            {open && (
              <div className="fixed inset-0 z-50 lg:hidden">
                <button
                  className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
                  onClick={() => setOpen(false)}
                />
                <div className="animate-rise absolute inset-y-0 left-0 w-72 border-r border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <Link
                      to="/admin"
                      className="flex items-center gap-3"
                      onClick={() => setOpen(false)}
                    >
                      <span className="gradient-brand grid h-10 w-10 place-items-center rounded-2xl text-lg font-bold text-primary-foreground">
                        N
                      </span>
                      <span className="text-base font-semibold">NetworkPeers Admin</span>
                    </Link>
                    <button
                      type="button"
                      aria-label="Close menu"
                      onClick={() => setOpen(false)}
                      className="grid h-8 w-8 place-items-center rounded-full bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <nav className="mt-6 space-y-1">
                    {nav.map((item) => {
                      const active =
                        pathname === item.to ||
                        (item.to !== "/admin" && pathname.startsWith(item.to));
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={() => setOpen(false)}
                          className={cn(
                            "flex items-center gap-3 rounded-2xl px-3 py-2.75 text-base font-medium",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          <Icon className="h-4.5 w-4.5" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </nav>
                </div>
              </div>
            )}

            <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </RouteGuard>
  );
}
