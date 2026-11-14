import {
  CarFront,
  Construction,
  Footprints,
  Gauge,
  MessageSquareMore,
  Siren,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, ReactElement } from "react";
import { categoryById, type CategoryId, type SignShape } from "@/lib/incidents";
import { cn } from "@/lib/utils";

export const CATEGORY_ICONS: Record<CategoryId, LucideIcon> = {
  road_accident: CarFront,
  traffic_violation: Gauge,
  police_misconduct: Siren,
  infrastructure: Construction,
  public_safety: Footprints,
  other: MessageSquareMore,
};

const SHAPES: Record<
  SignShape,
  (p: { className?: string; fill?: string; stroke?: string; sw?: number }) => ReactElement
> = {
  triangle: (p) => <path d="M50 7 L94 86 Q96 92 89 92 H11 Q4 92 6 86 Z" {...svgProps(p)} />,
  circle: (p) => <circle cx="50" cy="50" r="43" {...svgProps(p)} />,
  shield: (p) => (
    <path d="M50 6 L88 18 V48 C88 72 71 87 50 94 C29 87 12 72 12 48 V18 Z" {...svgProps(p)} />
  ),
  diamond: (p) => <path d="M50 5 L95 50 L50 95 L5 50 Z" {...svgProps(p)} />,
  square: (p) => <rect x="8" y="8" width="84" height="84" rx="14" {...svgProps(p)} />,
  octagon: (p) => <path d="M31 6 H69 L94 31 V69 L69 94 H31 L6 69 V31 Z" {...svgProps(p)} />,
};

function svgProps({ fill, stroke, sw }: { fill?: string; stroke?: string; sw?: number }) {
  return {
    fill: fill ?? "none",
    stroke: stroke ?? "none",
    strokeWidth: sw ?? 0,
    strokeLinejoin: "round" as const,
  };
}

export function catStyle(id: CategoryId): CSSProperties {
  return { ["--cat" as string]: `var(${categoryById(id).colorVar})` };
}

export function RoadSign({
  category,
  size = 44,
  className,
}: {
  category: CategoryId;
  size?: number;
  className?: string;
}) {
  const cat = categoryById(category);
  const Shape = SHAPES[cat.shape];
  const Icon = CATEGORY_ICONS[category];
  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size, ...catStyle(category) }}
      aria-hidden
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full drop-shadow-[0_6px_10px_oklch(0_0_0/0.5)]"
      >
        <Shape fill="var(--cat)" stroke="var(--cat)" sw={6} />
        <g transform="translate(50 50) scale(0.8) translate(-50 -50)">
          <Shape stroke="var(--primary-foreground)" sw={5} />
        </g>
      </svg>
      <Icon
        className={cn(
          "relative text-primary-foreground",
          cat.shape === "triangle" && "translate-y-[12%]",
        )}
        style={{ width: size * 0.38, height: size * 0.38 }}
        strokeWidth={2.4}
      />
    </span>
  );
}

export function CategoryTag({ category, className }: { category: CategoryId; className?: string }) {
  const cat = categoryById(category);
  return (
    <span
      style={catStyle(category)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-[color:var(--cat)]/40 bg-[color:var(--cat)]/12 px-2.5 py-1 text-xs font-semibold text-[color:var(--cat)]",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--cat)]" />
      {cat.bn}
    </span>
  );
}
