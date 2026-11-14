import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, EyeOff, Hand, Scale, ShieldCheck, Ticket } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CategoryFilter } from "@/components/mamla/CategoryFilter";
import { IncidentCard } from "@/components/mamla/IncidentCard";
import { LedTicker } from "@/components/mamla/LedTicker";
import { RoadHero } from "@/components/mamla/RoadHero";
import { RoadSign, catStyle } from "@/components/mamla/RoadSign";
import { CATEGORIES, bn, type CategoryId } from "@/lib/incidents";
import { useIncidents } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mamladibe — রাস্তার ঘটনা জানান, নাম-পরিচয় ছাড়াই" },
      {
        name: "description",
        content:
          "ঢাকার রাস্তার দুর্ঘটনা, হয়রানি, ভাঙা রাস্তার খবর জানুন ও জানান। কোনো অ্যাকাউন্ট লাগবে না।",
      },
      { property: "og:title", content: "Mamladibe — রাস্তার ঘটনা জানান, নাম-পরিচয় ছাড়াই" },
      {
        property: "og:description",
        content:
          "ঢাকার রাস্তার দুর্ঘটনা, হয়রানি, ভাঙা রাস্তার খবর জানুন ও জানান। কোনো অ্যাকাউন্ট লাগবে না।",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const STEPS = [
  {
    km: "০১",
    title: "পিন করুন",
    text: "ক্যাটাগরি বাছুন, ম্যাপে জায়গা দেখান, কী ঘটেছে লিখুন। কোনো লগইন নেই।",
  },
  {
    km: "০২",
    title: "স্লিপ রাখুন",
    text: "প্রকাশের সাথে সাথে পাবেন Tracking ID ও Secret — একবারই দেখানো হয়।",
  },
  {
    km: "০৩",
    title: "শহর সাড়া দেয়",
    text: "অন্যরা সমর্থন বা আপত্তি জানায়, তথ্য যোগ করে। রায় নয়, মতামত।",
  },
];

const PROMISES = [
  { icon: EyeOff, title: "পরিচয় গোপন", text: "অ্যাকাউন্ট, নাম, ফোন — কিছুই লাগে না।" },
  {
    icon: ShieldCheck,
    title: "IP সংরক্ষণ নেই",
    text: "শুধু ছদ্মনামী ব্রাউজার আইডি, আসল পরিচয় নয়।",
  },
  { icon: Scale, title: "রায় নয়, মতামত", text: "সংখ্যাগুলো কমিউনিটির মত — প্রমাণ নয়।" },
  { icon: Hand, title: "মানুষের মডারেশন", text: "ফ্ল্যাগে কিছু নিজে থেকে মুছে যায় না।" },
];

function Home() {
  const incidents = useIncidents();
  const [cat, setCat] = useState<CategoryId | "all">("all");
  const feed = incidents.filter((i) => cat === "all" || i.category === cat).slice(0, 6);

  return (
    <>
      <RoadHero incidents={incidents} />
      <LedTicker incidents={incidents} />

      {/* Six signs */}
      <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">৬টি সংকেত</p>
            <h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">রাস্তায় কী দেখেছেন?</h2>
          </div>
          <p className="max-w-md text-sm text-muted-foreground">
            প্রতিটি ঘটনার নিজস্ব রোড সাইন — ম্যাপে, ফিডে, সবখানে এক নজরে চেনা যায়।
          </p>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.map((c, i) => {
            const count = incidents.filter((x) => x.category === c.id).length;
            return (
              <Link
                key={c.id}
                to="/incidents"
                search={{ category: c.id }}
                style={{ ...catStyle(c.id), animationDelay: `${i * 70}ms` }}
                className="asphalt-panel group relative flex animate-rise flex-col items-start gap-4 overflow-hidden rounded-2xl border border-border p-5 transition-all hover:-translate-y-1 hover:border-[color:var(--cat)]/70"
              >
                <span className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[color:var(--cat)]/10 blur-2xl transition-opacity group-hover:opacity-100" />
                <RoadSign
                  category={c.id}
                  size={56}
                  className="transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-110"
                />
                <div>
                  <div className="font-display text-base font-bold leading-tight">{c.bn}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{c.en}</div>
                </div>
                <span className="font-mono text-xs text-[color:var(--cat)]">
                  {bn(count)} রিপোর্ট →
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Feed */}
      <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">সর্বশেষ</p>
            <h2 className="mt-2 text-3xl font-extrabold sm:text-4xl">আপনার আশেপাশের ঘটনা</h2>
          </div>
          <Button asChild variant="asphalt">
            <Link to="/incidents">
              সব ঘটনা দেখুন <ArrowUpRight />
            </Link>
          </Button>
        </div>
        <CategoryFilter value={cat} onChange={setCat} className="mt-6" />
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {feed.map((i, idx) => (
            <IncidentCard key={i.id} incident={i} index={idx} />
          ))}
          {feed.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
              এই ক্যাটাগরিতে এখনো কোনো রিপোর্ট নেই।
            </div>
          )}
        </div>
        <p className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
          <Scale className="h-3.5 w-3.5 text-primary" /> সমর্থন ও আপত্তির সংখ্যা কমিউনিটির মতামত।
          এগুলো প্রমাণ নয়।
        </p>
      </section>

      {/* How it works — milestones on a road */}
      <section className="mx-auto max-w-7xl px-4 pt-24 sm:px-6">
        <div className="asphalt-panel relative overflow-hidden rounded-[2rem] border border-border px-6 py-12 sm:px-12">
          <div className="zebra absolute -right-10 top-0 h-full w-40 opacity-[0.06]" />
          <p className="eyebrow">কীভাবে কাজ করে</p>
          <h2 className="mt-2 max-w-xl text-3xl font-extrabold sm:text-4xl">
            তিন মাইলফলক, এক মিনিটের পথ।
          </h2>
          <div className="relative mt-12">
            <div className="lane-dash absolute left-6 right-6 top-10 hidden animate-lane-x md:block" />
            <ol className="grid gap-10 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.km} className="relative">
                  {/* kilometre stone */}
                  <div className="relative mb-6 flex h-20 w-16 flex-col overflow-hidden rounded-t-full border-2 border-paint/80 bg-paint text-primary-foreground shadow-card">
                    <span className="h-7 bg-primary" />
                    <span className="grid flex-1 place-items-center font-display text-xl font-extrabold">
                      {s.km}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold">{s.title}</h3>
                  <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
                    {s.text}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Promises */}
      <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROMISES.map((p) => (
            <div key={p.title} className="rounded-2xl border border-border bg-card/60 p-6">
              <p.icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 text-lg font-bold">{p.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6">
        <div className="relative overflow-hidden rounded-[2rem] bg-primary px-6 py-14 text-primary-foreground sm:px-14">
          <div className="hazard absolute inset-x-0 top-0 h-3 opacity-90" />
          <div className="hazard absolute inset-x-0 bottom-0 h-3 opacity-90" />
          <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
            <div>
              <h2 className="text-3xl font-extrabold sm:text-5xl">চুপ থাকবেন না।</h2>
              <p className="mt-3 max-w-lg text-base opacity-80">
                আপনার একটি রিপোর্ট হয়তো কাল কাউকে বিপদ থেকে বাঁচাবে।
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="xl" variant="ink">
                <Link to="/report">
                  এখনই জানান <ArrowUpRight />
                </Link>
              </Button>
              <Button asChild size="xl" variant="ink-outline">
                <Link to="/track">
                  <Ticket /> রিপোর্ট ট্র্যাক
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
