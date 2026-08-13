import { Link } from "@tanstack/react-router";
import { useState, type ChangeEvent, type ElementType, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { Chip, MapCanvas } from "@/components/marketplace/primitives";

export function AuthLayout({
  children,
  eyebrow,
  heading,
  sub,
  tone = "brand",
}: {
  children: ReactNode;
  eyebrow: string;
  heading: string;
  sub: string;
  tone?: "brand" | "admin";
}) {
  return (
    <div className="auth-portal-root grid min-h-screen lg:grid-cols-[1fr_1.05fr] text-base">
      <div className="relative hidden overflow-hidden border-r border-border bg-card lg:block">
        <div className="surface-grid absolute inset-0 opacity-50" aria-hidden />
        <div className="absolute inset-0 bg-[var(--gradient-surface)]" aria-hidden />
        <div className="relative flex h-full flex-col justify-between p-10">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="gradient-brand grid h-10 w-10 place-items-center rounded-xl text-lg font-bold text-primary-foreground">
              N
            </span>
            <span className="text-xl font-semibold">NetworkPeers</span>
          </Link>

          <div className="animate-rise max-w-md">
            <Chip tone={tone === "admin" ? "danger" : "primary"}>
              <ShieldCheck className="h-3.5 w-3.5" /> {eyebrow}
            </Chip>
            <h2 className="mt-5 text-5xl font-bold leading-tight">{heading}</h2>
            <p className="mt-4 text-xl text-muted-foreground">{sub}</p>

            <div className="mt-8 rounded-2xl border border-border bg-card p-4 shadow-lift">
              <MapCanvas className="h-40" pins={3} label="Live jobs nearby" />
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                {[
                  ["No names", "shared"],
                  ["No photos", "exposed"],
                  ["No contact", "until accepted"],
                ].map(([a, b]) => (
                  <div key={a} className="rounded-xl bg-muted/60 px-2 py-3">
                    <p className="text-base font-semibold">{a}</p>
                    <p className="text-sm text-muted-foreground">{b}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-base text-muted-foreground">
            Communication happens only through the platform until a job is accepted.
          </p>
        </div>
      </div>

      <div className="relative flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 sm:px-8">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-lg text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-12 sm:px-8">
          <div className="animate-rise w-full max-w-md">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  type = "text",
  placeholder,
  icon: Icon,
  value,
  onChange,
  autoComplete,
  required = false,
}: {
  label: string;
  type?: string;
  placeholder: string;
  icon: ElementType;
  value?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-base font-medium">{label}</span>
      <span className="relative block">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          required={required}
          className="h-12 w-full rounded-xl border border-border bg-card pl-10 pr-3 text-lg outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
        />
      </span>
    </label>
  );
}

export function SubmitButton({ label, onClick }: { label: string; onClick?: () => void }) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  return (
    <button
      type="button"
      disabled={state !== "idle"}
      onClick={() => {
        setState("loading");
        onClick?.();
        setTimeout(() => {
          setState("done");
          setTimeout(() => setState("idle"), 1600);
        }, 900);
      }}
      className="press gradient-brand shadow-glow inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-lg font-semibold text-primary-foreground disabled:opacity-90"
    >
      {state === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
      {state === "done" && <CheckCircle2 className="h-4 w-4" />}
      {state === "done" ? "Success" : label}
      {state === "idle" && <ArrowRight className="h-4 w-4" />}
    </button>
  );
}
