import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  LogOut,
  ShieldCheck,
  Star,
  UserRoundCheck,
} from "lucide-react";

import { PageHeader } from "@/components/shell/portal-shell";
import { Chip, SectionCard } from "@/components/marketplace/primitives";

export const Route = createFileRoute("/worker/profile")({
  head: () => ({
    meta: [
      { title: "Worker profile — NetworkPeers" },
      { name: "description", content: "Edit your worker profile and trust profile." },
    ],
  }),
  component: WorkerProfile,
});

const skills = ["Inspection", "Photography", "Merchandising", "Audio capture"];
const docs = ["Government ID", "Insurance", "Training certificate"];

function WorkerProfile() {
  return (
    <div className="animate-rise px-3 py-3">
      <PageHeader title="Profile" description="Your verified identity and quality signals." />

      <div className="mt-3 flex flex-col gap-3">
        <div className="w-full">
          <SectionCard title="Worker profile" description="Trusted partner profile">
            <div className="worker-compact-card flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="grid h-20 w-20 place-items-center rounded-2xl border border-border bg-primary-soft text-primary">
                <UserRoundCheck className="h-10 w-10" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">A. Rivera</h2>
                  <Chip tone="success">
                    <BadgeCheck className="h-3.5 w-3.5" /> Verified Worker
                  </Chip>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Field inspection specialist · Downtown SF
                </p>
                <div className="mt-2 flex flex-wrap gap-3 text-sm">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Star className="h-4 w-4 fill-warning text-warning" /> 4.9 / 5
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <ShieldCheck className="h-4 w-4 text-success" /> 137 jobs
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="w-full">
          <div className="flex flex-col gap-3">
            <SectionCard title="Skills & reliability" description="What clients see about you">
              <div className="space-y-3">
                <div className="flex flex-row gap-2 overflow-x-auto pb-2 snap-x">
                  {skills.map((skill) => (
                    <span
                      key={skill}
                      className="w-[80%] shrink-0 snap-center rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
                <div className="worker-compact-card rounded-2xl border border-border bg-muted/40 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span>Reliability score</span>
                    <span className="font-semibold text-foreground">98%</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-border">
                    <div className="h-2 w-[98%] rounded-full bg-gradient-to-r from-primary to-brand-teal" />
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Documents" description="Verification files">
              <div className="flex flex-row gap-3 overflow-x-auto pb-2 snap-x">
                {docs.map((doc) => (
                  <div
                    key={doc}
                    className="w-[80%] shrink-0 snap-center rounded-2xl border border-border bg-card/80 px-3 py-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>{doc}</span>
                      <span className="font-medium text-primary">Verified</span>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>

        <div className="w-full">
          <SectionCard title="Settings" description="Profile controls">
            <div className="space-y-2">
              <button className="press flex w-full items-center justify-between rounded-2xl border border-border bg-card px-3 py-3 text-sm font-medium">
                <span className="flex items-center gap-2">
                  <Camera className="h-4 w-4" /> Update photo
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </button>
              <button className="press flex w-full items-center justify-between rounded-2xl border border-border bg-card px-3 py-3 text-sm font-medium">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> Privacy settings
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </button>
              <Link
                to="/"
                className="press flex w-full items-center justify-between rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm font-medium text-destructive"
              >
                <span className="flex items-center gap-2">
                  <LogOut className="h-4 w-4" /> Logout
                </span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
