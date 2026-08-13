import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CameraIcon,
  Fingerprint,
  Gauge,
  LayoutDashboard,
  MapPin,
  ShieldCheck,
  Smartphone,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { AnonymousBadge, Chip, MapCanvas } from "@/components/marketplace/primitives";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NetworkPeers — Anonymous gig marketplace for verified field work" },
      {
        name: "description",
        content:
          "Post field jobs, get GPS- and timestamp-verified evidence captured in-app, and pay through escrow. Clients and workers stay anonymous until acceptance.",
      },
      {
        property: "og:title",
        content: "NetworkPeers — Anonymous gig marketplace for verified field work",
      },
      {
        property: "og:description",
        content: "Verified clients, verified workers, in-app evidence capture and escrow payments.",
      },
    ],
  }),
  component: Landing,
});

const portals = [
  {
    title: "Client portal",
    body: "Post jobs with media-required checklists, track workers live and approve evidence.",
    to: "/client",
    icon: LayoutDashboard,
  },
  {
    title: "Worker app",
    body: "Find nearby jobs, capture photo, video and audio proof in-app, and get paid fast.",
    to: "/worker",
    icon: Smartphone,
  },
  {
    title: "Admin console",
    body: "Operations, payouts, disputes, analytics and a fraud detection dashboard.",
    to: "/admin",
    icon: Gauge,
  },
];

const features = [
  {
    icon: ShieldCheck,
    title: "Anonymous by default",
    body: "No names, photos, phone numbers or email until a job is accepted.",
  },
  {
    icon: CameraIcon,
    title: "In-app capture only",
    body: "No gallery uploads. Every photo, video and audio file is recorded live.",
  },
  {
    icon: MapPin,
    title: "GPS + timestamp proof",
    body: "Every evidence item carries coordinates, accuracy and capture time.",
  },
  {
    icon: Fingerprint,
    title: "Fraud scoring",
    body: "Duplicate hashes, device fingerprints and network signals flagged automatically.",
  },
  {
    icon: Wallet,
    title: "Escrow payments",
    body: "Funds held on posting, released the moment evidence is approved.",
  },
  {
    icon: Gauge,
    title: "Live operations",
    body: "Timelines, status chips and analytics across every active job.",
  },
];

