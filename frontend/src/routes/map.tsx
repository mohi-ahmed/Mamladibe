import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, MapPin, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useCallback, useState } from "react";
import { CategoryFilter } from "@/components/mamla/CategoryFilter";
import { MapFrame } from "@/components/mamla/MapFrame";
import type { MapBounds } from "@/components/mamla/IncidentMap";
import { RoadSign, catStyle } from "@/components/mamla/RoadSign";
import { Button } from "@/components/ui/button";
import { apiMessage } from "@/lib/api";
import { CATEGORIES, bn, categoryById, timeAgo, type CategoryId } from "@/lib/incidents";
import { useIncidentList } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/map")({
  head: () => ({
    meta: [
      { title: "লাইভ ম্যাপ — Mamladibe" },
      {
        name: "description",
        content: "ঢাকার রাস্তার সব ঘটনা এক ম্যাপে — ক্যাটাগরি অনুযায়ী রঙিন পিন।",
      },
      { property: "og:title", content: "লাইভ ম্যাপ — Mamladibe" },
      {
        property: "og:description",
        content: "ঢাকার রাস্তার সব ঘটনা এক ম্যাপে — ক্যাটাগরি অনুযায়ী রঙিন পিন।",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MapPage,
});

function MapPage() {
  const [cat, setCat] = useState<CategoryId | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const incidentQuery = useIncidentList(
    bounds
      ? {
          bbox: `${bounds.minLng},${bounds.minLat},${bounds.maxLng},${bounds.maxLat}`,
          ...(cat !== "all" ? { category: cat } : {}),
          limit: 500,
          sort: "newest",
        }
      : { limit: 500, sort: "newest" },
    { enabled: Boolean(bounds) },
  );
  const list = incidentQuery.data?.items ?? [];
  const totalItems = list.length;
  const sel = list.find((i) => i.id === selected) ?? null;
  const handleBoundsChange = useCallback((next: MapBounds) => {
    const rounded = {
      minLat: Number(next.minLat.toFixed(5)),
      minLng: Number(next.minLng.toFixed(5)),
      maxLat: Number(next.maxLat.toFixed(5)),
      maxLng: Number(next.maxLng.toFixed(5)),
    };
    setBounds((current) =>
      current &&
      current.minLat === rounded.minLat &&
      current.minLng === rounded.minLng &&
      current.maxLat === rounded.maxLat &&
      current.maxLng === rounded.maxLng
        ? current
        : rounded,
    );
  }, []);

  return (
    <div className="mx-auto max-w-[1600px] px-3 pt-4 sm:px-6">
      <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
        {/* List */}
        <aside className="order-2 flex flex-col lg:order-1 lg:h-[calc(100vh-6.5rem)]">
          <div className="pb-4">
            <p className="eyebrow">ম্যাপে খুঁজুন</p>
            <h1 className="mt-1 text-3xl font-extrabold">লাইভ ম্যাপ</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {incidentQuery.isFetching
                ? "এই এলাকার ঘটনা খোঁজা হচ্ছে..."
                : totalItems > list.length
                  ? `দৃশ্যমান এলাকায় ${bn(totalItems)}টি · ম্যাপে সর্বশেষ ${bn(list.length)}টি`
                  : `দৃশ্যমান এলাকায় ${bn(totalItems)}টি ঘটনা`}
            </p>
          </div>
          <div className="-mr-2 flex-1 space-y-2 overflow-y-auto pr-2">
            {list.map((i) => (
              <button
                key={i.id}
                onClick={() => setSelected(i.id)}
                style={catStyle(i.category)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors",
                  selected === i.id
                    ? "border-[color:var(--cat)] bg-[color:var(--cat)]/10"
                    : "border-border bg-card/70 hover:border-[color:var(--cat)]/50",
                )}
              >
                <RoadSign category={i.category} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold leading-snug">{i.title}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {i.areaName} · {timeAgo(i.createdAt)}
                  </span>
                </span>
              </button>
            ))}
            {incidentQuery.isError && (
              <div className="rounded-2xl border border-flag/50 bg-flag/10 p-4 text-sm">
                <p className="font-semibold">ম্যাপের ঘটনা লোড করা যায়নি</p>
                <p className="mt-1 text-muted-foreground">{apiMessage(incidentQuery.error)}</p>
                <Button
                  variant="asphalt"
                  size="sm"
                  className="mt-3"
                  onClick={() => incidentQuery.refetch()}
                >
                  আবার চেষ্টা করুন
                </Button>
              </div>
            )}
            {!incidentQuery.isFetching && !incidentQuery.isError && list.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
                এই দৃশ্যমান এলাকায় কোনো ঘটনা নেই।
              </div>
            )}
          </div>
        </aside>

        {/* Map */}
        <div className="relative order-1 h-[64vh] overflow-hidden rounded-[1.75rem] border border-border lg:order-2 lg:h-[calc(100vh-6.5rem)]">
          <MapFrame
            incidents={list}
            selectedId={selected}
            onSelect={setSelected}
            onBoundsChange={handleBoundsChange}
          />

          <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex flex-col gap-3">
            <div className="pointer-events-auto rounded-2xl border border-border bg-popover/90 p-2 backdrop-blur">
              <CategoryFilter
                value={cat}
                onChange={(v) => {
                  setCat(v);
                  setSelected(null);
                }}
              />
            </div>
          </div>

          {/* legend */}
          <div className="absolute bottom-4 left-4 z-[500] hidden rounded-2xl border border-border bg-popover/90 p-3 backdrop-blur md:block">
            <div className="mb-2 font-display text-[10px] font-semibold text-muted-foreground">
              সংকেত
            </div>
            <ul className="space-y-1.5">
              {CATEGORIES.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-xs">
                  <RoadSign category={c.id} size={18} />
                  {c.bn}
                </li>
              ))}
            </ul>
          </div>

          {sel && (
            <div
              style={catStyle(sel.category)}
              className="absolute bottom-4 right-4 z-[600] w-[calc(100%-2rem)] max-w-sm animate-rise rounded-2xl border border-[color:var(--cat)]/60 bg-popover/95 p-5 shadow-card backdrop-blur"
            >
              <button
                onClick={() => setSelected(null)}
                className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:text-foreground"
                aria-label="বন্ধ করুন"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-3">
                <RoadSign category={sel.category} size={40} />
                <div>
                  <div className="text-xs font-bold text-[color:var(--cat)]">
                    {categoryById(sel.category).bn}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {timeAgo(sel.createdAt)}
                  </div>
                </div>
              </div>
              <h3 className="mt-3 text-lg font-bold leading-snug">{sel.title}</h3>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 text-primary" />
                {sel.areaName}
              </p>
              <div className="mt-4 flex items-center justify-between">
                <div className="flex gap-3 text-sm font-semibold">
                  <span className="inline-flex items-center gap-1 text-support">
                    <ThumbsUp className="h-4 w-4" />
                    {bn(sel.support)}
                  </span>
                  <span className="inline-flex items-center gap-1 text-dispute">
                    <ThumbsDown className="h-4 w-4" />
                    {bn(sel.dispute)}
                  </span>
                </div>
                <Button asChild variant="road" size="sm">
                  <Link to="/incidents/$id" params={{ id: sel.id }}>
                    বিস্তারিত <ArrowUpRight />
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
