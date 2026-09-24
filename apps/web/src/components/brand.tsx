import { cn } from "@/lib/utils";

export function Brand({
  className,
  logoClassName,
  logo = "N",
  title,
  sub,
}: {
  className?: string;
  logoClassName?: string;
  logo?: string;
  title: string;
  sub?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span
        className={cn(
          "gradient-brand shadow-glow-brand grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-bold text-primary-foreground ring-1 ring-white/20",
          logoClassName,
        )}
      >
        {logo}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-2xl font-extrabold tracking-tight">
          {title === "NetworkPeers" ? (
            <>
              <span className="text-foreground">Network</span>
              <span className="text-gradient-brand">Peers</span>
            </>
          ) : (
            title
          )}
        </span>
        {sub && <span className="block truncate text-sm text-muted-foreground">{sub}</span>}
      </span>
    </span>
  );
}
