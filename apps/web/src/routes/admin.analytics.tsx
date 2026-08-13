import { createFileRoute } from "@tanstack/react-router";
import { BarChart3, TrendingUp } from "lucide-react";

import { PageHeader } from "@/components/shell/portal-shell";
import { SectionCard, Chip } from "@/components/marketplace/primitives";

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({
    meta: [
      { title: "Admin analytics — NetworkPeers" },
      { name: "description", content: "Growth and quality analytics." },
    ],
  }),
  component: AdminAnalytics,
});

function AdminAnalytics() {
  return (
    <div className="animate-rise space-y-6">
      <PageHeader title="Analytics" description="Review performance trends and service health." />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Volume growth" description="Monthly job completion trend">
          <div className="flex h-48 items-end gap-3 rounded-2xl border border-border bg-muted/40 p-4">
            {[34, 42, 50, 61, 70, 82].map((height, index) => (
              <div key={index} className="flex flex-1 flex-col items-center gap-2">
                <div
                  className="w-full rounded-t-2xl bg-gradient-to-t from-success to-primary"
                  style={{ height: `${height}%` }}
                />
                <span className="text-[13px] text-muted-foreground">M{index + 1}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Quality signals" description="Signals that need monitoring">
          <div className="space-y-3 text-base text-muted-foreground">
            <div className="flex items-center justify-between rounded-2xl border border-border px-3 py-3">
              <span className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-success" /> Completion rate
              </span>
              <Chip tone="success">97.2%</Chip>
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-border px-3 py-3">
              <span className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" /> Evidence quality
              </span>
              <Chip tone="primary">92%</Chip>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
