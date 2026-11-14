import { useEffect, useId, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (target: string | HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_ID = "cloudflare-turnstile-script";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise<NonNullable<Window["turnstile"]>>((resolve, reject) => {
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const ready = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("Turnstile did not initialize"));
    };
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", ready, { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load")), {
      once: true,
    });
    if (script.dataset["loaded"] === "true") ready();
    else
      script.addEventListener("load", () => (script!.dataset["loaded"] = "true"), { once: true });
  });
}

interface TurnstileProps {
  onToken: (token: string | null) => void;
  resetKey?: number;
  className?: string;
}

export function Turnstile({ onToken, resetKey = 0, className }: TurnstileProps) {
  const reactId = useId();
  const targetId = `turnstile-${reactId.replace(/:/g, "")}`;
  const widgetId = useRef<string | null>(null);
  const callback = useRef(onToken);
  callback.current = onToken;

  useEffect(() => {
    let cancelled = false;
    const sitekey = (import.meta.env["VITE_TURNSTILE_SITE_KEY"] as string | undefined)?.trim();
    if (!sitekey) {
      callback.current(null);
      return;
    }
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return;
        widgetId.current = turnstile.render(`#${targetId}`, {
          sitekey,
          theme: "auto",
          language: "bn",
          callback: (token: string) => callback.current(token),
          "expired-callback": () => callback.current(null),
          "error-callback": () => callback.current(null),
        });
      })
      .catch(() => callback.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [targetId]);

  useEffect(() => {
    if (widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
      callback.current(null);
    }
  }, [resetKey]);

  return <div id={targetId} className={className} />;
}
