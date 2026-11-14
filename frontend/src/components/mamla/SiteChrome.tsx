import { Link } from "@tanstack/react-router";
import { House, List, Map, Plus, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "./Logo";

const NAV = [
  { to: "/", label: "হোম", short: "হোম", icon: House },
  { to: "/map", label: "লাইভ ম্যাপ", short: "ম্যাপ", icon: Map },
  { to: "/incidents", label: "সব ঘটনা", short: "ঘটনা", icon: List },
  { to: "/track", label: "রিপোর্ট ট্র্যাক", short: "ট্র্যাক", icon: Ticket },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="মূল মেনু">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="group relative rounded-lg px-3.5 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground data-[status=active]:text-foreground"
            >
              {n.label}
              <span className="lane-dash absolute inset-x-3 -bottom-[13px] h-[3px] origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100 group-data-[status=active]:scale-x-100" />
            </Link>
          ))}
        </nav>
        <Button asChild variant="road" className="hidden sm:inline-flex">
          <Link to="/report">
            <Plus /> ঘটনা জানান
          </Link>
        </Button>
      </div>
    </header>
  );
}

export function MobileDock() {
  const items = [NAV[0], NAV[1], null, NAV[2], NAV[3]];
  return (
    <nav
      className="fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-border bg-popover/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-card backdrop-blur-xl md:hidden"
      aria-label="মোবাইল মেনু"
    >
      <ul className="grid grid-cols-5 items-end">
        {items.map((n, i) =>
          n ? (
            <li key={n.to}>
              <Link
                to={n.to}
                activeOptions={{ exact: n.to === "/" }}
                className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold text-muted-foreground data-[status=active]:text-primary"
              >
                <n.icon className="h-5 w-5" />
                {n.short}
              </Link>
            </li>
          ) : (
            <li key={i} className="flex justify-center">
              <Link
                to="/report"
                aria-label="ঘটনা জানান"
                className="-mt-6 mb-2 grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-glow ring-4 ring-background"
              >
                <Plus className="h-6 w-6" strokeWidth={3} />
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative mt-24 border-t border-border pb-28 md:pb-10">
      <div className="lane-dash absolute inset-x-0 -top-[2px] opacity-70" />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            বাংলাদেশের রাস্তার ঘটনা নাম-পরিচয় ছাড়া জানানোর প্ল্যাটফর্ম। কমিউনিটির মতামত দেখায়,
            সত্য-মিথ্যার রায় দেয় না।
          </p>
        </div>
        <div>
          <h4 className="mb-3 font-display text-sm font-bold text-foreground">এক্সপ্লোর</h4>
          <ul className="space-y-2 text-sm">
            {NAV.map((n) => (
              <li key={n.to}>
                <Link to={n.to} className="hover:text-primary">
                  {n.label}
                </Link>
              </li>
            ))}
            <li>
              <Link to="/report" className="hover:text-primary">
                নতুন ঘটনা জানান
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h4 className="mb-3 font-display text-sm font-bold text-foreground">আমাদের অঙ্গীকার</h4>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>কোনো অ্যাকাউন্ট বা লগইন নেই</li>
            <li>IP ঠিকানা সংরক্ষণ করা হয় না</li>
            <li>ফ্ল্যাগে স্বয়ংক্রিয়ভাবে কিছু মুছে যায় না</li>
            <li>মডারেশন করেন মানুষ, মেশিন না</li>
          </ul>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground sm:px-6">
        <span>© ২০২৬ Team Epsilon · Mamladibe V1</span>
        <span>Dhaka · Bangladesh</span>
      </div>
    </footer>
  );
}
