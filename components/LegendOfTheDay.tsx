"use client";

import { useEffect, useState } from "react";
import { getLegendOfTheDay } from "@/lib/api";
import type { LegendOfTheDay as LegendData } from "@/lib/types";
import { Avatar } from "./Avatar";
import { celebrateBig } from "@/lib/celebrate";

// Once-a-day celebratory card crowning yesterday's top drinker. Fetches on
// mount; shows only if there's a legend and we haven't already shown today's
// (gated in localStorage on the server-provided `today` date, so it's tied to
// the trip's timezone rather than the device clock).
export function LegendOfTheDay({ holidayId }: { holidayId: string }) {
  const [data, setData] = useState<LegendData | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let active = true;
    getLegendOfTheDay(holidayId)
      .then((d) => {
        if (!active || !d.legend) return;
        if (localStorage.getItem(`legend-seen-${holidayId}`) === d.today) return;
        setData(d);
        setShow(true);
        celebrateBig();
      })
      .catch(() => {
        /* best-effort; never block the app on the legend card */
      });
    return () => {
      active = false;
    };
  }, [holidayId]);

  function dismiss() {
    if (data) localStorage.setItem(`legend-seen-${holidayId}`, data.today);
    setShow(false);
  }

  if (!show || !data?.legend) return null;
  const l = data.legend;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs overflow-hidden rounded-3xl bg-white text-center shadow-2xl dark:bg-neutral-800"
      >
        <div className="bg-gradient-to-b from-amber-400 to-yellow-500 px-6 pb-5 pt-6 text-white">
          <div className="text-5xl">👑</div>
          <h2 className="mt-1 text-lg font-black uppercase tracking-wide">Legend of the Day</h2>
          <p className="text-xs text-amber-50/90">Most beers sunk yesterday</p>
        </div>

        <div className="flex flex-col items-center gap-2 px-6 py-6">
          <Avatar path={l.avatar_path} size={112} className="ring-4 ring-amber-300" />
          <div className="text-xl font-bold">{l.display_name}</div>
          <div className="text-3xl font-black text-amber-500">
            {l.beer_count} <span className="text-2xl">🍺</span>
          </div>
          <button
            onClick={dismiss}
            className="mt-3 w-full rounded-full bg-amber-500 py-3 font-semibold text-white active:scale-[0.99]"
          >
            Cheers! 🍻
          </button>
        </div>
      </div>
    </div>
  );
}
