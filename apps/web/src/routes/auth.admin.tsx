import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { KeyRound, Lock, Mail, ShieldAlert } from "lucide-react";

import { AuthLayout, Field, SubmitButton } from "@/components/auth/auth-ui";

export const Route = createFileRoute("/auth/admin")({
  head: () => ({
    meta: [
      { title: "Admin sign in — NetworkPeers Console" },
      {
        name: "description",
        content:
          "Restricted NetworkPeers operations console access with hardware-key two-factor authentication.",
      },
      { property: "og:title", content: "Admin sign in — NetworkPeers Console" },
      {
        property: "og:description",
        content: "Restricted access to the NetworkPeers operations console.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminAuth,
});

function AdminAuth() {
  const router = useRouter();

  return (
    <AuthLayout
      tone="admin"
      eyebrow="Restricted console"
      heading="Operations access is separate — and audited."
      sub="Every admin session is logged with device fingerprint, network and app version for the fraud trail."
    >
      <span className="inline-flex items-center gap-2 rounded-full bg-destructive/15 px-3 py-1 text-base font-semibold text-destructive">
        <ShieldAlert className="h-3.5 w-3.5" /> Admin only
      </span>
      <h1 className="mt-4 text-4xl font-semibold">NetworkPeers Console</h1>
      <p className="mt-1 text-lg text-muted-foreground">
        Use your organisation credentials and hardware key.
      </p>

      <div className="mt-6 space-y-4">
        <Field label="Work email" type="email" placeholder="ops@networkpeers.com" icon={Mail} />
        <Field label="Password" type="password" placeholder="••••••••" icon={Lock} />
        <Field label="Security key code" placeholder="6-digit token" icon={KeyRound} />
        <SubmitButton label="Access console" onClick={() => router.navigate({ to: "/admin" })} />
        <Link
          to="/auth"
          className="block pt-2 text-center text-base text-muted-foreground hover:text-foreground"
        >
          Not an admin? Client & worker sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
