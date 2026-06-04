"use client";

// The Stats tab: group-level highlights from the trip. Group totals are always
// shown; per-player superlatives are hidden during the dark window.

import { useEffect, useState } from "react";
import type { TripStats as TripStatsT } from "@/lib/types";
import { tripStats } from "@/lib/api";
import { Loading } from "./Loading";

function fmtHour(h: number) {
  const a = String(h).padStart(2, "0");
  const b = String((h + 1) % 24).padStart(2, "0");
  return `${a}:00–${b}:00`;
}

function fmtDay(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function fmtDur(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function StatCard({
  icon,
  value,
  label,
  sub,
  className = "",
}: {
  icon: string;
  value: React.ReactNode;
  label: string;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-800 ${className}`}>
      <span className="text-2xl">{icon}</span>
      <span className="text-2xl font-bold leading-tight">{value}</span>
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      {sub && <span className="text-[11px] text-neutral-400">{sub}</span>}
    </div>
  );
}

const HIDDEN = <span className="text-neutral-400">🌑 Hidden</span>;

export function TripStats({ holidayId }: { holidayId: string }) {
  const [stats, setStats] = useState<TripStatsT | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await tripStats(holidayId);
        if (active) setStats(data);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load stats.");
      }
    })();
    return () => {
      active = false;
    };
  }, [holidayId]);

  if (error) {
    return (
      <p className="m-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-600">
        {error}
      </p>
    );
  }
  if (!stats) return <Loading label="Adding up the rounds…" />;

  const dark = stats.state === "dark";

  if (stats.total_beers === 0) {
    return (
      <div className="p-8 text-center text-neutral-500">
        <div className="mb-2 text-5xl">📊</div>
        No beers logged yet — stats will fill in as the trip gets going. 🍻
      </div>
    );
  }

  const avgPerDay =
    stats.members > 0 && stats.active_days > 0
      ? stats.total_beers / stats.members / stats.active_days
      : 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 p-5 text-center text-white shadow">
        <div className="text-5xl font-black">{stats.total_beers}</div>
        <div className="mt-1 text-sm font-semibold">beers sunk by the group 🍺</div>
        <div className="mt-1 text-xs text-amber-50">
          {stats.members} player{stats.members === 1 ? "" : "s"} · {stats.active_days} active day
          {stats.active_days === 1 ? "" : "s"} · {avgPerDay.toFixed(1)} per person/day
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon="⏰"
          value={stats.happiest_hour ? fmtHour(stats.happiest_hour.hour) : "—"}
          label="Happiest hour"
          sub={stats.happiest_hour ? `${stats.happiest_hour.count} beers cracked` : undefined}
        />
        <StatCard
          icon="📅"
          value={stats.happiest_day ? fmtDay(stats.happiest_day.date) : "—"}
          label="Happiest day"
          sub={stats.happiest_day ? `${stats.happiest_day.count} beers` : undefined}
        />
        <StatCard
          icon="🍺"
          value={stats.chugs}
          label="Chugs landed"
          sub="downed in 60s or less"
        />
        <StatCard
          icon="☀️"
          value={stats.morning_beers}
          label="Breakfast beers"
          sub="cracked 07:00–10:59"
        />
        <StatCard
          icon="⚡"
          value={stats.fastest_chug ? fmtDur(stats.fastest_chug.seconds) : "—"}
          label="Fastest chug"
          sub={
            stats.fastest_chug
              ? dark
                ? HIDDEN
                : `by ${stats.fastest_chug.name}`
              : undefined
          }
        />
        <StatCard
          icon="🔗"
          value={stats.longest_chain ? `${stats.longest_chain.length} in a row` : "—"}
          label="Longest chain"
          sub={
            stats.longest_chain
              ? dark
                ? HIDDEN
                : `by ${stats.longest_chain.name}`
              : undefined
          }
        />
        <StatCard
          icon="🏅"
          value={dark ? HIDDEN : stats.top_drinker ? stats.top_drinker.name : "—"}
          label="Top drinker"
          sub={!dark && stats.top_drinker ? `${stats.top_drinker.count} beers` : undefined}
        />
        <StatCard
          icon="⚖️"
          value={stats.challenges_raised}
          label="Challenges raised"
          sub={`${stats.beers_rejected} beer${stats.beers_rejected === 1 ? "" : "s"} rejected`}
        />
        <StatCard
          icon="🎯"
          value={stats.total_points}
          label="Points scored"
          sub="by the whole group"
        />
        <StatCard icon="🛜" value={stats.offline_beers} label="Logged offline" sub="no-signal beers" />
      </div>

      {dark && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-center text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          🌑 The board is dark — individual highlights are hidden until the grand reveal. The group
          totals keep counting.
        </p>
      )}

      <p className="text-center text-xs text-neutral-400">
        Counts every audited beer. Updates as more get logged.
      </p>
    </div>
  );
}
