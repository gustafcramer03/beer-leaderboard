"use client";

// A celebratory banner shown when the app loads DURING the trip's happy hour:
// for that one hour each day, every beer's base value is doubled (+1). It checks
// once on mount and slides in from the top; the user can dismiss it. We remember
// the dismissal for the current hour (sessionStorage) so it doesn't nag on every
// tab switch, but it returns the next day / next happy hour.

import { useEffect, useState } from "react";
import { happyHourNow } from "@/lib/api";

function fmtHour(h: number): string {
  // 24h local hour → friendly 12h label (e.g. 14 → "2pm", 23 → "11pm").
  const hour = ((h % 24) + 24) % 24;
  const period = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${period}`;
}

export function HappyHourBanner({ holidayId }: { holidayId: string }) {
  const [info, setInfo] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const s = await happyHourNow(holidayId);
        if (!active || !s.active) return;
        // One dismissal per (holiday, start hour) so it won't reappear all hour.
        const key = `hh-dismissed-${holidayId}-${s.start_hour}`;
        if (sessionStorage.getItem(key)) return;
        setInfo({ start: s.start_hour, end: s.end_hour });
      } catch {
        /* ignore — banner is non-critical */
      }
    })();
    return () => {
      active = false;
    };
  }, [holidayId]);

  if (!info) return null;

  function dismiss() {
    if (info) sessionStorage.setItem(`hh-dismissed-${holidayId}-${info.start}`, "1");
    setInfo(null);
  }

  return (
    <div className="fixed inset-x-0 top-0 z-[55] flex justify-center px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl bg-gradient-to-r from-pink-500 to-amber-500 px-4 py-3 text-white shadow-xl">
        <span className="text-3xl">🍻</span>
        <div className="flex-1">
          <p className="text-sm font-black">⏰ It&apos;s Happy Hour!</p>
          <p className="text-xs text-white/90">
            Until {fmtHour(info.end)} every beer is worth double — get drinking! 🍺×2
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-full bg-white/25 px-2.5 py-1 text-sm font-bold"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
