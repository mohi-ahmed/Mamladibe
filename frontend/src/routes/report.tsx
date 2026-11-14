import { createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, Lock, LocateFixed, MapPin, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CaseSlip } from "@/components/mamla/CaseSlip";
import { MapFrame } from "@/components/mamla/MapFrame";
import { RoadSign, catStyle } from "@/components/mamla/RoadSign";
import { Turnstile } from "@/components/mamla/Turnstile";
import { Button } from "@/components/ui/button";
import { api, apiMessage } from "@/lib/api";
import {
  CATEGORIES,
  RULES,
  bn,
  categoryById,
  formatDateTime,
  isInBangladesh,
  type CategoryId,
  type Incident,
} from "@/lib/incidents";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/report")({
  head: () => ({
    meta: [
      { title: "ঘটনা জানান — Mamladibe" },
      {
        name: "description",
        content: "এক মিনিটে নাম-পরিচয় ছাড়া রাস্তার ঘটনা জানান। কোনো অ্যাকাউন্ট লাগবে না।",
      },
      { property: "og:title", content: "ঘটনা জানান — Mamladibe" },
      {
        property: "og:description",
        content: "এক মিনিটে নাম-পরিচয় ছাড়া রাস্তার ঘটনা জানান। কোনো অ্যাকাউন্ট লাগবে না।",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReportPage,
});

const STEPS = ["ক্যাটাগরি", "লোকেশন", "বিবরণ", "প্রকাশ"];

function toLocalInput(ts: number) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ReportPage() {
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [area, setArea] = useState("");
  const [road, setRoad] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [when, setWhen] = useState("");
  const [tip, setTip] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<{ incident: Incident; secret: string } | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => setWhen(toLocalInput(Date.now())), []);

  const pick = async (p: { lat: number; lng: number }) => {
    if (!isInBangladesh(p.lat, p.lng)) {
      toast.error("লোকেশনটি বাংলাদেশের বাইরে। বাংলাদেশের ভেতরে পিন দিন।");
      return;
    }
    setPoint(p);
    setArea("");
    setRoad("");
    try {
      const { location } = await api.reverseGeocode(p.lat, p.lng);
      setArea(location.areaName);
      setRoad(location.roadName);
    } catch {
      toast.warning("এলাকার নাম পাওয়া যায়নি। রাস্তা ও এলাকার নাম লিখে দিন।");
    }
  };

  const useGps = () => {
    if (!navigator.geolocation) {
      toast.error("এই ব্রাউজারে GPS নেই। ম্যাপে চাপ দিয়ে পিন দিন।");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        pick({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        toast.error("লোকেশনের অনুমতি পাওয়া যায়নি। ম্যাপে চাপ দিয়ে পিন দিন।");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const whenTs = when ? new Date(when).getTime() : NaN;
  const errors = {
    title: title.trim().length < RULES.titleMin ? `কমপক্ষে ${bn(RULES.titleMin)} অক্ষর` : null,
    description:
      description.trim().length < RULES.descMin ? `কমপক্ষে ${bn(RULES.descMin)} অক্ষর লিখুন` : null,
    when:
      !when || Number.isNaN(whenTs)
        ? "সময় দিন"
        : whenTs > Date.now() + 60_000
          ? "ভবিষ্যতের সময় দেওয়া যাবে না"
          : null,
    tip: tip.length > RULES.tipMax ? "সর্বোচ্চ ৫০০ অক্ষর" : null,
  };
  const detailsOk = !errors.title && !errors.description && !errors.when && !errors.tip;
  const canNext = [
    Boolean(category),
    Boolean(point && area.trim()),
    detailsOk,
    Boolean(captchaToken),
  ][step];

  const next = () => {
    if (step === 2 && !detailsOk) return setTouched(true);
    if (canNext) setStep((s) => Math.min(3, s + 1));
  };

  const publish = async () => {
    if (!category || !point || !detailsOk || !captchaToken || !area.trim()) return;
    setPublishing(true);
    try {
      const result = await api.createIncident({
        title: title.trim(),
        description: description.trim(),
        category,
        incidentAt: new Date(whenTs).toISOString(),
        lat: point.lat,
        lng: point.lng,
        roadName: road.trim(),
        areaName: area.trim(),
        ...(tip.trim() ? { safetyTip: tip.trim() } : {}),
        captchaToken,
      });
      setDone({ incident: result.incident, secret: result.credentials.secret });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      toast.error(apiMessage(error));
      setCaptchaReset((value) => value + 1);
    } finally {
      setPublishing(false);
    }
  };

  if (done) {
    return (
      <div className="px-4 pt-10 sm:px-6">
        <CaseSlip incident={done.incident} secret={done.secret} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-10 sm:px-6">
      <p className="eyebrow">নতুন রিপোর্ট · কোনো লগইন নেই</p>
      <h1 className="mt-2 text-4xl font-extrabold sm:text-5xl">কী ঘটেছে, বলুন।</h1>

      {/* Milestone stepper */}
      <ol className="relative mt-10 grid grid-cols-4">
        <div className="absolute left-[12.5%] right-[12.5%] top-6 h-1 rounded bg-secondary" />
        <div
          className="lane-dash absolute left-[12.5%] top-6 h-1 animate-lane-x transition-all duration-500"
          style={{ width: `${(step / 3) * 75}%` }}
        />
        {STEPS.map((s, i) => (
          <li key={s} className="relative flex flex-col items-center gap-2">
            <button
              type="button"
              disabled={i > step}
              onClick={() => setStep(i)}
              className={cn(
                "relative flex h-14 w-11 flex-col overflow-hidden rounded-t-full border-2 text-primary-foreground transition-all",
                i <= step ? "border-paint bg-paint" : "border-border bg-card text-muted-foreground",
                i === step && "scale-110 shadow-glow",
              )}
            >
              <span className={cn("h-4", i <= step ? "bg-primary" : "bg-secondary")} />
              <span className="grid flex-1 place-items-center font-display text-sm font-extrabold">
                {i < step ? <Check className="h-4 w-4" strokeWidth={3} /> : bn(i + 1)}
              </span>
            </button>
            <span
              className={cn(
                "text-xs font-semibold sm:text-sm",
                i === step ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {s}
            </span>
          </li>
        ))}
      </ol>

      <div className="asphalt-panel mt-10 rounded-[1.75rem] border border-border p-5 sm:p-8">
        {step === 0 && (
          <div>
            <h2 className="text-2xl font-bold">কোন ধরনের ঘটনা?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              একটি বাছুন। প্রকাশের পর ক্যাটাগরি আর বদলানো যাবে না।
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  style={catStyle(c.id)}
                  className={cn(
                    "group flex items-center gap-4 rounded-2xl border-2 p-4 text-left transition-all",
                    category === c.id
                      ? "border-[color:var(--cat)] bg-[color:var(--cat)]/12"
                      : "border-border hover:border-[color:var(--cat)]/50",
                  )}
                >
                  <RoadSign
                    category={c.id}
                    size={52}
                    className="transition-transform group-hover:scale-110"
                  />
                  <span className="min-w-0">
                    <span className="block font-display text-lg font-bold leading-tight">
                      {c.bn}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">{c.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">কোথায় ঘটেছে?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  ম্যাপে চাপ দিয়ে পিন দিন, টেনে ঠিক জায়গায় সরাতে পারবেন।
                </p>
              </div>
              <Button variant="asphalt" onClick={useGps} disabled={locating}>
                <LocateFixed /> {locating ? "খুঁজছি..." : "আমার লোকেশন"}
              </Button>
            </div>
            <div className="mt-5 h-[380px] overflow-hidden rounded-2xl border border-border">
              <MapFrame picked={point} onPick={pick} zoom={12} />
            </div>
            {point ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="rounded-xl border border-border bg-background/60 p-3">
                  <span className="text-xs text-muted-foreground">এলাকা</span>
                  <div className="mt-0.5 flex items-center gap-1.5 font-semibold">
                    <MapPin className="h-4 w-4 text-primary" />
                    <input
                      value={area}
                      onChange={(e) => setArea(e.target.value)}
                      placeholder="এলাকার নাম লিখুন"
                      className="w-full bg-transparent outline-none placeholder:font-normal placeholder:text-muted-foreground"
                    />
                  </div>
                </label>
                <label className="rounded-xl border border-border bg-background/60 p-3">
                  <span className="text-xs text-muted-foreground">
                    রাস্তার নাম {road ? "" : "(খুঁজে পাওয়া যায়নি — লিখে দিন)"}
                  </span>
                  <input
                    value={road}
                    onChange={(e) => setRoad(e.target.value)}
                    placeholder="যেমন: মিরপুর রোড"
                    className="mt-0.5 w-full bg-transparent font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground"
                  />
                </label>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">এখনো পিন দেওয়া হয়নি।</p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-5">
            <h2 className="text-2xl font-bold">বিস্তারিত লিখুন</h2>
            <Field
              label="শিরোনাম"
              count={`${bn(title.length)}/${bn(RULES.titleMax)}`}
              error={touched ? errors.title : null}
            >
              <input
                value={title}
                maxLength={RULES.titleMax}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="সংক্ষেপে কী ঘটেছে"
                className="input-road"
              />
            </Field>
            <Field
              label="বিবরণ"
              count={`${bn(description.length)}/${bn(RULES.descMax)}`}
              error={touched ? errors.description : null}
            >
              <textarea
                value={description}
                maxLength={RULES.descMax}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                placeholder="কী দেখেছেন, কখন, কারা জড়িত — যতটা সম্ভব পরিষ্কার করে লিখুন। কারও ফোন নম্বর বা বাসার ঠিকানা দেবেন না।"
                className="input-road resize-none"
              />
            </Field>
            <Field
              label="ঘটনার তারিখ ও সময়"
              error={
                touched || errors.when === "ভবিষ্যতের সময় দেওয়া যাবে না" ? errors.when : null
              }
            >
              <input
                type="datetime-local"
                value={when}
                max={toLocalInput(Date.now())}
                onChange={(e) => setWhen(e.target.value)}
                className="input-road [color-scheme:dark]"
              />
            </Field>
            <Field
              label="সেফটি টিপ (ঐচ্ছিক)"
              count={`${bn(tip.length)}/${bn(RULES.tipMax)}`}
              error={errors.tip}
            >
              <textarea
                value={tip}
                maxLength={RULES.tipMax}
                onChange={(e) => setTip(e.target.value)}
                rows={2}
                placeholder="অন্যরা কীভাবে সাবধান থাকতে পারে?"
                className="input-road resize-none"
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              বাংলা বা ইংরেজি — যেকোনো ভাষায় লিখতে পারেন। ছবি বা ভিডিও এই সংস্করণে নেই।
            </p>
          </div>
        )}

        {step === 3 && category && point && (
          <div>
            <h2 className="text-2xl font-bold">একবার মিলিয়ে নিন</h2>
            <div
              className="mt-5 rounded-2xl border border-border bg-background/50 p-5"
              style={catStyle(category)}
            >
              <div className="flex items-center gap-3">
                <RoadSign category={category} size={44} />
                <div>
                  <div className="text-sm font-bold text-[color:var(--cat)]">
                    {categoryById(category).bn}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {road ? `${road}, ` : ""}
                    {area} · {formatDateTime(whenTs)}
                  </div>
                </div>
              </div>
              <h3 className="mt-4 text-xl font-bold">{title}</h3>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
              {tip && (
                <p className="mt-3 rounded-lg bg-primary/10 p-3 text-sm">
                  <b className="text-primary">টিপ:</b> {tip}
                </p>
              )}
            </div>
            <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              প্রকাশের পর ক্যাটাগরি, লোকেশন ও সময় বদলানো যাবে না। প্রথম ১৫ মিনিট শুধু বানান বা ছোট
              ভুল ঠিক করা যাবে।
            </div>
            <div className="mt-6 rounded-xl border-2 border-border bg-background/60 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-5 w-5 text-signal-green" /> মানব যাচাই
              </div>
              <Turnstile onToken={setCaptchaToken} resetKey={captchaReset} />
            </div>
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-dashed border-border pt-6">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            <ArrowLeft /> পেছনে
          </Button>
          {step < 3 ? (
            <Button variant="road" size="lg" onClick={next} disabled={step !== 2 && !canNext}>
              পরের ধাপ <ArrowRight />
            </Button>
          ) : (
            <Button
              variant="road"
              size="lg"
              onClick={publish}
              disabled={!captchaToken || publishing}
            >
              {publishing ? "প্রকাশ হচ্ছে..." : "প্রকাশ করুন"} <ArrowRight />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  count,
  error,
  children,
}: {
  label: string;
  count?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-sm font-semibold">
        {label}
        {count && (
          <span className="font-mono text-xs font-normal text-muted-foreground">{count}</span>
        )}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-flag">{error}</span>}
    </label>
  );
}
