import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Smartphone, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { AuthLayout } from "@/components/auth/auth-ui";
import { api, ApiError } from "@/lib/api";
import { authSession } from "@/lib/auth-session";
import { isOtpCodeValid } from "@/lib/auth-flow";
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
  const [needsName, setNeedsName] = useState(false);
  const [fullName, setFullName] = useState("");
  const [destination, setDestination] = useState<"CLIENT" | "WORKER">("WORKER");
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(PENDING_OTP_KEY);
    if (!stored) {
      void router.navigate({ to: "/auth" });
      return;
    }
    try {
      setPending(JSON.parse(stored) as PendingOtp);
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
      const session = await api.verifyOtp(pending.phoneNumber, otp, pending.role);
      window.sessionStorage.removeItem(PENDING_OTP_KEY);
      try {
        await api.grantConsent("LOCATION");
        await api.grantConsent("EVIDENCE");
      } catch {
        // Consent recording is best-effort after successful authentication.
      }
      if (session.isNewAccount) {
        setDestination(session.user.role === "CLIENT" ? "CLIENT" : "WORKER");
        setNeedsName(true);
        setStatus("idle");
        return;
      }
      toast.success("Phone verified. Your session is ready.");
      await router.navigate({ to: session.user.role === "CLIENT" ? "/client" : "/worker" });
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
      const result = await api.requestOtp(pending.phoneNumber);
      setPending((current) => {
        if (!current) return current;
        const next = { ...current, otpLength: result.otpLength, developmentOtp: result.otp };
        window.sessionStorage.setItem(PENDING_OTP_KEY, JSON.stringify(next));
        return next;
      });
      setCountdown(RESEND_SECONDS);
      setOtp("");
      setError("");
      toast.success("A fresh verification code was sent.");
    } catch (requestError) {
      const message = errorMessage(requestError);
      setError(message);
      toast.error(message);
    } finally {
      setStatus("idle");
    }
  };

  const saveName = async () => {
    const name = fullName.trim();
    if (name.length < 2) {
      setError("Enter your full name (at least 2 characters).");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const result = await api.updateProfileName(name);
      const current = authSession.get();
      if (current) {
        authSession.set({ ...current, user: { ...current.user, full_name: result.full_name } });
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

  if (needsName) {
    return (
      <AuthLayout
        eyebrow="Almost there"
        heading="What should we call you?"
        sub="Your name helps clients and workers recognize you on the platform."
      >
        <div className="w-full rounded-2xl border border-border bg-muted/70 p-6 shadow-lift">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/70 p-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary-soft text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                New {destination === "CLIENT" ? "client" : "worker"} account
              </p>
              <p className="text-sm text-muted-foreground">One quick step before you dive in.</p>
            </div>
          </div>
          <div className="mt-6">
            <label className="text-sm font-medium text-foreground">Full name</label>
            <input
              value={fullName}
              onChange={(event) => {
                setFullName(event.target.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && status !== "loading") void saveName();
              }}
              placeholder="e.g. Rohan Sharma"
              autoFocus
              className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-4 text-base outline-none focus:ring-2 focus:ring-ring/40"
            />
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => void saveName()}
            disabled={status === "loading"}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-80"
          >
            {status === "loading" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Save and continue
              </>
            )}
          </button>
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() =>
                void router.navigate({ to: destination === "CLIENT" ? "/client" : "/worker" })
              }
              disabled={status === "loading"}
              className="font-medium text-primary hover:underline disabled:text-muted-foreground"
            >
              Skip for now
            </button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Secure sign-in"
      heading="Verify your number"
      sub="Enter the one-time code sent to your phone."
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
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Code sent to</p>
            <p className="text-sm text-muted-foreground">
              {pending?.displayPhone ?? "your phone number"}
            </p>
          </div>
        </div>
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
        {pending?.developmentOtp ? (
          <p className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            Development OTP:{" "}
            <span className="font-semibold tracking-widest">{pending.developmentOtp}</span>
          </p>
        ) : null}
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
              <CheckCircle2 className="mr-2 h-4 w-4" /> Verify OTP
            </>
          )}
        </button>
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <Link to="/auth" className="font-medium text-primary hover:underline">
            Edit phone number
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
