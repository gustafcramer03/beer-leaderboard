"use client";

// Pace projection board: cumulative beer-count and points over the trip, drawn
// as a real staircase (one step per beer, on a true time axis) up to now, then
// extended as a dotted projection to the trip's end at the current daily pace.
// Two charts — the whole group, and every player side by side (toggle
// beers/points, tap a line to read its now/projected totals).

import { useEffect, useMemo, useState } from "react";
import type { PaceSeries, PaceEvent } from "@/lib/types";
import { getPaceSeries } from "@/lib/api";
import { Loading } from "./Loading";

const PALETTE = [
  "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

type Pt = { t: number; v: number };
type Series = { key: string; label: string; color: string; pts: Pt[] };

function fmtDay(ms: number) {
  return new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });
}

// Turn a series' events into staircase coordinates: flat until each beer's
// finish time, then a vertical jump. Holds the last value flat out to "now".
function staircase(pts: Pt[], startMs: number, nowMs: number) {
  const coords: [number, number][] = [[startMs, 0]];
  let prev = 0;
  for (const p of pts) {
    const t = Math.min(Math.max(p.t, startMs), nowMs);
    coords.push([t, prev]); // hold previous level up to the event
    coords.push([t, p.v]);  // step up
    prev = p.v;
  }
  coords.push([nowMs, prev]); // flat from last beer to now
  return { coords, lastV: prev };
}

// Project the current cumulative value to the trip end at the average rate so far.
function project(lastV: number, startMs: number, nowMs: number, endMs: number) {
  const elapsed = nowMs - startMs;
  const rate = elapsed > 0 ? lastV / elapsed : 0;
  const remaining = endMs - nowMs;
  const vEnd = remaining > 0 ? lastV + rate * remaining : lastV;
  return vEnd;
}

