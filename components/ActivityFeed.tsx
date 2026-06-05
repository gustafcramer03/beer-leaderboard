"use client";

import { useCallback, useEffect, useState } from "react";
import { getActivityFeed } from "@/lib/api";
import type { ActivityEvent } from "@/lib/types";
import { Avatar } from "./Avatar";
import { SkeletonCards } from "./Loading";

// Live "what's happening" ticker — only the bigger moments (never every beer).
// Reverse-chron, polls every 45s and on window focus so the trip feels alive
// between board refreshes. Hidden while the board is dark for non-admins.
export function ActivityFeed({
  holidayId,
  timezone,
  onClose,
}: {
  holidayId: string;
  timezone: string;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [dark, setDark] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getActivityFeed(holidayId, 80);
      if (res.events === null) {
        setDark(true);
        setEvents(null);
      } else {
        setDark(false);
        setEvents(res.events);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the feed");
    } finally {
      setLoading(false);
    }
  }, [holidayId]);

  useEffect(() => {
    let active = true;
    load();
    const id = setInterval(() => active && load(), 45_000);
    const onFocus = () => active && load();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-sunken">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 className="text-lg font-bold">📰 What&apos;s happening</h2>
        <button
          onClick={onClose}
          className="press rounded-full bg-surface-muted px-4 py-2 text-sm font-medium"
        >
          Done
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-md flex-col gap-2 p-4">
          {loading && events === null && !dark && <SkeletonCards count={5} />}

          {error && <p className="p-6 text-center text-sm text-red-600">{error}</p>}

          {dark && (
            <p className="p-8 text-center text-sm text-muted">
              🌑 The board is dark — the feed is hidden until the reveal.
            </p>
          )}

          {!dark && !error && events && events.length === 0 && (
            <p className="p-8 text-center text-sm text-muted">
              Nothing big yet — go make some history. 🍺
            </p>
          )}

          {!dark &&
            events &&
            events.map((e, i) => (
              <FeedRow key={`${e.type}-${e.user_id}-${e.at}-${i}`} e={e} tz={timezone} />
            ))}
        </div>
      </div>
    </div>
  );
}

function FeedRow({ e, tz }: { e: ActivityEvent; tz: string }) {
  const { emoji, text } = describe(e, tz);
  const isAnnouncement = e.type === "happy_hour_start" || e.type === "happy_hour_end";

  // Player-less happy-hour window banners get their own punchy styling.
  if (isAnnouncement) {
    const live = e.type === "happy_hour_start";
    return (
      <div
        className={`flex items-center gap-3 rounded-2xl p-3 shadow-sm ${
          live
            ? "bg-gradient-to-r from-amber-400 to-yellow-500 text-white"
            : "bg-accent-soft"
        }`}
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/25 text-2xl">
          {emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-snug">{text}</p>
          <p className={`text-[11px] ${live ? "text-amber-50/80" : "text-faint"}`}>
            {relativeTime(e.at)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card flex items-center gap-3 p-3">
      <div className="relative shrink-0">
        <Avatar path={e.avatar_path} size={44} />
        <span className="absolute -bottom-1 -right-1 text-lg drop-shadow-sm">{emoji}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-bold">{e.display_name}</span> {text}
        </p>
        <p className="text-[11px] text-faint">{relativeTime(e.at)}</p>
      </div>
    </div>
  );
}

// Per-type emoji + phrasing. `n` carries the type-specific number. `tz` is the
// trip timezone, used to print happy-hour window times in trip-local time.
function describe(e: ActivityEvent, tz: string): { emoji: string; text: string } {
  switch (e.type) {
    case "chug":
      return { emoji: "⚡", text: "chugged a beer!" };
    case "early_bird":
      return { emoji: "🐦", text: "grabbed Early Bird — first of the day." };
    case "night_owl":
      return { emoji: "🌙", text: "took Night Owl — last one standing." };
    case "happy_hour_start": {
      const start = new Date(e.at);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      return {
        emoji: "🍻",
        text: `Happy hour is ON, ${hour(start, tz)}–${hour(end, tz)} — GO QUENCH YOUR THIRST! 🍻`,
      };
    }
    case "happy_hour_end":
      return {
        emoji: "🍻",
        text: `Happy hour's over — ${e.n ?? 0} ${e.n === 1 ? "beer" : "beers"} sunk! 🍻`,
      };
    case "chain":
      return { emoji: "🔥", text: `finished a ${e.n}-beer chain!` };
    case "day_milestone":
      return { emoji: "🍺", text: `hit ${e.n} beers in a day.` };
    case "trip_milestone":
      return { emoji: "🏅", text: `reached ${e.n} beers this trip!` };
    case "lead":
      return { emoji: "👑", text: `took the lead — now on ${e.n} pts.` };
    case "legend":
      return { emoji: "🏆", text: `was crowned Legend of the Day (${e.n} 🍺).` };
    case "first_blood":
      return { emoji: "🩸", text: "drew first blood — the trip's very first beer!" };
    default:
      return { emoji: "🍺", text: "did something noteworthy." };
  }
}

// A whole-hour clock label in the trip's timezone, e.g. "5pm", "10pm", "9am".
function hour(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: true, timeZone: tz })
      .format(d)
      .replace(/\s/g, "")
      .toLowerCase();
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: true })
      .format(d)
      .replace(/\s/g, "")
      .toLowerCase();
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
