import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Mail, Smartphone, Sparkles, User } from "lucide-react";
import { toast } from "sonner";

import { AuthLayout } from "@/components/auth/auth-ui";
import { api, ApiError } from "@/lib/api";
import { authSession } from "@/lib/auth-session";
import { isOtpCodeValid, toE164Phone, formatPhoneNumber } from "@/lib/auth-flow";
import { PENDING_OTP_KEY, type PendingOtp } from "@/routes/auth.index";

export const Route = createFileRoute("/auth/verify")({ component: VerifyOtpPage });

const RESEND_SECONDS = 30;

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "The request could not be completed. Please try again.";
  }
  if (error.retryAfterSeconds) {
    return `${error.message} Retry in ${error.retryAfterSeconds} seconds.`;
  }
  return error.message;
}

function VerifyOtpPage() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingOtp | null>(null);
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "resending">("idle");
  const [countdown, setCountdown] = useState(RESEND_SECONDS);
  const [needsProfileCompletion, setNeedsProfileCompletion] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+91");
  const [destination, setDestination] = useState<"CLIENT" | "WORKER">("WORKER");
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(PENDING_OTP_KEY);
    if (!stored) {
      void router.navigate({ to: "/auth" });
      return;
    }
    try {
      const parsed = JSON.parse(stored) as PendingOtp;
      setPending(parsed);
      if (parsed.fullName) setFullName(parsed.fullName);
      if (parsed.mobileNumber) setPhone(parsed.mobileNumber.replace(/^\+91/, ""));
      if (parsed.role) setDestination(parsed.role);
    } catch {
      window.sessionStorage.removeItem(PENDING_OTP_KEY);
      void router.navigate({ to: "/auth" });
    }
  }, [router]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const verify = async () => {
    if (!pending) return;
    const otpLength = pending.otpLength ?? 6;
    if (!isOtpCodeValid(otp, otpLength)) {
      setError(`Enter the ${otpLength}-digit verification code.`);
      return;
    }
    setStatus("loading");
    setError("");

    try {
      let session: any;
      if (pending.type === "email" && pending.email) {
        session = await api.verifyEmailOtp({
          email: pending.email,
          otp,
          challengeId: pending.challengeId,
          fullName: pending.fullName,
          mobileNumber: pending.mobileNumber,
          role: pending.role,
        });
      } else {
        throw new Error("Missing verification details");
      }

      window.sessionStorage.removeItem(PENDING_OTP_KEY);

      // Check if user is missing full name or mobile number (Mandatory per Rev5 §21)
      const user = session.user;
      const hasName = Boolean(user.full_name && user.full_name.trim().length >= 2);
      const hasPhone = Boolean((user.mobile_number || user.phone) && (user.mobile_number || user.phone).trim().length >= 8);

      if (!hasName || !hasPhone) {
        setDestination(user.role === "CLIENT" ? "CLIENT" : "WORKER");
        if (user.full_name) setFullName(user.full_name);
        if (user.mobile_number || user.phone) setPhone((user.mobile_number || user.phone).replace(/^\+91/, ""));
        setNeedsProfileCompletion(true);
        setStatus("idle");
        return;
      }

      toast.success("Identity verified. Session activated.");
      await router.navigate({ to: user.role === "CLIENT" ? "/client" : "/worker" });
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      toast.error(message);
      setStatus("idle");
    }
  };

  const resend = async () => {
    if (!pending || status !== "idle") return;
    setStatus("resending");
    setError("");
    try {
      let result: any;
      if (pending.type === "email" && pending.email) {
        result = await api.requestEmailOtp(pending.email, pending.role);
      }
      if (result) {
        setPending((current) => {
          if (!current) return current;
          const next = {
            ...current,
            otpLength: result.otp_length,
            challengeId: result.challenge_id,
            developmentOtp: result.development_otp,
          };
          window.sessionStorage.setItem(PENDING_OTP_KEY, JSON.stringify(next));
          return next;
        });
      }
      setCountdown(RESEND_SECONDS);
      setOtp("");
      setError("");      toast.success("A fresh verification code was sent.");
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      toast.error(message);
    } finally {
      setStatus("idle");
    }
  };

  const saveMandatoryProfile = async () => {
    const name = fullName.trim();
    if (name.length < 2) {
      setError("Full name is mandatory (at least 2 characters).");
      return;
    }

    const fullPhone = toE164Phone(countryCode, phone);
    if (!fullPhone) {
      setError("A valid mobile number is mandatory to proceed.");
      return;
    }

    setStatus("loading");
    setError("");
    try {
      try {
        await api.updateProfile({ fullName: name, mobileNumber: fullPhone });
      } catch {
        // Best effort profile update
      }
      const current = authSession.get();
      if (current) {
        authSession.set({
          ...current,
          user: { ...current.user, full_name: name, mobile_number: fullPhone },
        });
      }
      toast.success(`Welcome, ${name}!`);
      await router.navigate({ to: destination === "CLIENT" ? "/client" : "/worker" });
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      toast.error(message);
      setStatus("idle");
    }
  };

  if (needsProfileCompletion) {
    return (
      <AuthLayout
        eyebrow="Mandatory Profile Details"
        heading="Complete Your Profile"
        sub="Full Name and Mobile Number are required for identity verification across NetworkPeers."
      >
        <div className="w-full rounded-2xl border border-border bg-muted/70 p-6 shadow-lift">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card/80 p-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary-soft text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                New {destination === "CLIENT" ? "client" : "worker"} account
              </p>
              <p className="text-sm text-muted-foreground">Complete mandatory identity fields to activate account.</p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Full Name</label>
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-500">
                  Mandatory
                </span>
              </div>
              <div className="relative mt-1.5">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={fullName}
                  onChange={(event) => {
                    setFullName(event.target.value);
                    setError("");
                  }}
                  placeholder="e.g. Rohan Sharma"
                  autoFocus
                  className="h-12 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-base outline-none focus:ring-2 focus:ring-ring/40"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Mobile Number</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-500">
                    Mandatory
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    (unverified)
                  </span>
                </div>
              </div>
              <div className="mt-1.5 flex gap-2">
                <select
                  value={countryCode}
                  onChange={(event) => setCountryCode(event.target.value)}
                  className="h-12 w-24 rounded-xl border border-border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring/40"
                >
                  <option value="+91">+91</option>
                  <option value="+1">+1</option>
                  <option value="+44">+44</option>
                </select>
                <div className="relative flex-1">
                  <Smartphone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.target.value.replace(/[^\d+]/g, ""));
                      setError("");
                    }}
                    placeholder="98765 43210"
                    className="h-12 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-base outline-none focus:ring-2 focus:ring-ring/40"
                  />
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Formats to: {formatPhoneNumber(phone, countryCode)}
              </p>
            </div>

            {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
          </div>

          <button
            type="button"
            onClick={() => void saveMandatoryProfile()}
            disabled={status === "loading"}
            className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-80"
          >
            {status === "loading" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving profile...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Save & Enter {destination === "CLIENT" ? "Client" : "Worker"} Portal
              </>
            )}
          </button>
        </div>
      </AuthLayout>
    );
  }

  const isEmail = pending?.type === "email";
  const displayRecipient = pending?.email || pending?.displayTarget || pending?.displayPhone || "your destination";

  return (
    <AuthLayout
      eyebrow="Secure sign-in"
      heading="Enter Verification Code"
      sub={isEmail ? "Enter the one-time verification code sent to your email." : "Enter the one-time code sent to your phone."}
    >
      <div className="w-full rounded-3xl border border-border bg-card/80 p-6 shadow-lift">
        <Link
          to="/auth"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border bg-muted/70 p-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary-soft text-primary">
            {isEmail ? <Mail className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Code sent to</p>
            <p className="text-sm font-medium text-muted-foreground break-all">
              {displayRecipient}
            </p>
          </div>
        </div>
        {/*
          Shown only when the API echoed the code back, which it does when it
          is not running with NODE_ENV=production. The site renders whatever
          it is given, so this disappears by itself the moment the API is set
          to production -- exactly how the Android app handles it.
        */}
        {pending?.developmentOtp && (
          <div className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              Development code
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              The API is not running in production mode, so it returned the code
              instead of relying on the email arriving.
            </p>
            <button
              type="button"
              onClick={() => {
                setOtp(pending.developmentOtp ?? "");
                setError("");
              }}
              className="press mt-3 rounded-lg border border-amber-500/40 bg-background px-3 py-2 font-mono text-lg font-bold tracking-[0.3em]"
            >
              {pending.developmentOtp}
            </button>
            <p className="mt-2 text-xs text-muted-foreground">Tap the code to fill it in.</p>
          </div>
        )}

        <div className="mt-6">
          <label className="text-sm font-medium text-foreground">
            Enter {pending?.otpLength ?? 6}-digit code
          </label>
          <div className="mt-3 flex gap-2">
            {Array.from({ length: pending?.otpLength ?? 6 }).map((_, index) => (
              <input
                key={index}
                ref={(element) => {
                  inputRefs.current[index] = element;
                }}
                inputMode="numeric"
                autoFocus={index === 0}
                value={otp[index] ?? ""}
                onChange={(event) => {
                  const next = event.target.value.replace(/\D/g, "").slice(-1);
                  const values = otp.padEnd(6, " ").split("");
                  values[index] = next;
                  const updated = values.join("").replace(/\s+$/g, "");
                  setOtp(updated);
                  setError("");
                  if (next && index < 5) inputRefs.current[index + 1]?.focus();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Backspace" && !otp[index] && index > 0)
                    inputRefs.current[index - 1]?.focus();
                }}
                className="h-12 w-full rounded-xl border border-border bg-background text-center text-lg font-semibold outline-none focus:ring-2 focus:ring-ring/40"
              />
            ))}
          </div>
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => void verify()}
          disabled={status === "loading"}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-80"
        >
          {status === "loading" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verifying...
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Verify OTP & Sign In
            </>
          )}
        </button>
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <Link to="/auth" className="font-medium text-primary hover:underline">
            {isEmail ? "Edit email address" : "Edit phone number"}
          </Link>
          <button
            type="button"
            onClick={() => void resend()}
            disabled={countdown > 0 || status !== "idle"}
            className="font-medium text-primary hover:underline disabled:text-muted-foreground"
          >
            {status === "resending"
              ? "Sending code..."
              : countdown > 0
                ? `Resend code in ${countdown}s`
                : "Resend code"}
          </button>
        </div>
      </div>
    </AuthLayout>
  );
}
