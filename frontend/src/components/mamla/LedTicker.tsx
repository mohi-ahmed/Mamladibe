import { Link } from "@tanstack/react-router";
import { categoryById, timeAgo, type Incident } from "@/lib/incidents";

export function LedTicker({ incidents }: { incidents: Incident[] }) {
  const items = incidents.slice(0, 8);
  const loop = [...items, ...items];
  return (
    <div className="led-board relative flex items-stretch overflow-hidden border-y border-border">
      <div className="z-10 flex shrink-0 items-center gap-2 bg-signal-red px-4 font-mono text-xs font-bold uppercase tracking-[0.2em] text-destructive-foreground">
        <span className="h-2 w-2 animate-blink rounded-full bg-destructive-foreground" /> Live
      </div>
      <div className="relative flex-1 overflow-hidden py-3">
        <div className="flex w-max animate-ticker gap-10 whitespace-nowrap hover:[animation-play-state:paused]">
          {loop.map((i, idx) => (
            <Link
              key={`${i.id}-${idx}`}
              to="/incidents/$id"
              params={{ id: i.id }}
              className="led-text flex items-center gap-3 text-sm tracking-wide hover:underline"
            >
              <span className="text-paint/50">◆</span>
              <span className="uppercase">{categoryById(i.category).en}</span>
              <span className="font-display text-base">{i.title}</span>
              <span className="opacity-60">
                · {i.areaName.split(",")[0]} · {timeAgo(i.createdAt)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
