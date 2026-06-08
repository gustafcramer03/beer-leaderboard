"use client";

import { useCallback, useEffect, useState } from "react";
import { getDailyRecap } from "@/lib/api";
import type { DailyRecap as RecapData } from "@/lib/types";
import { Avatar } from "./Avatar";
import { Loading } from "./Loading";
import { celebrateBig } from "@/lib/celebrate";

// Daily recap: a once-a-day wrap-up of the beer-day that just ended (07:00 ->
// 07:00 in the trip tz). Two entry points share the inner RecapBody:
//   <DailyRecapPopup>  — auto-pops on first open each day (gated in localStorage
//                        on the server's `today`), fires confetti, dismissable.
//   <DailyRecapView>   — a full-screen Menu view, always available on demand.

// Pretty day label from a YYYY-MM-DD string, anchored at noon so the date never
// slips across a timezone boundary.
function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

// ---- auto-popup -----------------------------------------------------------

export function DailyRecapPopup({ holidayId }: { holidayId: string }) {
  const [data, setData] = useState<RecapData | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let active = true;
    getDailyRecap(holidayId)
      .then((d) => {
        if (!active || !d.recap) return;
        if (localStorage.getItem(`recap-seen-${holidayId}`) === d.today) return;
        setData(d);
        setShow(true);
        celebrateBig();
      })
      .catch(() => {
        /* best-effort; never block the app on the recap */
      });
    return () => {
      active = false;
    };
  }, [holidayId]);

  function dismiss() {
    if (data) localStorage.setItem(`recap-seen-${holidayId}`, data.today);
    setShow(false);
  }

  if (!show || !data?.recap) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-xs overflow-y-auto rounded-3xl bg-surface shadow-2xl"
      >
        <RecapBody recap={data.recap} date={data.date} />
        <div className="px-5 pb-5">
          <button
            onClick={dismiss}
            className="press w-full rounded-full bg-accent py-3 font-semibold text-accent-contrast"
          >
            Cheers! 🍻
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- full-screen Menu view ------------------------------------------------

export function DailyRecapView({
  holidayId,
  onClose,
}: {
  holidayId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<RecapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getDailyRecap(holidayId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the recap");
    } finally {
      setLoading(false);
    }
  }, [holidayId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-sunken">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 className="font-display text-lg font-bold">🌅 Daily recap</h2>
        <button
          onClick={onClose}
          className="press rounded-full bg-surface-muted px-4 py-2 text-sm font-medium"
        >
          Done
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-sm p-4">
          {loading && <Loading label="Pouring over yesterday…" />}

          {error && <p className="p-6 text-center text-sm text-bad">{error}</p>}

          {!loading && !error && data && data.recap === null && (
            <p className="p-8 text-center text-sm text-muted">
              {data.today
                ? "Nothing to recap yet — yesterday was a dry day, or the board's still under wraps. 🍺"
                : "Nothing to recap yet. 🍺"}
            </p>
          )}

          {!loading && !error && data?.recap && (
            <div className="overflow-hidden rounded-3xl bg-surface shadow-card">
              <RecapBody recap={data.recap} date={data.date} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- shared body ----------------------------------------------------------

function RecapBody({ recap, date }: { recap: NonNullable<RecapData["recap"]>; date: string }) {
  const c = recap.champion;
  return (
    <div>
      <div className="bg-gradient-to-b from-amber-400 to-yellow-500 px-6 pb-5 pt-6 text-center text-white">
        <div className="text-5xl">🌅</div>
        <h2 className="mt-1 font-display text-lg font-black uppercase tracking-wide">Daily recap</h2>
        <p className="text-xs text-amber-50/90">{dayLabel(date)}</p>
        <p className="mt-3 text-4xl font-black">
          {recap.total_beers} <span className="text-2xl">🍺</span>
        </p>
        <p className="text-xs text-amber-50/90">
          beer{recap.total_beers === 1 ? "" : "s"} sunk by the group
        </p>
      </div>

      <div className="flex flex-col gap-3 px-5 py-5">
        {/* Champion */}
        <div className="flex items-center gap-3 rounded-2xl bg-accent-soft p-3">
          <div className="relative shrink-0">
            <Avatar path={c.avatar_path} size={52} className="ring-2 ring-accent/40" />
            <span className="absolute -bottom-1 -right-1 text-xl drop-shadow-sm">👑</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
              Legend of the Day
            </p>
            <p className="truncate font-bold">{c.display_name}</p>
            <p className="text-xs text-muted">
              {c.beer_count} beer{c.beer_count === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        {/* Honours grid */}
        <div className="grid grid-cols-2 gap-3">
          <Honour
            emoji="🐦"
            label="Early Bird"
            name={recap.early_bird?.display_name}
            avatar={recap.early_bird?.avatar_path ?? null}
            has={!!recap.early_bird}
            sub="first of the day"
          />
          <Honour
            emoji="🌙"
            label="Night Owl"
            name={recap.night_owl?.display_name}
            avatar={recap.night_owl?.avatar_path ?? null}
            has={!!recap.night_owl}
            sub="last one standing"
          />
          <Honour
            emoji="⚡"
            label="Fastest Chug"
            name={recap.fastest_chug?.display_name}
            avatar={recap.fastest_chug?.avatar_path ?? null}
            has={!!recap.fastest_chug}
            sub={
              recap.fastest_chug ? `${recap.fastest_chug.seconds}s` : undefined
            }
          />
          <Honour
            emoji="🔥"
            label="Longest Chain"
            name={recap.longest_chain?.display_name}
            avatar={recap.longest_chain?.avatar_path ?? null}
            has={!!recap.longest_chain}
            sub={
              recap.longest_chain ? `${recap.longest_chain.length} in a row` : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

function Honour({
  emoji,
  label,
  name,
  avatar,
  has,
  sub,
}: {
  emoji: string;
  label: string;
  name?: string;
  avatar: string | null;
  has: boolean;
  sub?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl bg-surface-muted p-3 text-center">
      <div className="relative">
        {has ? (
          <Avatar path={avatar} size={40} />
        ) : (
          <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-muted text-lg">
            —
          </span>
        )}
        <span className="absolute -bottom-1 -right-1 text-base drop-shadow-sm">{emoji}</span>
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</p>
      {has ? (
        <>
          <p className="w-full truncate text-sm font-bold leading-tight">{name}</p>
          {sub && <p className="text-[11px] text-muted">{sub}</p>}
        </>
      ) : (
        <p className="text-xs text-faint">nobody</p>
      )}
    </div>
  );
}
