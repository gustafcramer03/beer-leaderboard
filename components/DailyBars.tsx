"use client";

// Daily tally: a grouped bar chart of YOUR beers finished each day next to the
// GROUP AVERAGE for that day, for every beer-day from the trip start up to
// today. Your bar is the accent colour, the group average is muted. Tap a day
// for its exact numbers.

import { useEffect, useState } from "react";
import type { DailyBars as DailyBarsData } from "@/lib/types";
import { getDailyBars } from "@/lib/api";
import { Loading } from "./Loading";
import { ErrorBox } from "./ErrorBox";

function dayLabel(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric" });
}
function fullDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

export function DailyBars({ holidayId, onClose }: { holidayId: string; onClose: () => void }) {
  const [data, setData] = useState<DailyBarsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await getDailyBars(holidayId);
        if (active) setData(d);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load the daily tally.");
      }
    })();
    return () => {
      active = false;
    };
  }, [holidayId]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-sunken">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 className="font-display text-lg font-bold">📊 Daily tally</h2>
        <button
          onClick={onClose}
          className="press rounded-full bg-surface-muted px-4 py-2 text-sm font-medium"
        >
          Done
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-md p-4">
          {error ? (
            <ErrorBox>{error}</ErrorBox>
          ) : !data ? (
            <Loading label="Counting the rounds…" />
          ) : data.group_total === 0 ? (
            <div className="p-8 text-center text-muted">
              <div className="mb-2 text-5xl">📊</div>
              No beers logged yet — your daily tally fills in as the trip gets going. 🍺
            </div>
          ) : (
            <Chart data={data} sel={sel} setSel={setSel} />
          )}
        </div>
      </div>
    </div>
  );
}

function Chart({
  data,
  sel,
  setSel,
}: {
  data: DailyBarsData;
  sel: number | null;
  setSel: (s: number | null) => void;
}) {
  const max = Math.max(1, ...data.days.map((d) => Math.max(d.mine, d.avg)));
  const dayCount = data.days.length || 1;
  const myPerDay = data.my_total / dayCount;
  const groupPerDay = data.members > 0 ? data.group_total / data.members / dayCount : 0;
  const selDay = sel !== null ? data.days[sel] : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Readout: selected day, else your trip-so-far summary */}
      <div className="rounded-2xl bg-surface p-4 text-center shadow-card">
        {selDay ? (
          <>
            <div className="text-xs font-semibold uppercase tracking-wide text-faint">
              {fullDate(selDay.date)}
            </div>
            <div className="mt-2 flex justify-center gap-8">
              <div>
                <div className="text-3xl font-black text-accent">{selDay.mine}</div>
                <div className="text-[11px] text-faint">you</div>
              </div>
              <div>
                <div className="text-3xl font-black text-text">{selDay.avg.toFixed(1)}</div>
                <div className="text-[11px] text-faint">group avg</div>
              </div>
            </div>
            <button
              onClick={() => setSel(null)}
              className="mt-2 text-[11px] font-medium text-accent underline"
            >
              show trip summary
            </button>
          </>
        ) : (
          <>
            <div className="text-xs font-semibold uppercase tracking-wide text-faint">
              Your trip so far
            </div>
            <div className="mt-1 text-lg font-bold">
              {data.my_total} beer{data.my_total === 1 ? "" : "s"} · {myPerDay.toFixed(1)}/day
            </div>
            <div className="mt-0.5 text-xs text-faint">
              Group average {groupPerDay.toFixed(1)}/day · tap a day for detail
            </div>
          </>
        )}
      </div>

      {/* Grouped bars: one column per day (you vs group avg) */}
      <div className="overflow-x-auto pb-1">
        <div className="flex items-end justify-center gap-2">
          {data.days.map((d, i) => {
            const isSel = sel === i;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => setSel(isSel ? null : i)}
                className={`flex flex-none flex-col items-center gap-1 rounded-lg px-1 pt-1 transition ${
                  isSel ? "bg-surface-muted" : ""
                }`}
                aria-label={`${fullDate(d.date)}: you ${d.mine}, group average ${d.avg.toFixed(1)}`}
              >
                <div className="flex h-40 items-end gap-0.5">
                  <div
                    className="w-3 rounded-t bg-accent transition-all"
                    style={{ height: `${Math.max(d.mine > 0 ? 4 : 0, (d.mine / max) * 100)}%` }}
                  />
                  <div
                    className="w-3 rounded-t bg-line transition-all"
                    style={{ height: `${Math.max(d.avg > 0 ? 4 : 0, (d.avg / max) * 100)}%` }}
                  />
                </div>
                <span className={`text-[9px] ${isSel ? "font-semibold text-accent" : "text-faint"}`}>
                  {dayLabel(d.date)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-accent" /> You
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-line" /> Group average
        </span>
      </div>

      <p className="text-center text-[11px] text-faint">
        Beers finished each day (7am–7am, {data.tz.replace(/_/g, " ")} time). Group average = the
        day&apos;s total ÷ {data.members} player{data.members === 1 ? "" : "s"}.
      </p>
    </div>
  );
}
