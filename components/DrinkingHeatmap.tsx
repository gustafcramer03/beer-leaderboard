"use client";

// Drinking heatmap: a day x hour grid of beer counts (in the trip's local
// timezone), keyed on when each beer was cracked. Pure group aggregate, so it
// renders even while the board is dark. Tap a cell for its exact count.

import { useEffect, useState } from "react";
import type { Heatmap } from "@/lib/types";
import { getHeatmap } from "@/lib/api";
import { Loading } from "./Loading";

function dayLabel(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
  });
}

function hourLabel(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

// amber-600 base; alpha ramps with intensity so busier hours read darker.
function cellStyle(c: number, max: number): React.CSSProperties {
  if (c === 0 || max === 0) return {};
  const intensity = c / max;
  return { backgroundColor: `rgba(217, 119, 6, ${0.18 + 0.82 * intensity})` };
}

const GRID_COLS = "2.5rem repeat(24, minmax(0, 1fr))";

type Sel = { date: string; hour: number; count: number } | null;

export function DrinkingHeatmap({
  holidayId,
  onClose,
}: {
  holidayId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Heatmap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await getHeatmap(holidayId);
        if (active) setData(d);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load the heatmap.");
      }
    })();
    return () => {
      active = false;
    };
  }, [holidayId]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50 dark:bg-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
        <h2 className="text-lg font-bold">🔥 Drinking heatmap</h2>
        <button
          onClick={onClose}
          className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium dark:bg-neutral-700"
        >
          Done
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-md p-4">
          {error ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-600">
              {error}
            </p>
          ) : !data ? (
            <Loading label="Mapping the mayhem…" />
          ) : data.total === 0 ? (
            <div className="p-8 text-center text-neutral-500">
              <div className="mb-2 text-5xl">🔥</div>
              No beers logged yet — the heatmap fills in as the group drinks. 🍺
            </div>
          ) : (
            <HeatGrid data={data} sel={sel} setSel={setSel} />
          )}
        </div>
      </div>
    </div>
  );
}

function HeatGrid({
  data,
  sel,
  setSel,
}: {
  data: Heatmap;
  sel: Sel;
  setSel: (s: Sel) => void;
}) {
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="flex flex-col gap-4">
      {/* Readout: selected cell, else the all-trip peak */}
      <div className="rounded-2xl bg-white p-4 text-center shadow-sm dark:bg-neutral-800">
        {sel ? (
          <>
            <div className="text-3xl font-black text-amber-600 dark:text-amber-400">
              {sel.count} beer{sel.count === 1 ? "" : "s"}
            </div>
            <div className="mt-0.5 text-xs text-neutral-500">
              {dayLabel(sel.date)} · {hourLabel(sel.hour)}–{hourLabel((sel.hour + 1) % 24)}
            </div>
            <button
              onClick={() => setSel(null)}
              className="mt-2 text-[11px] font-medium text-amber-600 underline dark:text-amber-400"
            >
              show busiest hour
            </button>
          </>
        ) : data.peak ? (
          <>
            <div className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Busiest hour 🍺
            </div>
            <div className="mt-1 text-lg font-bold">
              {dayLabel(data.peak.date)} · {hourLabel(data.peak.hour)}
            </div>
            <div className="mt-0.5 text-xs text-neutral-400">
              {data.peak.count} beer{data.peak.count === 1 ? "" : "s"} cracked · tap any cell for detail
            </div>
          </>
        ) : null}
      </div>

      {/* The grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[320px]">
          {/* Hour axis (label every 6h to avoid clutter) */}
          <div className="grid items-end gap-px pb-1" style={{ gridTemplateColumns: GRID_COLS }}>
            <div />
            {hours.map((h) => (
              <div key={h} className="text-center text-[8px] leading-none text-neutral-400">
                {h % 6 === 0 ? h : ""}
              </div>
            ))}
          </div>

          {/* One row per day */}
          <div className="flex flex-col gap-px">
            {data.days.map((day) => (
              <div key={day.date} className="grid gap-px" style={{ gridTemplateColumns: GRID_COLS }}>
                <div className="flex items-center pr-1 text-[10px] font-medium text-neutral-500">
                  {dayLabel(day.date)}
                </div>
                {day.counts.map((c, h) => {
                  const isSel = !!sel && sel.date === day.date && sel.hour === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setSel(c > 0 ? { date: day.date, hour: h, count: c } : null)}
                      className={`h-5 rounded-[2px] bg-neutral-100 transition dark:bg-neutral-800 ${
                        isSel ? "ring-2 ring-amber-500 ring-offset-1 dark:ring-offset-neutral-900" : ""
                      }`}
                      style={cellStyle(c, data.max)}
                      aria-label={`${dayLabel(day.date)} ${hourLabel(h)}: ${c} beers`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-2 text-[11px] text-neutral-400">
        <span>Less</span>
        <div className="flex gap-px">
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <div
              key={t}
              className="h-3 w-5 rounded-[2px] bg-neutral-100 dark:bg-neutral-800"
              style={t === 0 ? {} : { backgroundColor: `rgba(217, 119, 6, ${0.18 + 0.82 * t})` }}
            />
          ))}
        </div>
        <span>More</span>
      </div>

      <p className="text-center text-[11px] text-neutral-400">
        Each cell is one hour, by when a beer was cracked ({data.tz.replace(/_/g, " ")} time). Counts
        every audited beer.
      </p>
    </div>
  );
}
