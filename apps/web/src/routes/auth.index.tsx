import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Briefcase, HardHat, KeyRound, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AuthLayout } from "@/components/auth/auth-ui";
import { ApiError, api } from "@/lib/api";
import { formatPhoneNumber, toE164Phone } from "@/lib/auth-flow";

export const Route = createFileRoute("/auth/")({
  head: () => ({
    meta: [
      { title: "Sign in - NetworkPeers" },
      {
        name: "description",
        content: "Sign in securely with a one-time code to access the NetworkPeers marketplace.",
      },
    ],
  }),
  component: AuthPage,
});

type Mode = "login" | "register";
type Role = "CLIENT" | "WORKER";

export type PendingOtp = {
  phoneNumber: string;
  displayPhone: string;
  role: Role;
  otpLength: number;
  developmentOtp?: string;
};

export const PENDING_OTP_KEY = "networkpeer-pending-otp";

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "We could not send a verification code. Please try again.";
  }
  if (error.retryAfterSeconds) {
    return `${error.message} Retry in ${error.retryAfterSeconds} seconds.`;
  }
  return error.message;
}

function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [role, setRole] = useState<Role>("CLIENT");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+1");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const phoneNumber = toE164Phone(countryCode, phone);
    if (!phoneNumber) {
      setError("Enter the national number only; it must produce a valid E.164 phone number.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await api.requestOtp(phoneNumber);
      const pending: PendingOtp = {
        phoneNumber,
        displayPhone: formatPhoneNumber(phone, countryCode),
        role,
        otpLength: result.otpLength,
        developmentOtp: result.otp,
      };
      window.sessionStorage.setItem(PENDING_OTP_KEY, JSON.stringify(pending));
      toast.success(result.otp ? `Development OTP: ${result.otp}` : "Verification code sent");
      await router.navigate({ to: "/auth/verify" });
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="Anonymous marketplace"
      heading="Work gets done. Identities stay private."
      sub="Use a one-time code to sign in. The browser stores the session only for this tab."
    >
      <h1 className="text-4xl font-semibold">
        {mode === "register" ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-1 text-lg text-muted-foreground">
        Choose your workspace, then verify your number.
      </p>

      <div className="mt-6 grid w-full max-w-[280px] grid-cols-2 gap-1 rounded-xl border border-border bg-muted/80 p-1">
        {(["login", "register"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setMode(tab)}
            className={cn(
              "h-11 rounded-lg px-3 text-base font-medium transition-all",
              mode === tab
                ? "bg-card shadow-soft text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab === "login" ? "Login" : "Register"}
          </button>
        ))}
      </div>

      <div className="mt-6">
        <p className="mb-2 text-base font-medium">I am a</p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { id: "CLIENT" as const, label: "Client", body: "I post jobs", icon: Briefcase },
            { id: "WORKER" as const, label: "Worker", body: "I complete jobs", icon: HardHat },
          ].map((option) => (
            <button
              key={option.id}
              onClick={() => setRole(option.id)}
              className={cn(
                "press rounded-2xl border p-3 text-left transition-all",
                role === option.id
                  ? "border-primary bg-primary-soft shadow-glow"
                  : "border-border bg-card hover:border-primary/40",
              )}
            >
              <option.icon
                className={cn(
                  "h-4.5 w-4.5",
                  role === option.id ? "text-primary" : "text-muted-foreground",
                )}
              />
              <p className="mt-2 text-lg font-semibold">{option.label}</p>
              <p className="text-base text-muted-foreground">{option.body}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-base font-medium">Phone number</span>
          <div className="flex gap-2">
            <select
              value={countryCode}
              onChange={(event) => setCountryCode(event.target.value)}
              className="h-12 w-24 rounded-xl border border-border bg-card px-3 text-base outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="+1">+1</option>
              <option value="+44">+44</option>
              <option value="+91">+91</option>
            </select>
            <span className="relative flex-1">
              <Smartphone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={15 - countryCode.length}
                placeholder="555 000 1234"
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/[^\d+]/g, ""))}
                className="h-12 w-full rounded-xl border border-border bg-card pl-10 pr-3 text-lg outline-none focus:ring-2 focus:ring-ring/40"
              />
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter the national number only. {formatPhoneNumber(phone, countryCode)}
          </p>
        </label>
        {role === "WORKER" && mode === "register" ? (
          <p className="rounded-xl bg-warning/10 p-3 text-base text-muted-foreground">
            Worker accounts require platform verification before they can accept work.
          </p>
        ) : null}
        {error ? (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={submitting}
          onClick={() => void submit()}
          className="press gradient-brand shadow-glow inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-lg font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? "Sending code..." : "Continue to OTP"}
        </button>
      </div>

      <div className="pt-4 text-center">
        <Link
          to="/auth/admin"
          className="inline-flex items-center gap-1.5 text-base font-medium text-primary hover:text-primary/80"
        >
          <KeyRound className="h-4 w-4" /> Admin sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
