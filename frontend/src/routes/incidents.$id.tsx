import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarClock,
  Flag,
  Lightbulb,
  MapPin,
  MessageCircle,
  Pencil,
  Scale,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MapFrame } from "@/components/mamla/MapFrame";
import { RoadSign, catStyle } from "@/components/mamla/RoadSign";
import { Turnstile } from "@/components/mamla/Turnstile";
import { Button } from "@/components/ui/button";
import { apiMessage } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  COMMENT_FLAG_REASONS,
  COMMENT_TYPES,
  INCIDENT_FLAG_REASONS,
  RULES,
  SEED_INCIDENTS,
  bn,
  categoryById,
  formatDateTime,
  hasLink,
  timeAgo,
  type CommentType,
  type Incident,
} from "@/lib/incidents";
import {
  addComment,
  castVote,
  flagComment,
  flagIncident,
  useComments,
  useIncidentQuery,
  useMyVote,
  useRefreshIncident,
} from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/incidents/$id")({
  head: ({ params }) => {
    const seed = SEED_INCIDENTS.find((i) => i.id === params.id);
    const title = seed ? `${seed.title} — Mamladibe` : "ঘটনার বিস্তারিত — Mamladibe";
    const desc = seed ? seed.description.slice(0, 150) : "কমিউনিটির রিপোর্ট করা রাস্তার ঘটনা।";
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: IncidentPage,
});

function IncidentPage() {
  const { id } = Route.useParams();
  const query = useIncidentQuery(id);
  const incident = query.data;

  if (!incident) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        {query.isError ? (
          <>
            <RoadSign category="other" size={72} className="mx-auto" />
            <h1 className="mt-6 text-3xl font-extrabold">এই ঘটনাটি খুঁজে পাওয়া যায়নি</h1>
            <p className="mt-2 text-muted-foreground">
              হয়তো লিংকটি ভুল বা রিপোর্টটি সরিয়ে নেওয়া হয়েছে।
            </p>
            <Button asChild variant="road" className="mt-6">
              <Link to="/incidents">সব ঘটনা দেখুন</Link>
            </Button>
          </>
        ) : (
          <div className="mx-auto h-64 animate-pulse rounded-3xl bg-card" />
        )}
      </div>
    );
  }
  return <IncidentView incident={incident} />;
}

function IncidentView({ incident }: { incident: Incident }) {
  const cat = categoryById(incident.category);
  const vote = useMyVote(incident.id);
  const refresh = useRefreshIncident();

  const voteFor = async (kind: "support" | "dispute") => {
    try {
      await castVote(incident, kind);
      await refresh(incident.trackingId);
    } catch (error) {
      toast.error(apiMessage(error));
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6" style={catStyle(incident.category)}>
      <Link
        to="/incidents"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> সব ঘটনা
      </Link>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <article className="asphalt-panel relative overflow-hidden rounded-[1.75rem] border border-border">
          <div className="h-2 bg-[color:var(--cat)]" />
          <div className="p-6 sm:p-10">
            <div className="flex flex-wrap items-center gap-4">
              <RoadSign category={incident.category} size={64} />
              <div>
                <div className="text-sm font-bold text-[color:var(--cat)]">
                  {cat.bn} · <span className="font-normal opacity-80">{cat.en}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  <span className="font-mono uppercase tracking-[0.2em]">
                    {incident.trackingId}
                  </span>{" "}
                  · {timeAgo(incident.createdAt)}
                </div>
              </div>
            </div>
            <h1 className="mt-6 text-3xl font-extrabold leading-tight text-balance sm:text-[2.6rem]">
              {incident.title}
            </h1>
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-primary" />
                {incident.roadName ? `${incident.roadName}, ` : ""}
                {incident.areaName}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="h-4 w-4 text-primary" />
                ঘটনার সময়: {formatDateTime(incident.incidentAt)}
              </span>
              {incident.isEdited && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs">
                  <Pencil className="h-3 w-3" />{" "}
                  {incident.byModerator ? "মডারেটর সম্পাদিত" : "সম্পাদিত"}
                  {incident.editedAt ? ` · ${formatDateTime(incident.editedAt)}` : ""}
                </span>
              )}
            </div>
            <div className="lane-dash my-8 h-[3px] opacity-60" />
            <p className="whitespace-pre-line text-lg leading-[1.9] text-foreground/90">
              {incident.description}
            </p>

            {incident.safetyTip && (
              <div className="mt-8 flex gap-4 rounded-2xl border border-primary/40 bg-primary/10 p-5">
                <Lightbulb className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
                <div>
                  <div className="font-display text-[11px] font-semibold text-primary">
                    রিপোর্টারের দেওয়া টিপ · Reporter-provided tip
                  </div>
                  <p className="mt-1.5 leading-relaxed">{incident.safetyTip}</p>
                </div>
              </div>
            )}
          </div>
        </article>

        <aside className="space-y-4">
          <div className="asphalt-panel rounded-[1.75rem] border border-border p-5">
            <div className="text-sm font-semibold">আপনার মত কী?</div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <VoteButton
                active={vote === "support"}
                kind="support"
                count={incident.support}
                onClick={() => void voteFor("support")}
              />
              <VoteButton
                active={vote === "dispute"}
                kind="dispute"
                count={incident.dispute}
                onClick={() => void voteFor("dispute")}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              একটি রিপোর্টে একটিই মত দেওয়া যায়। চাইলে বদলাতে পারবেন।
            </p>
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-background/70 p-3 text-xs text-muted-foreground">
              <Scale className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                সংখ্যাগুলো কমিউনিটির মতামত, প্রমাণ নয়।
                <br />
                <span className="opacity-70">
                  Counts show community opinion. They are not proof.
                </span>
              </span>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-dashed border-border pt-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Flag className="h-3.5 w-3.5" /> {bn(incident.flags)} ফ্ল্যাগ
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MessageCircle className="h-3.5 w-3.5" /> {bn(incident.commentCount)} মন্তব্য
              </span>
              <FlagDialog
                target="incident"
                id={incident.trackingId}
                already={incident.viewerState.hasFlagged}
                onDone={() => refresh(incident.trackingId)}
              />
            </div>
          </div>

          <div className="h-64 overflow-hidden rounded-[1.75rem] border border-border">
            <MapFrame
              incidents={[incident]}
              selectedId={incident.id}
              center={[incident.lat, incident.lng]}
              zoom={15}
            />
          </div>
        </aside>
      </div>

      <Comments incidentId={incident.id} />
    </div>
  );
}

