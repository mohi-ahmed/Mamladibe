import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useDeferredValue, useMemo } from "react";
import { CategoryFilter } from "@/components/mamla/CategoryFilter";
import { IncidentCard } from "@/components/mamla/IncidentCard";
import { Button } from "@/components/ui/button";
import { apiMessage } from "@/lib/api";
import { CATEGORIES, RULES, bn, type CategoryId } from "@/lib/incidents";
import { useIncidentList } from "@/lib/store";
import { cn } from "@/lib/utils";

type Range = "all" | "today" | "7d" | "30d";
interface SearchParams {
  q?: string | undefined;
  category?: CategoryId | undefined;
  range?: Range | undefined;
  cursor?: string | undefined;
}

const RANGES: { id: Range; label: string; ms: number }[] = [
  { id: "all", label: "সব সময়", ms: Infinity },
  { id: "today", label: "আজ", ms: 86_400_000 },
  { id: "7d", label: "৭ দিন", ms: 7 * 86_400_000 },
  { id: "30d", label: "৩০ দিন", ms: 30 * 86_400_000 },
];

export const Route = createFileRoute("/incidents/")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    q: typeof s["q"] === "string" && s["q"] ? s["q"] : undefined,
    category: CATEGORIES.some((c) => c.id === s["category"])
      ? (s["category"] as CategoryId)
      : undefined,
    range: RANGES.some((r) => r.id === s["range"]) ? (s["range"] as Range) : undefined,
    cursor: typeof s["cursor"] === "string" && s["cursor"] ? s["cursor"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "সব ঘটনা — Mamladibe" },
      {
        name: "description",
        content: "রাস্তা, এলাকা বা ক্যাটাগরি দিয়ে ঢাকার রাস্তার ঘটনা খুঁজুন।",
      },
      { property: "og:title", content: "সব ঘটনা — Mamladibe" },
      {
        property: "og:description",
        content: "রাস্তা, এলাকা বা ক্যাটাগরি দিয়ে ঢাকার রাস্তার ঘটনা খুঁজুন।",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: IncidentsPage,
});

function IncidentsPage() {
  const { q = "", category, range = "all", cursor } = Route.useSearch();
  const navigate = useNavigate({ from: "/incidents/" });
  const deferredQuery = useDeferredValue(q.trim());
  const from = useMemo(() => {
    const rangeMs = RANGES.find((item) => item.id === range)!.ms;
    return Number.isFinite(rangeMs) ? new Date(Date.now() - rangeMs).toISOString() : undefined;
  }, [range]);
  const incidentQuery = useIncidentList({
    ...(deferredQuery ? { q: deferredQuery } : {}),
    ...(category ? { category } : {}),
    ...(from ? { from } : {}),
    limit: RULES.pageSize,
    ...(cursor ? { cursor } : {}),
    sort: "newest",
  });
  const shown = incidentQuery.data?.items ?? [];
  const set = (patch: Partial<SearchParams>) =>
    navigate({
      search: (prev: SearchParams) => ({ ...prev, cursor: undefined, ...patch }),
      replace: true,
    });

  return (
    <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
      <p className="eyebrow">খুঁজুন</p>
      <h1 className="mt-2 text-4xl font-extrabold sm:text-5xl">সব ঘটনা</h1>

      <div className="asphalt-panel mt-8 rounded-2xl border border-border p-4 sm:p-5">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => set({ q: e.target.value || undefined })}
            placeholder="রাস্তা বা এলাকার নাম লিখুন — যেমন ফার্মগেট, প্রগতি সরণি"
            className="h-14 w-full rounded-xl border border-input bg-background pl-12 pr-12 text-base outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
          />
          {q && (
            <button
              onClick={() => set({ q: undefined })}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground"
              aria-label="মুছুন"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <CategoryFilter
            value={category ?? "all"}
            onChange={(v) => set({ category: v === "all" ? undefined : v })}
          />
          <div className="flex shrink-0 gap-1 rounded-xl border border-border bg-background p-1">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => set({ range: r.id === "all" ? undefined : r.id })}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
                  range === r.id
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          এই পৃষ্ঠায় <b className="text-foreground">{bn(shown.length)}</b>টি ঘটনা
        </span>
        <span className="font-mono text-xs">
          {incidentQuery.isFetching ? "খোঁজা হচ্ছে..." : "সর্বশেষ আগে"}
        </span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((i, idx) => (
          <IncidentCard key={i.id} incident={i} index={idx} />
        ))}
      </div>
      {incidentQuery.isPending && (
        <div className="mt-4 h-52 animate-pulse rounded-2xl bg-card" aria-label="লোড হচ্ছে" />
      )}
      {incidentQuery.isError && (
        <div className="mt-4 rounded-2xl border border-flag/50 bg-flag/10 p-8 text-center">
          <p className="font-semibold">ঘটনাগুলো লোড করা যায়নি</p>
          <p className="mt-1 text-sm text-muted-foreground">{apiMessage(incidentQuery.error)}</p>
          <Button variant="asphalt" className="mt-4" onClick={() => incidentQuery.refetch()}>
            আবার চেষ্টা করুন
          </Button>
        </div>
      )}
      {!incidentQuery.isPending && !incidentQuery.isError && shown.length === 0 && (
        <div className="mt-4 rounded-2xl border border-dashed border-border p-14 text-center">
          <p className="text-lg font-semibold">কিছু পাওয়া যায়নি</p>
          <p className="mt-1 text-sm text-muted-foreground">
            অন্য নাম লিখে বা ফিল্টার বদলে চেষ্টা করুন।
          </p>
          <Button
            variant="asphalt"
            className="mt-5"
            onClick={() => navigate({ search: {}, replace: true })}
          >
            ফিল্টার মুছুন
          </Button>
        </div>
      )}
      {!incidentQuery.isError && incidentQuery.data?.nextCursor && (
        <div className="mt-8 flex justify-center gap-2">
          <Button
            variant="road"
            size="sm"
            onClick={() =>
              navigate({
                search: (prev: SearchParams) => ({
                  ...prev,
                  cursor: incidentQuery.data?.nextCursor ?? undefined,
                }),
              })
            }
          >
            আরও ঘটনা দেখুন
          </Button>
        </div>
      )}
    </div>
  );
}
