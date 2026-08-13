import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Menu, Search, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { AnonymousBadge } from "@/components/marketplace/primitives";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  badge?: string;
}

export function PortalShell({
  brand,
  brandSub,
  nav,
  identity,
  children,
  headerAction,
  className,
}: {
  brand: string;
  brandSub: string;
  nav: NavItem[];
  identity: "Client" | "Worker" | "Admin";
  children: ReactNode;
  headerAction?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const SidebarBody = (
    <div className="flex h-full flex-col gap-6 p-4">
      <Link to="/" className="flex items-center gap-3 px-2 pt-1">
        <span className="gradient-brand animate-gradient-pan grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg font-bold text-primary-foreground">
          N
        </span>
        <span className="min-w-0">
          <span className="text-gradient-brand block truncate text-2xl font-bold tracking-tight">
            {brand}
          </span>
          <span className="block truncate text-sm text-muted-foreground">{brandSub}</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-1">
        {nav.map((item) => {
          const active =
            pathname === item.to || (item.to !== "/" && pathname.startsWith(item.to + "/"));
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={cn(
                "group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2.75 text-base font-medium transition-all",
                active
                  ? "bg-primary text-primary-foreground shadow-glow"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
              )}
            >
              <item.icon className="h-4.5 w-4.5 shrink-0" />
              <span className="truncate">{item.label}</span>
              {item.badge && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[13px] font-semibold",
                    active ? "bg-primary-foreground/20" : "bg-primary-soft text-primary",
                  )}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary-soft to-transparent p-4">
        <AnonymousBadge role={identity === "Admin" ? "Client" : identity} />
        <p className="mt-2 text-base leading-relaxed text-muted-foreground">
          Identities stay hidden until a job is accepted. All contact happens through NetworkPeers.
        </p>
      </div>
    </div>
  );

  return (
    <div className={cn("flex min-h-screen w-full bg-background text-base", className)}>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        {SidebarBody}
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="animate-rise absolute inset-y-0 left-0 w-72 border-r border-sidebar-border bg-sidebar">
            <button
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 grid h-8 w-8 place-items-center rounded-full bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
            {SidebarBody}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-40 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-3 sm:px-6">
          <button
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="press grid h-9 w-9 place-items-center rounded-xl border border-border bg-card lg:hidden"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="relative hidden min-w-0 sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Search jobs, refs, transactions…"
              className="h-11 w-full max-w-md rounded-xl border border-border bg-card pl-9 pr-3 text-lg outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            {headerAction}
            <Link
              to="/client/notifications"
              className="press relative grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive" />
            </Link>
            <ThemeToggle />
            <span className="grid h-10 w-10 place-items-center rounded-full bg-primary-soft text-base font-semibold text-primary">
              {identity[0]}
            </span>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="animate-rise mb-6 flex flex-col gap-4 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <h1 className="text-4xl font-semibold sm:text-4xl">{title}</h1>
        {description && <p className="mt-1 text-base text-muted-foreground">{description}</p>}
      </div>
      <div className="flex items-center justify-start sm:justify-end">{action}</div>
    </div>
  );
}
