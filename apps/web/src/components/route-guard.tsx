import { useEffect, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useAuthSession, type AppRole } from "@/lib/auth-session";

function roleHome(role: AppRole): string {
  if (role === "ADMIN") return "/admin";
  if (role === "WORKER") return "/worker";
  return "/client";
}

export function RouteGuard({ role, children }: { role: AppRole; children: ReactNode }) {
  const router = useRouter();
  const session = useAuthSession();

  useEffect(() => {
    if (!session) {
      void router.navigate({ to: "/auth" });
      return;
    }
    if (session.user.role !== role) {
      void router.navigate({ to: roleHome(session.user.role) });
    }
  }, [router, role, session]);

  if (!session || session.user.role !== role) {
    return null;
  }

  return <>{children}</>;
}
