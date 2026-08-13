import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BellOff, Briefcase, CheckCheck, Loader2, Settings2, Star } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shell/portal-shell";
import { EmptyState, SectionCard } from "@/components/marketplace/primitives";
import { api, type AppNotification } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";

export const Route = createFileRoute("/client/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications - NetworkPeers client" },
      {
        name: "description",
        content: "Live job and evidence updates from your NetworkPeers workspace.",
      },
    ],
  }),
  component: Notifications,
});

const kindMeta = {
  job: { icon: Briefcase, tone: "bg-primary-soft text-primary" },
  review: { icon: Star, tone: "bg-warning/20 text-warning" },
  system: { icon: Settings2, tone: "bg-muted text-muted-foreground" },
} as const;

const tabs = ["All", "Unread", "Jobs", "Evidence"] as const;

function notificationKind(topic: string): keyof typeof kindMeta {
  if (topic === "EVIDENCE_UPLOADED") return "review";
  if (topic.startsWith("JOB_")) return "job";
  return "system";
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function Notifications() {
  const session = useAuthSession();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof tabs)[number]>("All");
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: api.notifications,
    enabled: Boolean(session),
  });
  const markRead = useMutation({
    mutationFn: api.markNotificationRead,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAllRead = useMutation({
    mutationFn: api.markAllNotificationsRead,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(
        result.marked_count ? "Notifications marked read" : "You are already caught up",
      );
    },
  });
  const items = notificationsQuery.data?.items ?? [];
  const filtered = items.filter((notification) => {
    if (tab === "All") return true;
    if (tab === "Unread") return notification.read_at === null;
    if (tab === "Jobs") return notificationKind(notification.topic) === "job";
    return notificationKind(notification.topic) === "review";
  });

  if (!session) {
    return (
      <EmptyState
        icon={BellOff}
        title="Sign in to see notifications"
        description="Your synchronized job and evidence updates appear after you sign in."
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description={`${items.filter((notification) => notification.read_at === null).length} unread`}
        action={
          <button
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="press inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-base font-medium disabled:opacity-60"
          >
            {markAllRead.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="h-4 w-4" />
            )}{" "}
            Mark all read
          </button>
        }
      />
      <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1">
        {tabs.map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-base font-medium transition-all",
              tab === item ? "bg-card shadow-soft" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item}
          </button>
        ))}
      </div>
      {notificationsQuery.isPending ? (
        <div className="flex min-h-48 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading updates
        </div>
      ) : notificationsQuery.isError ? (
        <EmptyState
          icon={BellOff}
          title="Notifications are unavailable"
          description="Reconnect or refresh to retrieve your durable sync feed."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="You're all caught up"
          description="New job updates and evidence submissions will land here."
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <ul className="space-y-3">
            {filtered.map((notification: AppNotification) => {
              const meta = kindMeta[notificationKind(notification.topic)];
              return (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() =>
                      notification.read_at === null && markRead.mutate(notification.id)
                    }
                    className={cn(
                      "hover-lift grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 rounded-2xl border bg-card p-4 text-left shadow-soft",
                      notification.read_at === null ? "border-primary/40" : "border-border",
                    )}
                  >
                    <span className={cn("grid h-10 w-10 place-items-center rounded-xl", meta.tone)}>
                      <meta.icon className="h-4.5 w-4.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-base font-semibold">
                        {notification.title}
                      </span>
                      <span className="block text-base text-muted-foreground">
                        {notification.body}
                      </span>
                      <span className="mt-1 block text-base text-muted-foreground">
                        {formatTimestamp(notification.created_at)}
                      </span>
                    </span>
                    {notification.read_at === null ? (
                      <span className="mt-2 h-2 w-2 rounded-full bg-primary" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <SectionCard
            title="Delivery"
            description="In-app updates synchronize over Socket.IO and recover through cursor sync."
          >
            <p className="text-base text-muted-foreground">
              Enable browser push from a registered Firebase web client in a later frontend
              deployment step.
            </p>
          </SectionCard>
        </div>
      )}
    </>
  );
}
