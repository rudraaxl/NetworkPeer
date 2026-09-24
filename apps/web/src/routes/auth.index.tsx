import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { KeyRound, Mail, Smartphone, User } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { AuthLayout } from "@/components/auth/auth-ui";
import { ApiError, api } from "@/lib/api";
import { authSession } from "@/lib/auth-session";
import { formatPhoneNumber, toE164Phone } from "@/lib/auth-flow";

export const Route = createFileRoute("/auth/")({
  head: () => ({
    meta: [
      { title: "Sign in - NetworkPeers" },
      {
        name: "description",
        content: "Sign in securely with passwordless Email-OTP to access the NetworkPeers marketplace.",
      },
    ],
  }),
  component: AuthPage,
});

type Mode = "login" | "register";
type Role = "CLIENT";
type AuthMethod = "email" | "phone";

export type PendingOtp = {
  type: AuthMethod;
  email?: string;
  phoneNumber?: string;
  displayPhone?: string;
  displayTarget?: string;
  role: Role;
  otpLength: number;
  challengeId?: string;
  fullName?: string;
  mobileNumber?: string;
};

export const PENDING_OTP_KEY = "networkpeer-pending-otp";

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  // Every account created here is a client. The API binds the role to the
  // challenge when the code is issued and rejects it on verify, so it is
  // sent with the request and never chosen.
  const role: Role = "CLIENT";
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError("");

    const trimmedEmail = email.trim().toLowerCase();
    if (!isValidEmail(trimmedEmail)) {
      setError("Please enter a valid work email address (e.g. you@company.com).");
      return;
    }

    let parsedMobile: string | null = null;
    const trimmedName = fullName.trim();

    if (mode === "register") {
      if (trimmedName.length < 2) {
        setError("Full Name is mandatory (minimum 2 characters).");
        return;
      }

      parsedMobile = toE164Phone(countryCode, phone);
      if (!parsedMobile) {
        setError("A valid 10-digit Mobile Number is mandatory for account registration.");
        return;
      }
    } else if (phone.trim()) {
      parsedMobile = toE164Phone(countryCode, phone);
    }

    setSubmitting(true);
    try {
      const result = await api.requestEmailOtp(trimmedEmail, role);
      const pending: PendingOtp = {
        type: "email",
        email: trimmedEmail,
        displayTarget: trimmedEmail,
        role,
        challengeId: result.challenge_id ?? result.challengeId,
        otpLength: result.otp_length ?? result.otpLength ?? 6,
        fullName: trimmedName || undefined,
        mobileNumber: parsedMobile || undefined,
      };
      window.sessionStorage.setItem(PENDING_OTP_KEY, JSON.stringify(pending));
      toast.success("Verification code sent to your email");
      await router.navigate({ to: "/auth/verify" });
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Could not send verification code";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      eyebrow="Anonymous marketplace"
      heading="Work gets done. Identities stay private."
      sub="Sign in securely with passwordless Email-OTP. Your session is held securely in this browser."
    >
      <h1 className="text-4xl font-semibold">
        {mode === "register" ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-1 text-lg text-muted-foreground">
        {mode === "register"
          ? "Enter your work email, full name, and mobile number to register."
          : "Enter your work email address to receive a secure sign-in code."}
      </p>

      {/* Login vs Register Switcher */}
      <div className="mt-6 grid w-full max-w-[280px] grid-cols-2 gap-1 rounded-xl border border-border bg-muted/80 p-1">
        {(["login", "register"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setMode(tab);
              setError("");
            }}
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

      {/* The role picker lived here. This site is for clients: workers
          find and do jobs in the Android app, so nothing is asked. */}

      <div className="mt-6 space-y-4">
        {/* Full Name field (Mandatory on registration per Rev5 §21) */}
        {mode === "register" && (
          <label className="block">
            <div className="flex items-center justify-between">
              <span className="mb-1.5 block text-base font-medium">Full Name</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-500">
                Mandatory
              </span>
            </div>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                autoComplete="name"
                placeholder="e.g. Aditya Sharma"
                value={fullName}
                onChange={(event) => {
                  setFullName(event.target.value);
                  setError("");
                }}
                className="h-12 w-full rounded-xl border border-border bg-card pl-10 pr-3 text-lg outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
          </label>
        )}

        {/* Email Field (Primary for Login & Register) */}
        <label className="block">
          <div className="flex items-center justify-between">
            <span className="mb-1.5 block text-base font-medium">Work Email Address</span>
            {mode === "register" && (
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-500">
                Mandatory
              </span>
            )}
          </div>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError("");
              }}
              className="h-12 w-full rounded-xl border border-border bg-card pl-10 pr-3 text-lg outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            A 6-digit passwordless verification code will be dispatched to this email.
          </p>
        </label>

        {/* Mobile Number Field (Mandatory on registration per Rev5 §21) */}
        {mode === "register" && (
          <label className="block">
            <div className="flex items-center justify-between">
              <span className="mb-1.5 block text-base font-medium">Mobile Number</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-500">
                  Mandatory
                </span>
                <span className="text-xs text-muted-foreground">(unverified)</span>
              </div>
            </div>
            <div className="flex gap-2">
              <select
                aria-label="Country code"
                value={countryCode}
                onChange={(event) => setCountryCode(event.target.value)}
                className="h-12 rounded-xl border border-border bg-card px-3 text-lg outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value="+91">+91 (India)</option>
                <option value="+1">+1 (US/Canada)</option>
                <option value="+44">+44 (UK)</option>
                <option value="+65">+65 (Singapore)</option>
                <option value="+971">+971 (UAE)</option>
              </select>
              <div className="relative flex-1">
                <Smartphone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="tel"
                  autoComplete="tel"
                  placeholder="9876543210"
                  value={phone}
                  onChange={(event) => {
                    setPhone(event.target.value);
                    setError("");
                  }}
                  className="h-12 w-full rounded-xl border border-border bg-card pl-10 pr-3 text-lg outline-none focus:ring-2 focus:ring-ring/40"
                />
              </div>
            </div>
          </label>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={submitting}
          onClick={() => void submit()}
          className="press gradient-brand shadow-glow inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-lg font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting
            ? "Sending verification code..."
            : mode === "register"
              ? "Create Account & Send Code"
              : "Send Verification Code"}
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
