import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-primary shadow-glow",
        className,
      )}
    >
      <svg viewBox="0 0 40 40" className="h-full w-full">
        <path d="M15 4 H25 L34 40 H6 Z" fill="var(--primary-foreground)" />
        <path
          d="M20 8 V13 M20 18 V24 M20 29 V37"
          stroke="var(--primary)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <circle
          cx="29"
          cy="11"
          r="4.2"
          fill="var(--signal-red)"
          stroke="var(--primary-foreground)"
          strokeWidth="1.6"
        />
      </svg>
    </span>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="group flex items-center gap-3" aria-label="Mamladibe হোম">
      <LogoMark className="transition-transform duration-300 group-hover:-rotate-6" />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-xl font-extrabold tracking-tight">
            mamladibe<span className="text-primary">.</span>
          </span>
          <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            the road has a voice
          </span>
        </span>
      )}
    </Link>
  );
}
