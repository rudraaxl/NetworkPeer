import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell, Briefcase, LayoutDashboard, PlusCircle, Wallet } from "lucide-react";

import { PortalShell, type NavItem } from "@/components/shell/portal-shell";
import { RouteGuard } from "@/components/route-guard";
import { api } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";

const baseNav: NavItem[] = [
  { label: "Dashboard", to: "/client", icon: LayoutDashboard },
  { label: "My jobs", to: "/client/jobs", icon: Briefcase, badge: "6" },
  { label: "Post a job", to: "/client/jobs/new", icon: PlusCircle },
  { label: "Wallet", to: "/client/wallet", icon: Wallet },
  { label: "Notifications", to: "/client/notifications", icon: Bell },
];

export const Route = createFileRoute("/client")({
  component: ClientLayout,
});

function ClientLayout() {
  const session = useAuthSession();
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: api.notifications,
    enabled: Boolean(session),
  });
  const unread =
    notifications.data?.items.filter((notification) => notification.read_at === null).length ?? 0;
  const nav = baseNav.map((item) =>
    item.to === "/client/notifications" && unread > 0 ? { ...item, badge: String(unread) } : item,
  );

  return (
    <RouteGuard role="CLIENT">
      <PortalShell
        className="client-portal-root text-base"
        brand="NetworkPeers"
        brandSub="Client workspace"
        nav={nav}
        identity="Client"
        headerAction={
          <Link
            to="/client/jobs/new"
            className="press gradient-brand shadow-glow hidden items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-base font-semibold text-primary-foreground sm:inline-flex"
          >
            <PlusCircle className="h-4 w-4" /> New job
          </Link>
        }
      >
        <Outlet />
      </PortalShell>
    </RouteGuard>
  );
}
