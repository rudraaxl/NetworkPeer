import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, User, Settings, ChevronDown } from "lucide-react";
import { useState, useRef, useEffect } from "react";

import { useAuthSession, authSession } from "@/lib/auth-session";
import { api } from "@/lib/api";

export function UserNavMenu({ identity }: { identity: "Client" | "Worker" | "Admin" }) {
  const [open, setOpen] = useState(false);
  const session = useAuthSession();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);

  const user = session?.user;
  const initial = user?.full_name?.charAt(0).toUpperCase() || (identity === "Client" ? "C" : identity === "Worker" ? "W" : "A");
  const displayName = user?.full_name || (identity === "Client" ? "Client Workspace" : identity === "Worker" ? "Worker Portal" : "Admin Console");

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      authSession.clear();
    } finally {
      setOpen(false);
      await navigate({ to: "/" });
    }
  };

  // A worker has no profile page on this site; /worker explains why.
  const profileHref =
    identity === "Client" ? "/client/profile" : identity === "Worker" ? "/worker" : "/admin/settings";

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="press flex items-center gap-2 rounded-xl border border-border bg-card p-1.5 hover:bg-muted text-sm"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
          {initial}
        </span>
        <span className="hidden md:block max-w-[120px] truncate font-medium text-foreground text-xs">
          {displayName}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden sm:block" />
      </button>

      {open && (
        <div className="animate-rise absolute right-0 mt-2 w-56 rounded-2xl border border-border bg-card p-2 shadow-2xl z-50">
          <div className="border-b border-border/60 px-3 py-2">
            <p className="text-sm font-semibold text-foreground truncate">{displayName}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.phone || "Verified Account"}</p>
          </div>

          <div className="py-1 space-y-0.5">
            <Link
              to={profileHref}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
            >
              <User className="h-4 w-4 text-muted-foreground" />
              <span>Profile & Credentials</span>
            </Link>
          </div>

          <div className="border-t border-border/60 pt-1">
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              <span>Log out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
