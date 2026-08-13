import { useEffect, useState } from "react";

import type { Job } from "@/lib/mock-data";

const STORAGE_KEY = "networkpeers-demo-client-jobs";

export function getStoredDemoJobs(): Job[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Job[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveDemoJobs(jobs: Job[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

export function getDemoJobById(id: string): Job | undefined {
  return getStoredDemoJobs().find((job) => job.id === id);
}

export function useDemoJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    setJobs(getStoredDemoJobs());
  }, []);

  const updateJobs = (updater: (prev: Job[]) => Job[]) => {
    setJobs((prev) => {
      const next = updater(prev);
      saveDemoJobs(next);
      return next;
    });
  };

  return {
    jobs,
    setJobs: updateJobs,
    addJob: (job: Job) => updateJobs((prev) => [job, ...prev]),
    removeJob: (id: string) => updateJobs((prev) => prev.filter((item) => item.id !== id)),
  };
}
