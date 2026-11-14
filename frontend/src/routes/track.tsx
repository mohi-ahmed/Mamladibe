import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, History, KeyRound, Lock, Pencil, ShieldAlert, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { RoadSign, catStyle } from "@/components/mamla/RoadSign";
import { Button } from "@/components/ui/button";
import { api, apiMessage, type TrackResult } from "@/lib/api";
import { RULES, bn, categoryById, changeRatio, formatDateTime } from "@/lib/incidents";

export const Route = createFileRoute("/track")({
  head: () => ({
    meta: [
      { title: "রিপোর্ট ট্র্যাক — Mamladibe" },
      {
        name: "description",
        content:
          "Tracking ID ও Secret দিয়ে নিজের রিপোর্ট দেখুন এবং ১৫ মিনিটের মধ্যে ছোট ভুল ঠিক করুন।",
      },
      { property: "og:title", content: "রিপোর্ট ট্র্যাক — Mamladibe" },
      {
        property: "og:description",
        content:
          "Tracking ID ও Secret দিয়ে নিজের রিপোর্ট দেখুন এবং ১৫ মিনিটের মধ্যে ছোট ভুল ঠিক করুন।",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TrackPage,
});

function TrackPage() {
  const [tid, setTid] = useState("");
  const [secret, setSecret] = useState("");
  const [found, setFound] = useState<TrackResult | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await api.track(tid, secret);
      setError(false);
      setFound(result);
    } catch {
      setError(true);
      setFound(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 sm:px-6">
      <p className="eyebrow">পরিচয় ছাড়াই ট্র্যাকিং</p>
      <h1 className="mt-2 text-4xl font-extrabold sm:text-5xl">আমার রিপোর্ট খুঁজুন</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        রিপোর্ট করার পর পাওয়া স্লিপের Tracking ID আর Secret দিন। কোনো লগইন বা ব্যক্তিগত তথ্য লাগে
        না।
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[400px_1fr]">
        <form
          onSubmit={submit}
          className="asphalt-panel h-fit rounded-[1.75rem] border border-border p-6"
        >
          <div className="sign-plate mb-6 flex items-center gap-3 px-4 py-3">
            <KeyRound className="h-6 w-6" />
            <div className="font-display text-lg font-bold leading-tight">স্লিপ যাচাই</div>
          </div>
          <label className="block text-sm font-semibold">
            Tracking ID
            <input
              value={tid}
              onChange={(e) => setTid(e.target.value)}
              placeholder="MD-XXXXXX"
              autoComplete="off"
              className="input-road mt-1.5 font-mono uppercase tracking-wider"
            />
          </label>
          <label className="mt-4 block text-sm font-semibold">
            Secret
            <input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              type="password"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              className="input-road mt-1.5 font-mono uppercase tracking-wider"
            />
          </label>
          {error && (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-flag">
              <ShieldAlert className="h-4 w-4 shrink-0" /> তথ্য মেলেনি। Tracking ID ও Secret আবার
              দেখে নিন।
            </p>
          )}
          <Button
            type="submit"
            variant="road"
            size="lg"
            className="mt-5 w-full"
            disabled={!tid || !secret || loading}
          >
            {loading ? "খোঁজা হচ্ছে..." : "রিপোর্ট খুঁজুন"}
          </Button>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Secret হারিয়ে গেলে পুনরুদ্ধার করা যায় না — আমরাও জানি না, কারণ এটি কোথাও সাধারণ লেখায়
            সংরক্ষণ করা হয় না।
          </p>
        </form>

        <div>
          {found ? (
            <TrackedView
              result={found}
              secret={secret}
              onUpdated={async () => setFound(await api.track(found.incident.trackingId, secret))}
            />
          ) : (
            <div className="grid h-full min-h-[320px] place-items-center rounded-[1.75rem] border border-dashed border-border p-10 text-center">
              <div>
                <div className="hazard mx-auto h-3 w-40 rounded-full opacity-80" />
                <h2 className="mt-6 text-2xl font-bold">কুইক এডিট নীতি</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                  প্রকাশের প্রথম <b className="text-foreground">১৫ মিনিট</b> শুধু শিরোনাম, বিবরণ ও
                  সেফটি টিপের বানান বা ছোট ভুল ঠিক করা যাবে। ক্যাটাগরি, লোকেশন ও ঘটনার সময় বদলানো
                  যাবে না।
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function TrackedView({
  result,
  secret,
  onUpdated,
}: {
  result: TrackResult;
  secret: string;
  onUpdated: () => Promise<void>;
}) {
  const incident = result.incident;
  const now = useNow();
  const versions = result.versions;
  const deadline = result.edit.deadline;
  const left = Math.max(0, deadline - now);
  const open = result.edit.allowed && left > 0;
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  const pct = (left / (RULES.quickEditMinutes * 60_000)) * 100;

  const [title, setTitle] = useState(incident.title);
  const [description, setDescription] = useState(incident.description);
  const [tip, setTip] = useState(incident.safetyTip ?? "");

  const original = `${incident.title}\n${incident.description}\n${incident.safetyTip ?? ""}`;
  const edited = `${title}\n${description}\n${tip}`;
  const ratio = changeRatio(original, edited);
  const tooMuch = ratio > RULES.maxEditChangeRatio;
  const valid = title.trim().length >= RULES.titleMin && description.trim().length >= RULES.descMin;
  const changed = original !== edited;

  const save = async () => {
    if (!open) {
      toast.error("১৫ মিনিটের সময়সীমা শেষ। আর সম্পাদনা করা যাবে না।");
      return;
    }
    if (tooMuch) {
      toast.error("অনেক বেশি পরিবর্তন। শুধু ছোট ভুল ঠিক করা যাবে।");
      return;
    }
    try {
      await api.editIncident(incident.trackingId, {
        secret,
        title: title.trim(),
        description: description.trim(),
        ...(tip.trim() ? { safetyTip: tip.trim() } : {}),
      });
      await onUpdated();
      toast.success("সংশোধন সংরক্ষিত হয়েছে। রিপোর্টে 'সম্পাদিত' লেবেল দেখাবে।");
    } catch (requestError) {
      toast.error(apiMessage(requestError));
    }
  };

  return (
    <div className="space-y-5" style={catStyle(incident.category)}>
      <div className="asphalt-panel rounded-[1.75rem] border border-border p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <RoadSign category={incident.category} size={48} />
            <div>
              <div className="font-mono text-sm font-bold tracking-wider">
                {incident.trackingId}
              </div>
              <div className="text-xs text-muted-foreground">
                প্রকাশিত · {formatDateTime(incident.createdAt)}
              </div>
            </div>
          </div>
          <Button asChild variant="asphalt" size="sm">
            <Link to="/incidents/$id" params={{ id: incident.id }}>
              পাবলিক পেজ <ArrowUpRight />
            </Link>
          </Button>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 text-center">
          {[
            { k: incident.support, v: "সমর্থন", c: "text-support" },
            { k: incident.dispute, v: "আপত্তি", c: "text-dispute" },
            { k: incident.commentCount, v: "মন্তব্য", c: "text-foreground" },
          ].map((s) => (
            <div key={s.v} className="rounded-xl bg-background/60 p-3">
              <div className={`font-display text-2xl font-extrabold ${s.c}`}>{bn(s.k)}</div>
              <div className="text-xs text-muted-foreground">{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="asphalt-panel overflow-hidden rounded-[1.75rem] border border-border">
        <div className="flex items-center justify-between gap-4 p-6 pb-4">
          <div className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold">কুইক এডিট</h2>
          </div>
          <div
            className={`led-board flex items-center gap-2 rounded-lg px-3 py-1.5 ${open ? "" : "opacity-60"}`}
          >
            <Timer className="h-4 w-4 text-signal-amber" />
            <span className="led-text text-lg font-bold">
              {open ? `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : "00:00"}
            </span>
          </div>
        </div>
        <div className="mx-6 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-1000"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="grid gap-4 p-6">
          {!open && (
            <p className="rounded-xl bg-destructive/10 p-3 text-sm text-flag">
              ১৫ মিনিটের সময়সীমা শেষ। এই রিপোর্ট আর সম্পাদনা করা যাবে না।
            </p>
          )}
          <label className="block text-sm font-semibold">
            শিরোনাম
            <input
              disabled={!open}
              value={title}
              maxLength={RULES.titleMax}
              onChange={(e) => setTitle(e.target.value)}
              className="input-road mt-1.5 disabled:opacity-60"
            />
          </label>
          <label className="block text-sm font-semibold">
            বিবরণ
            <textarea
              disabled={!open}
              value={description}
              maxLength={RULES.descMax}
              rows={5}
              onChange={(e) => setDescription(e.target.value)}
              className="input-road mt-1.5 resize-none disabled:opacity-60"
            />
          </label>
          <label className="block text-sm font-semibold">
            সেফটি টিপ
            <textarea
              disabled={!open}
              value={tip}
              maxLength={RULES.tipMax}
              rows={2}
              onChange={(e) => setTip(e.target.value)}
              className="input-road mt-1.5 resize-none disabled:opacity-60"
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { k: "ক্যাটাগরি", v: categoryById(incident.category).bn },
              { k: "লোকেশন", v: incident.areaName },
              { k: "ঘটনার সময়", v: formatDateTime(incident.incidentAt) },
            ].map((f) => (
              <div
                key={f.k}
                className="flex items-center gap-2 rounded-xl border border-border bg-background/40 p-3 text-sm text-muted-foreground"
              >
                <Lock className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px]">{f.k}</div>
                  <div className="truncate font-semibold text-foreground/80">{f.v}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-border pt-4">
            <span className={`text-xs ${tooMuch ? "text-flag" : "text-muted-foreground"}`}>
              পরিবর্তন: {bn(Math.round(ratio * 100))}% · সর্বোচ্চ{" "}
              {bn(Math.round(RULES.maxEditChangeRatio * 100))}%
            </span>
            <Button variant="road" onClick={save} disabled={!open || !changed || !valid || tooMuch}>
              সংশোধন সংরক্ষণ
            </Button>
          </div>
        </div>
      </div>

      {versions.length > 0 && (
        <div className="rounded-[1.75rem] border border-border p-6">
          <h3 className="flex items-center gap-2 font-bold">
            <History className="h-4 w-4 text-primary" /> আগের সংস্করণ
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            {versions.map((v, i) => (
              <li key={i} className="rounded-xl bg-card p-3">
                <div className="font-mono text-[11px] text-muted-foreground">
                  v{bn(i + 1)} · {formatDateTime(v.savedAt)}
                </div>
                <div className="mt-1 font-semibold">{v.title}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
