"use client";

// Beer insights: which beers the group is actually drinking. Pure group
// aggregate (per-brand counts), so it renders even while the board is dark. The
// RPC returns slug+count; we map slug -> name/colour/country/kind via
// lib/brands.ts here and draw a couple of hand-rolled bar charts.

import { useEffect, useMemo, useState } from "react";
import type { BeerInsights as InsightsData } from "@/lib/types";
import { getBeerInsights } from "@/lib/api";
import { getBrand, kindLabel, type BrandCountry, type BrandKind } from "@/lib/brands";
import { BrandBadge } from "./BrandBadge";
import { Loading } from "./Loading";
import { ErrorBox } from "./ErrorBox";

const COUNTRY_COLOUR: Record<BrandCountry, string> = {
  Greece: "#0a4ea3",
  UK: "#c8102e",
  International: "#d4a017",
};

export function BeerInsights({
  holidayId,
  onClose,
}: {
  holidayId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<InsightsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await getBeerInsights(holidayId);
        if (active) setData(d);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load insights.");
      }
    })();
    return () => {
      active = false;
    };
  }, [holidayId]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-sunken">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 className="font-display text-lg font-bold">🍻 Beer insights</h2>
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
            <Loading label="Pouring the numbers…" />
          ) : data.total_tagged === 0 ? (
            <div className="p-8 text-center text-muted">
              <div className="mb-2 text-5xl">🍺</div>
              No beers tagged yet. Tag a brand when you finish a beer and the
              popularity charts fill in here.
            </div>
          ) : (
            <InsightsBody data={data} />
          )}
        </div>
      </div>
    </div>
  );
}

function InsightsBody({ data }: { data: InsightsData }) {
  // Resolve slugs -> display info, keeping count. Unknown slugs (legacy/custom)
  // still show with their raw slug and the neutral fallback colour.
  const rows = useMemo(
    () =>
      data.brands.map((b) => {
        const brand = getBrand(b.slug);
        return {
          slug: b.slug,
          count: b.count,
          name: brand?.name ?? b.slug,
          colour: brand?.colour ?? "#6b7280",
          country: (brand?.country ?? "International") as BrandCountry,
          kind: (brand?.kind ?? "other") as BrandKind,
        };
      }),
    [data.brands],
  );

  const top = rows[0];
  const maxCount = rows[0]?.count ?? 1;

  // Country split.
  const byCountry = useMemo(() => {
    const m = new Map<BrandCountry, number>();
    for (const r of rows) m.set(r.country, (m.get(r.country) ?? 0) + r.count);
    return (["Greece", "UK", "International"] as BrandCountry[])
      .map((c) => ({ country: c, count: m.get(c) ?? 0 }))
      .filter((x) => x.count > 0);
  }, [rows]);

  // Style split (lager/ale/cider…).
  const byKind = useMemo(() => {
    const m = new Map<BrandKind, number>();
    for (const r of rows) m.set(r.kind, (m.get(r.kind) ?? 0) + r.count);
    return [...m.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const countryTotal = byCountry.reduce((s, x) => s + x.count, 0) || 1;
  const tagPct = data.total_beers > 0 ? Math.round((data.total_tagged / data.total_beers) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Headline: the group's favourite */}
      {top && (
        <div className="rounded-2xl bg-surface p-4 text-center shadow-card">
          <div className="text-xs font-semibold uppercase tracking-wide text-faint">
            Group favourite 🏆
          </div>
          <div className="mt-2 flex items-center justify-center">
            <BrandBadge slug={top.slug} />
          </div>
          <div className="mt-2 text-3xl font-black" style={{ color: top.colour }}>
            {top.count}
          </div>
          <div className="text-xs text-faint">
            beer{top.count === 1 ? "" : "s"} tagged
          </div>
        </div>
      )}

      {/* Quick tallies */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Tagged" value={data.total_tagged} />
        <Stat label="Brands" value={data.distinct_brands} />
        <Stat label="Tag rate" value={`${tagPct}%`} />
      </div>

      {/* Top brands — horizontal bars */}
      <section className="rounded-2xl bg-surface p-4 shadow-card">
        <h3 className="mb-3 text-sm font-bold">Most popular beers</h3>
        <div className="flex flex-col gap-2">
          {rows.slice(0, 12).map((r) => (
            <div key={r.slug} className="flex items-center gap-2">
              <span className="w-28 flex-none truncate text-xs font-medium" title={r.name}>
                {r.name}
              </span>
              <div className="relative h-5 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(6, (r.count / maxCount) * 100)}%`,
                    backgroundColor: r.colour,
                  }}
                />
              </div>
              <span className="w-6 flex-none text-right text-xs font-bold tabular-nums">
                {r.count}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Country split — stacked bar */}
      {byCountry.length > 1 && (
        <section className="rounded-2xl bg-surface p-4 shadow-card">
          <h3 className="mb-3 text-sm font-bold">Where the beer's from</h3>
          <div className="flex h-6 w-full overflow-hidden rounded-full">
            {byCountry.map((c) => (
              <div
                key={c.country}
                style={{
                  width: `${(c.count / countryTotal) * 100}%`,
                  backgroundColor: COUNTRY_COLOUR[c.country],
                }}
                title={`${c.country}: ${c.count}`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {byCountry.map((c) => (
              <span key={c.country} className="flex items-center gap-1.5 text-xs text-muted">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: COUNTRY_COLOUR[c.country] }}
                />
                {c.country} · {c.count} ({Math.round((c.count / countryTotal) * 100)}%)
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Style split — small bars */}
      {byKind.length > 1 && (
        <section className="rounded-2xl bg-surface p-4 shadow-card">
          <h3 className="mb-3 text-sm font-bold">By style</h3>
          <div className="flex flex-col gap-2">
            {byKind.map((k) => (
              <div key={k.kind} className="flex items-center gap-2">
                <span className="w-16 flex-none text-xs font-medium">{kindLabel(k.kind)}</span>
                <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.max(6, (k.count / byKind[0].count) * 100)}%` }}
                  />
                </div>
                <span className="w-6 flex-none text-right text-xs font-bold tabular-nums">
                  {k.count}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-center text-[11px] text-faint">
        Counts every tagged, audited beer. {data.total_beers - data.total_tagged} beer
        {data.total_beers - data.total_tagged === 1 ? "" : "s"} untagged.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl bg-surface p-3 text-center shadow-card">
      <div className="text-xl font-black text-accent">{value}</div>
      <div className="text-[11px] text-faint">{label}</div>
    </div>
  );
}
