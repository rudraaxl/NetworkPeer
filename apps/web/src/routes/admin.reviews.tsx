import { createFileRoute } from "@tanstack/react-router";
import { MessageSquareQuote, ShieldAlert, Star } from "lucide-react";

import { PageHeader } from "@/components/shell/portal-shell";
import { SectionCard, Chip } from "@/components/marketplace/primitives";

export const Route = createFileRoute("/admin/reviews")({
  head: () => ({
    meta: [
      { title: "Admin reviews — NetworkPeers" },
      { name: "description", content: "Review quality feedback and moderation cases." },
    ],
  }),
  component: AdminReviews,
});

const reviews = [
  {
    id: "r1",
    ref: "GF-1041",
    score: 4.9,
    note: "Evidence was complete and timely",
    status: "Approved",
  },
  {
    id: "r2",
    ref: "GF-1039",
    score: 2.6,
    note: "Audio clip was low quality",
    status: "Needs follow-up",
  },
  { id: "r3", ref: "GF-1037", score: 4.7, note: "Strong verification trail", status: "Approved" },
];

function AdminReviews() {
  return (
    <div className="animate-rise space-y-6">
      <PageHeader title="Reviews" description="Moderate evidence reviews and partner feedback." />

      <div className="grid gap-4 xl:grid-cols-3">
        {reviews.map((review) => (
          <SectionCard key={review.id} title={review.ref} description={review.status}>
            <div className="space-y-3 text-base text-muted-foreground">
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 fill-warning text-warning" /> {review.score.toFixed(1)} / 5
              </div>
              <div className="flex items-center gap-2">
                <MessageSquareQuote className="h-4 w-4" /> {review.note}
              </div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-warning" /> {review.status}
              </div>
              <Chip tone={review.status === "Approved" ? "success" : "warning"}>
                {review.status}
              </Chip>
            </div>
          </SectionCard>
        ))}
      </div>
    </div>
  );
}
