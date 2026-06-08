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
        className={`press rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
          on
            ? "border-transparent text-white shadow-sm"
            : "border-line bg-surface text-muted"
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
        <span className="text-sm font-medium text-muted">
          🏷️ Tag the beer{" "}
          <span className="font-normal text-faint">(optional)</span>
        </span>
        {selected && (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="text-[11px] font-medium text-accent underline disabled:opacity-40"
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
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
      />

      {matches ? (
        matches.length === 0 ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-center text-xs text-faint">
              No match for “{q.trim()}”. Tag it as Other, or leave it untagged.
            </p>
            {(() => {
              const other = getBrand("other");
              return other ? chip(other.slug, other.name, other.colour) : null;
            })()}
          </div>
        ) : (
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {matches.map((b) => chip(b.slug, b.name, b.colour))}
          </div>
        )
      ) : (
        <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
          {BRANDS_BY_COUNTRY.map(({ country, brands }) => (
            <div key={country} className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
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
