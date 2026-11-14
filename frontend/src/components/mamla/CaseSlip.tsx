import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, Copy, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { categoryById, formatDateTime, type Incident } from "@/lib/incidents";
import { RoadSign } from "./RoadSign";

function CopyField({
  label,
  value,
  mono = true,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  const [done, setDone] = useState(false);
  return (
    <div
      className={
        highlight
          ? "rounded-xl border-2 border-dashed border-primary bg-primary/10 p-4"
          : "rounded-xl border border-border bg-background/60 p-4"
      }
    >
      <div className="text-xs font-semibold text-muted-foreground">{label}</div>
      <div className="mt-1.5 flex items-center justify-between gap-3">
        <span
          className={`${mono ? "font-mono" : ""} break-all text-xl font-bold tracking-wider sm:text-2xl`}
        >
          {value}
        </span>
        <Button
          variant="asphalt"
          size="icon"
          aria-label={`${label} কপি করুন`}
          onClick={async () => {
            await navigator.clipboard?.writeText(value).catch(() => undefined);
            setDone(true);
            toast.success("কপি হয়েছে");
            setTimeout(() => setDone(false), 1500);
          }}
        >
          {done ? <Check className="text-signal-green" /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}

export function CaseSlip({ incident, secret }: { incident: Incident; secret: string }) {
  const download = () => {
    const body = `MAMLADIBE — রিপোর্ট স্লিপ\n\nTracking ID: ${incident.trackingId}\nSecret: ${secret}\n\nশিরোনাম: ${incident.title}\nপ্রকাশ: ${formatDateTime(incident.createdAt)}\n\nSecret টি হারালে আর ফেরত পাওয়া যাবে না।\n১৫ মিনিটের মধ্যে বানান সংশোধন করা যাবে।`;
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `mamladibe-${incident.trackingId}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-xl animate-rise">
      <div className="relative overflow-hidden rounded-[1.75rem] bg-card shadow-card">
        <div className="hazard h-3" />
        <div className="relative p-6 sm:p-8">
          <div className="absolute right-6 top-8 rotate-12 rounded-lg border-4 border-signal-green px-3 py-1 font-mono text-sm font-bold uppercase tracking-[0.2em] text-signal-green opacity-80">
            Published
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
            Mamladibe · Case slip
          </div>
          <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">মামলা দায়ের হয়েছে!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            আপনার রিপোর্ট এখনই সবার জন্য প্রকাশিত।
          </p>
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-background/50 p-3">
            <RoadSign category={incident.category} size={40} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{incident.title}</div>
              <div className="text-xs text-muted-foreground">
                {categoryById(incident.category).bn} · {incident.areaName}
              </div>
            </div>
          </div>
        </div>
        <div className="perforated h-5 border-y border-dashed border-border" />
        <div className="space-y-3 p-6 sm:p-8">
          <CopyField label="Tracking ID · পাবলিক" value={incident.trackingId} />
          <CopyField label="Secret · একান্ত গোপন" value={secret} highlight />
          <div className="flex gap-3 rounded-xl bg-destructive/10 p-4 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0 text-flag" />
            <p>
              এই Secret শুধু একবারই দেখানো হচ্ছে। হারালে আর ফেরত পাওয়া যাবে না। এখনই কপি বা ডাউনলোড
              করে রাখুন।
            </p>
          </div>
          <Button variant="road" size="lg" className="w-full" onClick={download}>
            <Download /> স্লিপ ডাউনলোড করুন
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Button asChild variant="asphalt">
              <Link to="/incidents/$id" params={{ id: incident.id }}>
                রিপোর্ট দেখুন
              </Link>
            </Button>
            <Button asChild variant="asphalt">
              <Link to="/track">ট্র্যাক করুন</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