/* Reveal-on-scroll wrapper (IntersectionObserver, SSR-safe). */
function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(visible && "animate-fade-slide", className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/* 3D tilt-on-hover card driven by CSS variables (pointer devices only). */
function TiltCard({
  children,
  className,
  floatClass = "tilt-float",
}: {
  children: ReactNode;
  className?: string;
  floatClass?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const onMove = useCallback((event: { clientX: number; clientY: number }) => {
    const element = ref.current;
    if (!element || (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches)) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    element.style.transform = `perspective(1100px) rotateX(${(-py * 6).toFixed(2)}deg) rotateY(${(px * 8).toFixed(2)}deg)`;
  }, []);

  const onLeave = useCallback(() => {
    const element = ref.current;
    if (element) element.style.transform = "perspective(1100px) rotateX(0deg) rotateY(0deg)";
  }, []);

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={cn("tilt-card", className)}
    >
      <div className={cn(floatClass, "h-full")}>{children}</div>
    </div>
  );
}

function Landing() {
  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      <header className="glass sticky top-0 z-40 border-b">
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex min-w-0 items-center gap-2.5">
            <span className="text-gradient-brand animate-gradient-pan truncate text-2xl font-bold tracking-tight sm:text-3xl">
              NetworkPeers
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              to="/auth"
              className="press hidden rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              className="press gradient-brand animate-gradient-pan shadow-glow inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Get started <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="surface-grid absolute inset-0 opacity-40" aria-hidden />
        <div className="absolute inset-0 bg-[var(--gradient-surface)]" aria-hidden />
        {/* Animated gradient blobs for a living, 3D-feeling backdrop */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div
            className="animate-blob absolute -top-28 left-[6%] h-80 w-80 rounded-full opacity-30 blur-3xl"
            style={{ background: "oklch(0.63 0.19 262.9 / 0.6)" }}
          />
          <div
            className="animate-blob-slow absolute top-1/3 right-[2%] h-96 w-96 rounded-full opacity-25 blur-3xl"
            style={{ background: "oklch(0.72 0.116 182.5 / 0.5)" }}
          />
          <div
            className="animate-blob absolute -bottom-16 left-[38%] h-72 w-72 rounded-full opacity-20 blur-3xl"
            style={{ background: "oklch(0.7 0.17 149.6 / 0.45)" }}
          />
        </div>

        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:py-24">
          <div className="animate-rise">
            <Chip tone="primary">
              <ShieldCheck className="h-3.5 w-3.5" /> Privacy-first marketplace
            </Chip>
            <h1 className="mt-5 text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
              On-demand field work with{" "}
              <span className="text-gradient-brand animate-gradient-pan">
                proof you can trust
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              NetworkPeers pairs verified clients with verified workers — anonymously. Every task is
              backed by in-app photo, video and audio capture, stamped with GPS and time.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/client"
                className="press gradient-brand animate-gradient-pan shadow-glow inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-primary-foreground"
              >
                Open client portal <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/worker"
                className="press inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold"
              >
                Preview worker app
              </Link>
            </div>
            <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4">
              {[
                ["12.4k", "Jobs completed"],
                ["4.87", "Avg. rating"],
                ["99.2%", "Evidence verified"],
              ].map(([value, label], index) => (
                <Reveal key={label} delay={index * 120}>
                  <div className="hover-lift rounded-2xl border border-border bg-card p-4 shadow-soft">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 text-2xl font-semibold">{value}</dd>
                  </div>
                </Reveal>
              ))}
            </dl>
          </div>

          <Reveal delay={180}>
            <TiltCard className="animate-float relative">
              <div className="rounded-3xl border border-border bg-card p-5 shadow-lift">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-muted-foreground">
                      GF-1042 · Field Inspection
                    </p>
                    <p className="truncate text-base font-semibold">Storefront compliance audit</p>
                  </div>
                  <AnonymousBadge role="Worker" />
                </div>
                <MapCanvas className="mt-4 h-52" pins={3} label="Worker 1.2 km away" />
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    ["Payment", "₹78"],
                    ["Est. time", "45 min"],
                    ["Evidence", "6 items"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-muted/60 p-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-0.5 text-sm font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="glass animate-float absolute -bottom-6 -left-4 hidden rounded-2xl px-4 py-3 shadow-lift sm:block">
                <p className="text-xs text-muted-foreground">GPS verified</p>
                <p className="text-sm font-semibold">37.7749, -122.4194 · ±4 m</p>
              </div>
            </TiltCard>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <Reveal>
          <h2 className="text-2xl font-semibold sm:text-3xl">Three surfaces, one platform</h2>
        </Reveal>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {portals.map((portal, index) => (
            <Reveal key={portal.to} delay={index * 130}>
              <Link
                to={portal.to}
                className="hover-lift group block rounded-2xl border border-border bg-card p-6 shadow-soft"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-soft text-primary transition-transform duration-300 group-hover:scale-110">
                  <portal.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold transition-colors group-hover:text-primary">
                  {portal.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">{portal.body}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  Explore{" "}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-card/50">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <Reveal>
            <h2 className="text-2xl font-semibold sm:text-3xl">Built for verifiable work</h2>
          </Reveal>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <Reveal key={feature.title} delay={(index % 3) * 120}>
                <div className="hover-lift group rounded-2xl border border-border bg-card p-5 shadow-soft">
                  <feature.icon className="h-5 w-5 text-primary transition-transform duration-300 group-hover:scale-110" />
                  <h3 className="mt-3 text-base font-semibold transition-colors group-hover:text-primary">
                    {feature.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{feature.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <footer className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-10 text-sm text-muted-foreground sm:px-6">
        <p>© 2026 NetworkPeers. Anonymous until accepted.</p>
        <Link to="/auth/admin" className="hover:text-foreground">
          Admin access
        </Link>
      </footer>
    </div>
  );
}
