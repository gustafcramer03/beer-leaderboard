"use client";

// The trophy cabinet: a Snapchat-trophies-style grid of awards the player has
// won. Each tile shows the trophy emoji, how many times it's been earned
// (e.g. 2x), and a one-line description of how it's won. Locked trophies are
// greyed out so you can see what's still up for grabs. Opened from the Menu.

import { useEffect, useState } from "react";
import type { Achievements } from "@/lib/types";
import { getAchievements } from "@/lib/api";
import { Loading } from "./Loading";

// The trophy catalogue. Add a row here + the matching count in the
// user_achievements RPC to introduce a new trophy.
const TROPHIES: { key: string; emoji: string; label: string; how: string }[] = [
  { key: "centurion", emoji: "💯", label: "Centurion", how: "100 beers logged" },
  { key: "legend_of_day", emoji: "👑", label: "Legend of the Day", how: "Most beers in a single day" },
  { key: "early_bird", emoji: "🐦", label: "Early Bird", how: "First to finish that day" },
  { key: "night_owl", emoji: "🌙", label: "Night Owl", how: "Last to finish, after midnight" },
  { key: "chug_master", emoji: "⚡", label: "Chug Master", how: "10 chugs downed" },
  { key: "breakfast_club", emoji: "☀️", label: "Breakfast Club", how: "5 morning beers" },
];

function TrophyTile({
  emoji,
  label,
  how,
  count,
}: {
  emoji: string;
  label: string;
  how: string;
  count: number;
}) {
  const won = count > 0;
  return (
    <div
      className={`relative flex flex-col items-center gap-1 rounded-2xl p-3 text-center shadow-sm transition ${
        won
          ? "bg-white dark:bg-neutral-800"
          : "bg-neutral-100 dark:bg-neutral-800/40"
      }`}
    >
      {won && (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
          {count}×
        </span>
      )}
      <span className={`text-4xl ${won ? "" : "opacity-25 grayscale"}`}>{emoji}</span>
      <span className={`text-xs font-bold leading-tight ${won ? "" : "text-neutral-400"}`}>
        {label}
      </span>
      <span className="text-[10px] leading-tight text-neutral-400">{how}</span>
    </div>
  );
}

export function AchievementsCabinet({
  holidayId,
  userId,
  onClose,
}: {
  holidayId: string;
  userId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Achievements | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const a = await getAchievements(holidayId, userId);
        if (active) setData(a);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load trophies.");
      }
    })();
    return () => {
      active = false;
    };
  }, [holidayId, userId]);

  const wonCount = data
    ? TROPHIES.reduce((n, t) => n + ((data[t.key] ?? 0) > 0 ? 1 : 0), 0)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50 dark:bg-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
        <h2 className="text-lg font-bold">🏅 Trophy cabinet</h2>
        <button
          onClick={onClose}
          className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium dark:bg-neutral-700"
        >
          Done
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-md flex-col gap-4">
          {error ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-600">
              {error}
            </p>
          ) : !data ? (
            <Loading label="Polishing the silverware…" />
          ) : (
            <>
              <div className="rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 p-4 text-center text-white shadow">
                <div className="text-3xl font-black">
                  {wonCount}
                  <span className="text-xl font-bold">/{TROPHIES.length}</span>
                </div>
                <div className="mt-0.5 text-sm font-semibold">trophies unlocked 🏆</div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {TROPHIES.map((t) => (
                  <TrophyTile
                    key={t.key}
                    emoji={t.emoji}
                    label={t.label}
                    how={t.how}
                    count={data[t.key] ?? 0}
                  />
                ))}
              </div>

              <p className="text-center text-xs text-neutral-400">
                Trophies count audited beers and update as the trip goes on. 🍻
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
