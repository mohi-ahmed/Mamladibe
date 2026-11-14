import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Lightbulb,
  MapPin,
  MessageCircle,
  Pencil,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { bn, categoryById, timeAgo, type Incident } from "@/lib/incidents";
import { cn } from "@/lib/utils";
import { RoadSign, catStyle } from "./RoadSign";

export function IncidentCard({
  incident,
  className,
  index = 0,
}: {
  incident: Incident;
  className?: string;
  index?: number;
}) {
  const cat = categoryById(incident.category);
  return (
    <Link
      to="/incidents/$id"
      params={{ id: incident.id }}
      style={{ ...catStyle(incident.category), animationDelay: `${index * 60}ms` }}
      className={cn(
        "asphalt-panel group relative flex animate-rise flex-col overflow-hidden rounded-2xl border border-border p-5 transition-all duration-300 hover:-translate-y-1 hover:border-[color:var(--cat)]/60",
        className,
      )}
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-[color:var(--cat)] opacity-80" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <RoadSign
            category={incident.category}
            size={38}
            className="transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"
          />
          <div className="leading-tight">
            <div className="text-xs font-bold text-[color:var(--cat)]">{cat.bn}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {incident.trackingId}
            </div>
          </div>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {timeAgo(incident.createdAt)}
        </span>
      </div>

      <h3 className="mt-4 text-lg font-bold leading-snug text-balance group-hover:text-primary">
        {incident.title}
      </h3>
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
        {incident.description}
      </p>

      <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="h-3.5 w-3.5 text-primary" />
        <span className="truncate">
          {incident.roadName ? `${incident.roadName} · ` : ""}
          {incident.areaName}
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-dashed border-border pt-4">
        <div className="flex items-center gap-3 text-xs font-semibold">
          <span className="inline-flex items-center gap-1 text-support">
            <ThumbsUp className="h-3.5 w-3.5" />
            {bn(incident.support)}
          </span>
          <span className="inline-flex items-center gap-1 text-dispute">
            <ThumbsDown className="h-3.5 w-3.5" />
            {bn(incident.dispute)}
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <MessageCircle className="h-3.5 w-3.5" />
            {bn(incident.commentCount)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          {incident.safetyTip && (
            <Lightbulb className="h-4 w-4 text-primary" aria-label="সেফটি টিপ আছে" />
          )}
          {incident.isEdited && <Pencil className="h-3.5 w-3.5" aria-label="সম্পাদিত" />}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
        </div>
      </div>
    </Link>
  );
}
