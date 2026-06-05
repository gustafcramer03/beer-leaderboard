"use client";

// Compact brand selector for the log flow. Optional — you can finish a beer
// without tagging. Search filters the catalogue; tapping a chip selects it (tap
// again to clear). Selected chip shows in the brand's colour. Grouped by country
// (Greece first — the inaugural trip), International collapsed behind the search.

import { useMemo, useState } from "react";
import { BRANDS, BRANDS_BY_COUNTRY, getBrand } from "@/lib/brands";

export function BrandPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null;
  onChange: (slug: string | null) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const selected = getBrand(value);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return null;
    return BRANDS.filter(
      (b) => b.name.toLowerCase().includes(term) || b.slug.includes(term),
    );
  }, [q]);

  function chip(slug: string, name: string, colour: string) {
    const on = value === slug;
    return (
      <button
        key={slug}
        type="button"
        disabled={disabled}
        onClick={() => onChange(on ? null : slug)}
        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
          on
            ? "border-transparent text-white shadow-sm"
            : "border-neutral-300 bg-white text-neutral-700 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
        }`}
        style={on ? { backgroundColor: colour } : undefined}
      >
        {name}
      </button>
    );
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral-600 dark:text-neutral-300">
          🏷️ Tag the beer{" "}
          <span className="font-normal text-neutral-400">(optional)</span>
        </span>
        {selected && (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="text-[11px] font-medium text-amber-600 underline disabled:opacity-40 dark:text-amber-400"
          >
            clear
          </button>
        )}
      </div>

      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search beers…"
        disabled={disabled}
        className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800"
      />

      {matches ? (
        matches.length === 0 ? (
          <p className="text-center text-xs text-neutral-400">
            No match. Pick “Other / unknown”, or leave it untagged.
          </p>
        ) : (
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {matches.map((b) => chip(b.slug, b.name, b.colour))}
          </div>
        )
      ) : (
        <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
          {BRANDS_BY_COUNTRY.map(({ country, brands }) => (
            <div key={country} className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                {country}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {brands.map((b) => chip(b.slug, b.name, b.colour))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
