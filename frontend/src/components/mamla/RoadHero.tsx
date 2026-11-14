import { Link } from "@tanstack/react-router";
import { ArrowRight, EyeOff, Map, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bn, categoryById, timeAgo, type Incident } from "@/lib/incidents";
import { RoadSign, catStyle } from "./RoadSign";

const PIN_SPOTS = [
  { top: "52%", left: "16%", delay: "0s" },
  { top: "68%", left: "56%", delay: "-1.3s" },
  { top: "40%", left: "50%", delay: "-2.6s" },
];

function TrafficLight() {
  return (
    <div className="absolute right-5 top-24 z-10 flex flex-col items-center sm:right-8">
      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-asphalt-deep p-2 shadow-card">
        <span className="h-5 w-5 animate-signal rounded-full bg-signal-red text-signal-red" />
        <span className="h-5 w-5 animate-signal rounded-full bg-signal-amber text-signal-amber [animation-delay:-2s]" />
        <span className="h-5 w-5 animate-signal rounded-full bg-signal-green text-signal-green [animation-delay:-4s]" />
      </div>
      <div className="h-40 w-1.5 bg-gradient-to-b from-muted to-transparent" />
    </div>
  );
}

export function RoadHero({ incidents }: { incidents: Incident[] }) {
  const today = incidents.filter((i) => Date.now() - i.createdAt < 24 * 3600_000).length;
  const pins = incidents.slice(0, 3);

  return (
    <section className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-10 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
      <div className="relative z-10 animate-rise">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-blink rounded-full bg-signal-green" />
          Aware roads · Safer communities
        </div>
        <h1 className="mt-6 text-[2.6rem] font-extrabold leading-[1.08] text-balance sm:text-6xl lg:text-[4.3rem]">
          রাস্তারও একটা{" "}
          <span className="relative inline-block text-primary text-glow">
            কণ্ঠ
            <span className="lane-dash absolute -bottom-1 left-0 right-0 h-1.5 animate-lane-x" />
          </span>{" "}
          আছে।
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          চোখের সামনে দুর্ঘটনা, হয়রানি বা ভাঙা রাস্তা? নাম-পরিচয় ছাড়াই ম্যাপে পিন করে জানান —
          আপনার শহর জানবে, অন্যরা সতর্ক থাকবে।
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild variant="road" size="xl">
            <Link to="/report">
              ঘটনা জানান <ArrowRight />
            </Link>
          </Button>
          <Button asChild variant="asphalt" size="xl">
            <Link to="/map">
              <Map /> লাইভ ম্যাপ দেখুন
            </Link>
          </Button>
        </div>
        <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 border-t border-dashed border-border pt-6">
          {[
            { k: bn(today), v: "আজকের রিপোর্ট" },
            { k: "০", v: "অ্যাকাউন্ট লাগে" },
            { k: "১৫′", v: "সংশোধনের সময়" },
          ].map((s) => (
            <div key={s.v}>
              <dt className="font-display text-3xl font-extrabold text-foreground">{s.k}</dt>
              <dd className="mt-1 text-xs text-muted-foreground">{s.v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* The road window */}
      <div className="relative h-[460px] overflow-hidden rounded-[2rem] border border-border bg-asphalt-deep shadow-card sm:h-[540px]">
        {/* night sky + city glow */}
        <div className="absolute inset-x-0 top-0 h-[30%] bg-gradient-to-b from-asphalt-deep via-asphalt to-primary/20" />
        <div className="absolute inset-x-0 top-[24%] flex h-[8%] items-end justify-center gap-1 opacity-60">
          {[38, 62, 44, 80, 52, 70, 34, 90, 48, 66, 40, 58, 74, 36].map((h, i) => (
            <span key={i} className="w-[6%] rounded-t-sm bg-muted" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="road-scene absolute inset-x-0 bottom-0 top-[30%]">
          <div className="road-plane">
            <div className="road-center animate-lane" />
          </div>
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_100%,transparent,var(--asphalt-deep))]" />

        {/* highway sign */}
        <div className="sign-plate absolute left-1/2 top-5 z-10 w-[78%] -translate-x-1/2 px-5 py-3 sm:w-[64%]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.25em] opacity-80">
                Live · Dhaka
              </div>
              <div className="font-display text-xl font-bold leading-tight">
                আশেপাশের রাস্তার খবর
              </div>
            </div>
            <div className="text-right font-display">
              <div className="text-3xl font-extrabold leading-none">{bn(incidents.length)}</div>
              <div className="text-[11px] opacity-80">রিপোর্ট</div>
            </div>
          </div>
        </div>

        <TrafficLight />

        {pins.map((p, idx) => {
          const spot = PIN_SPOTS[idx] ?? PIN_SPOTS[0]!;
          return (
            <Link
              key={p.id}
              to="/incidents/$id"
              params={{ id: p.id }}
              style={{
                top: spot.top,
                left: spot.left,
                animationDelay: spot.delay,
                ...catStyle(p.category),
              }}
              className="absolute z-10 flex max-w-[210px] animate-bob items-center gap-2.5 rounded-2xl border border-[color:var(--cat)]/50 bg-popover/90 p-2 pr-3 shadow-card backdrop-blur transition-colors hover:border-[color:var(--cat)]"
            >
              <RoadSign category={p.category} size={34} />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[13px] font-semibold">
                  {p.areaName.split(",")[0]}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {categoryById(p.category).bn} · {timeAgo(p.createdAt)}
                </span>
              </span>
            </Link>
          );
        })}

        <div className="absolute inset-x-4 bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-border bg-background/70 px-4 py-2.5 text-xs text-muted-foreground backdrop-blur">
          <span className="flex items-center gap-1.5">
            <EyeOff className="h-3.5 w-3.5 text-primary" /> পরিচয় গোপন থাকে
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-signal-green" /> মানুষের মডারেশন
          </span>
        </div>
      </div>
    </section>
  );
}
