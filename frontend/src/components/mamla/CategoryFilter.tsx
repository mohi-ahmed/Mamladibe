import { CATEGORIES, type CategoryId } from "@/lib/incidents";
import { cn } from "@/lib/utils";
import { RoadSign, catStyle } from "./RoadSign";

export function CategoryFilter({
  value,
  onChange,
  className,
}: {
  value: CategoryId | "all";
  onChange: (v: CategoryId | "all") => void;
  className?: string;
}) {
  return (
    <div
      className={cn("-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]", className)}
      role="tablist"
    >
      <button
        role="tab"
        aria-selected={value === "all"}
        onClick={() => onChange("all")}
        className={cn(
          "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
          value === "all"
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-muted-foreground hover:text-foreground",
        )}
      >
        সব ঘটনা
      </button>
      {CATEGORIES.map((c) => {
        const active = value === c.id;
        return (
          <button
            key={c.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(c.id)}
            style={catStyle(c.id)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-4 text-sm font-semibold transition-colors",
              active
                ? "border-[color:var(--cat)] bg-[color:var(--cat)]/15 text-foreground"
                : "border-border bg-card text-muted-foreground hover:border-[color:var(--cat)]/50 hover:text-foreground",
            )}
          >
            <RoadSign category={c.id} size={24} />
            {c.bn}
          </button>
        );
      })}
    </div>
  );
}