function VoteButton({
  kind,
  active,
  count,
  onClick,
}: {
  kind: "support" | "dispute";
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  const isS = kind === "support";
  const Icon = isS ? ThumbsUp : ThumbsDown;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "group flex flex-col items-start gap-2 rounded-2xl border-2 p-4 text-left transition-all active:scale-[0.97]",
        isS
          ? active
            ? "border-support bg-support/15"
            : "border-border hover:border-support/60"
          : active
            ? "border-dispute bg-dispute/15"
            : "border-border hover:border-dispute/60",
      )}
    >
      <Icon
        className={cn(
          "h-6 w-6 transition-transform group-hover:-rotate-12",
          isS ? "text-support" : "text-dispute",
        )}
      />
      <span className="font-display text-3xl font-extrabold leading-none">{bn(count)}</span>
      <span className="text-sm font-semibold">
        {isS ? "সমর্থন" : "আপত্তি"}{" "}
        <span className="text-xs font-normal text-muted-foreground">
          {isS ? "Support" : "Dispute"}
        </span>
      </span>
    </button>
  );
}

function FlagDialog({
  target,
  id,
  compact,
  already = false,
  onDone,
}: {
  target: "incident" | "comment";
  id: string;
  compact?: boolean;
  already?: boolean;
  onDone?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const reasons = target === "incident" ? INCIDENT_FLAG_REASONS : COMMENT_FLAG_REASONS;

  const submit = async () => {
    if (!reason) return;
    try {
      if (target === "incident") await flagIncident(id, reason);
      else await flagComment(id, reason);
      toast.success("ফ্ল্যাগটি পর্যালোচনার জন্য পাঠানো হয়েছে।");
      setOpen(false);
      await onDone?.();
    } catch (error) {
      toast.error(apiMessage(error));
    }
  };

  return (
    <>
      <button
        onClick={() => (already ? toast.info("আপনি এটি আগেই ফ্ল্যাগ করেছেন।") : setOpen(true))}
        className={cn(
          "inline-flex items-center gap-1 font-semibold text-flag hover:underline",
          compact && "text-xs",
          already && "opacity-50",
        )}
      >
        <Flag className="h-3.5 w-3.5" /> {already ? "ফ্ল্যাগ করা হয়েছে" : "ফ্ল্যাগ করুন"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-border bg-popover">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">কেন ফ্ল্যাগ করছেন?</DialogTitle>
            <DialogDescription>
              ফ্ল্যাগ মানে দ্বিমত নয় — নীতিমালা ভঙ্গ হলে জানান। একজন মডারেটর দেখবেন, নিজে থেকে কিছু
              সরানো হবে না।
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {reasons.map((r) => (
              <button
                key={r.id}
                onClick={() => setReason(r.id)}
                className={cn(
                  "flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition-colors",
                  reason === r.id ? "border-flag bg-flag/10" : "border-border hover:border-flag/50",
                )}
              >
                <span className="font-semibold">{r.bn}</span>
                <span className="text-xs text-muted-foreground">{r.en}</span>
              </button>
            ))}
          </div>
          <Button variant="destructive" size="lg" disabled={!reason} onClick={submit}>
            ফ্ল্যাগ পাঠান
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Comments({ incidentId }: { incidentId: string }) {
  const comments = useComments(incidentId);
  const refresh = useRefreshIncident();
  const [type, setType] = useState<CommentType>("info");
  const [text, setText] = useState("");
  const [page, setPage] = useState(1);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const trimmed = text.trim();
  const error =
    trimmed.length > 0 && trimmed.length < RULES.commentMin
      ? `কমপক্ষে ${bn(RULES.commentMin)} অক্ষর লিখুন`
      : hasLink(trimmed)
        ? "মন্তব্যে লিংক দেওয়া যাবে না"
        : null;
  const shown = comments.slice(0, page * RULES.commentsPageSize);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (error || trimmed.length < RULES.commentMin || !captchaToken) return;
    setSubmitting(true);
    try {
      const result = await addComment(incidentId, { type, text: trimmed, captchaToken });
      toast.success(`মন্তব্য যোগ হয়েছে। আজ আরও ${result.quota.remaining}টি করা যাবে।`);
      setText("");
      await refresh(incidentId);
    } catch (requestError) {
      toast.error(apiMessage(requestError));
    } finally {
      setSubmitting(false);
      setCaptchaReset((value) => value + 1);
    }
  };

  return (
    <section className="mt-12 grid gap-8 lg:grid-cols-[1fr_380px]">
      <div>
        <h2 className="text-2xl font-extrabold">
          কমিউনিটির মন্তব্য <span className="text-muted-foreground">({bn(comments.length)})</span>
        </h2>
        <ul className="mt-5 space-y-3">
          {shown.map((c) => {
            const t = COMMENT_TYPES.find((x) => x.id === c.type)!;
            return (
              <li key={c.id} className="rounded-2xl border border-border bg-card/70 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-bold",
                        c.type === "correction" && "bg-signal-amber/15 text-signal-amber",
                        c.type === "info" && "bg-cat-police/15 text-cat-police",
                        c.type === "experience" && "bg-secondary text-muted-foreground",
                      )}
                    >
                      {t.bn}
                    </span>
                    {c.mine && <span className="text-xs text-primary">আপনার মন্তব্য</span>}
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {timeAgo(c.createdAt)}
                  </span>
                </div>
                <p className="mt-3 leading-relaxed">{c.text}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>কমিউনিটির মন্তব্য। যাচাই করা নয়।</span>
                  <span className="flex items-center gap-4">
                    {!c.mine && (
                      <FlagDialog
                        target="comment"
                        id={c.id}
                        compact
                        already={Boolean(c.hasFlagged)}
                        onDone={() => refresh(incidentId)}
                      />
                    )}
                  </span>
                </div>
              </li>
            );
          })}
          {comments.length === 0 && (
            <li className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
              এখনো কোনো মন্তব্য নেই। প্রথম তথ্যটি আপনিই দিন।
            </li>
          )}
        </ul>
        {comments.length > shown.length && (
          <Button variant="asphalt" className="mt-4" onClick={() => setPage((p) => p + 1)}>
            আরও দেখুন
          </Button>
        )}
      </div>

      <form
        onSubmit={submit}
        className="asphalt-panel h-fit rounded-[1.75rem] border border-border p-5 lg:sticky lg:top-24"
      >
        <h3 className="font-display text-lg font-bold">মন্তব্য যোগ করুন</h3>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {COMMENT_TYPES.map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => setType(t.id)}
              className={cn(
                "rounded-xl border-2 px-2 py-2 text-xs font-semibold transition-colors",
                type === t.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t.bn}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, RULES.commentMax))}
          rows={4}
          placeholder="যা জানেন বা দেখেছেন লিখুন..."
          className="mt-3 w-full resize-none rounded-xl border border-input bg-background p-3 text-sm outline-none focus:border-primary"
        />
        <div className="mt-1 flex justify-between text-xs">
          <span className="text-flag">{error}</span>
          <span className="font-mono text-muted-foreground">
            {bn(text.length)}/{bn(RULES.commentMax)}
          </span>
        </div>
        <Turnstile
          onToken={setCaptchaToken}
          resetKey={captchaReset}
          className="mt-3 overflow-hidden"
        />
        <Button
          type="submit"
          variant="road"
          className="mt-3 w-full"
          disabled={!!error || trimmed.length < RULES.commentMin || !captchaToken || submitting}
        >
          {submitting ? "পাঠানো হচ্ছে..." : "মন্তব্য পাঠান"}
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          প্রতিদিন সর্বোচ্চ {bn(RULES.commentsPerDay)}টি মন্তব্য · লিংক দেওয়া যাবে না
        </p>
      </form>
    </section>
  );
}