function LineChart({
  series,
  startMs,
  endMs,
  nowMs,
  mode,
}: {
  series: Series[];
  startMs: number;
  endMs: number;
  nowMs: number;
  mode: "summary" | "compare";
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const W = 340, H = 220, padL = 8, padR = 8, padT = 14, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const span = Math.max(endMs - startMs, 1);

  const computed = useMemo(() => {
    return series.map((s) => {
      const { coords, lastV } = staircase(s.pts, startMs, nowMs);
      const vEnd = project(lastV, startMs, nowMs, endMs);
      return { s, coords, lastV, vEnd };
    });
  }, [series, startMs, nowMs, endMs]);

  const yMax = useMemo(() => {
    let m = 1;
    for (const c of computed) {
      m = Math.max(m, c.vEnd, ...c.coords.map(([, v]) => v));
    }
    return m * 1.1;
  }, [computed]);

  const x = (ms: number) => padL + ((ms - startMs) / span) * innerW;
  const y = (v: number) => padT + innerH - (v / yMax) * innerH;

  const nowX = x(nowMs);
  const hasProjection = endMs > nowMs;

  const drawn = computed.map((c) => {
    const solid = c.coords.map(([t, v]) => `${x(t)},${y(v)}`).join(" ");
    const hit = [...c.coords.map(([t, v]) => `${x(t)},${y(v)}`), `${x(endMs)},${y(c.vEnd)}`].join(" ");
    return { ...c, solid, hit };
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          onPointerDown={() => setSelected(null)}
        >
          {/* baseline */}
          <line x1={padL} y1={padT + innerH} x2={W - padR} y2={padT + innerH} stroke="currentColor" strokeOpacity={0.15} />
          {/* now marker */}
          {hasProjection && (
            <line x1={nowX} y1={padT} x2={nowX} y2={padT + innerH} stroke="currentColor" strokeOpacity={0.2} strokeDasharray="2 3" />
          )}

          {drawn.map(({ s, lastV, vEnd, solid, hit }) => {
            const dim = selected && selected !== s.key;
            const sw = selected === s.key ? 3.5 : 2;
            return (
              <g key={s.key} opacity={dim ? 0.3 : 1}>
                <polyline points={solid} fill="none" stroke={s.color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />
                {hasProjection && (
                  <line x1={nowX} y1={y(lastV)} x2={x(endMs)} y2={y(vEnd)} stroke={s.color} strokeWidth={sw} strokeDasharray="4 4" strokeLinecap="round" />
                )}
                {/* current dot */}
                <circle cx={nowX} cy={y(lastV)} r={selected === s.key ? 4 : 3} fill={s.color} />
                {/* fat invisible hit line for tapping */}
                <polyline
                  points={hit}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelected((cur) => (cur === s.key ? null : s.key));
                  }}
                />
              </g>
            );
          })}
        </svg>

        {/* axis date labels */}
        <div className="flex justify-between px-1 text-[10px] text-faint">
          <span>{fmtDay(startMs)}</span>
          {hasProjection && <span>now</span>}
          <span>{fmtDay(endMs)}</span>
        </div>

        {/* selection callout */}
        {selected && (() => {
          const c = drawn.find((r) => r.s.key === selected);
          if (!c) return null;
          return (
            <div className="pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded-xl bg-neutral-900/90 px-3 py-1.5 text-center text-xs text-white shadow-lg">
              <span className="font-bold" style={{ color: c.s.color }}>{c.s.label}</span>
              <div className="mt-0.5 tabular-nums">
                now <b>{c.lastV}</b>
                {hasProjection && <> · projected <b>~{Math.round(c.vEnd)}</b></>}
              </div>
            </div>
          );
        })()}
      </div>

      {/* legend */}
      {mode === "summary" ? (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
          {drawn.map(({ s, lastV, vEnd }) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              <span className="font-medium">{s.label}:</span>
              <span className="tabular-nums text-muted">
                {lastV}{hasProjection && <> → ~{Math.round(vEnd)}</>}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-1.5">
          {drawn.map(({ s }) => (
            <button
              key={s.key}
              onClick={() => setSelected((cur) => (cur === s.key ? null : s.key))}
              className={`press flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition ${
                selected === s.key
                  ? "bg-surface-raised font-semibold shadow-raise"
                  : "bg-surface-muted"
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PaceBoard({ holidayId, onClose }: { holidayId: string; onClose: () => void }) {
  const [data, setData] = useState<PaceSeries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<"beers" | "points">("beers");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await getPaceSeries(holidayId);
        if (active) setData(d);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load the pace board.");
      }
    })();
    return () => {
      active = false;
    };
  }, [holidayId]);

  const groupSeries: Series[] = useMemo(
    () =>
      data
        ? [
            { key: "beers", label: "Beers", color: "#ef4444", pts: data.group_events.map((e: PaceEvent) => ({ t: e.t, v: e.beers })) },
            { key: "points", label: "Points", color: "#3b82f6", pts: data.group_events.map((e: PaceEvent) => ({ t: e.t, v: e.points })) },
          ]
        : [],
    [data],
  );

  const playerSeries: Series[] = useMemo(
    () =>
      data
        ? data.players.map((p, i) => ({
            key: p.user_id,
            label: p.display_name,
            color: PALETTE[i % PALETTE.length],
            pts: p.events.map((e) => ({ t: e.t, v: metric === "beers" ? e.beers : e.points })),
          }))
        : [],
    [data, metric],
  );

  const noData = data && data.group_events.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-sunken">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 className="text-lg font-bold">📈 Pace projection</h2>
        <button
          onClick={onClose}
          className="press rounded-full bg-surface-muted px-4 py-2 text-sm font-medium"
        >
          Done
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-md flex-col gap-6">
          {error ? (
            <p className="rounded-2xl border border-accent/40 bg-accent-soft p-4 text-center text-sm text-accent-strong">
              {error === "board is dark"
                ? "🌑 The board is dark — pace projections are hidden until the grand reveal."
                : error}
            </p>
          ) : !data ? (
            <Loading label="Plotting the trajectory…" />
          ) : noData ? (
            <div className="p-8 text-center text-muted">
              <div className="mb-2 text-5xl">📈</div>
              No beers logged yet — the pace board fills in as the trip gets going. 🍻
            </div>
          ) : (
            <>
              <section className="card flex flex-col gap-3 p-4">
                <h3 className="text-base font-bold">Group pace</h3>
                <p className="-mt-1 text-xs text-faint">
                  Cumulative across everyone, stepping up at each beer. Solid = so far, dotted = projected to the final day.
                </p>
                <LineChart series={groupSeries} startMs={data.start} endMs={data.end} nowMs={data.now} mode="summary" />
              </section>

              <section className="card flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold">Player pace</h3>
                  <div className="flex rounded-full bg-surface-muted p-0.5 text-xs font-medium">
                    <button
                      onClick={() => setMetric("beers")}
                      className={`press rounded-full px-3 py-1 ${metric === "beers" ? "bg-surface-raised shadow-raise" : "text-muted"}`}
                    >
                      🍺 Beers
                    </button>
                    <button
                      onClick={() => setMetric("points")}
                      className={`press rounded-full px-3 py-1 ${metric === "points" ? "bg-surface-raised shadow-raise" : "text-muted"}`}
                    >
                      🎯 Points
                    </button>
                  </div>
                </div>
                <p className="-mt-1 text-xs text-faint">
                  Tap a line or a name to see its current and projected total.
                </p>
                <LineChart
                  key={metric}
                  series={playerSeries}
                  startMs={data.start}
                  endMs={data.end}
                  nowMs={data.now}
                  mode="compare"
                />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
