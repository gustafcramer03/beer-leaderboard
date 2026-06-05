"use client";

// Brand mark for a tagged beer. "Colour chip + logo drop-in": we try to load a
// logo at /brands/{slug}.png and, if it renders, show it; otherwise we fall back
// to a brand-coloured name pill. So no copyrighted logo files need to ship — drop
// PNGs into public/brands/ over time and they light up here automatically.
//
// `overlay` styles it for sitting in the corner of a photo (frosted backing,
// shadow); otherwise it's a plain inline pill for lists/captions.

import { useState } from "react";
import { getBrand, hasLogo } from "@/lib/brands";

export function BrandBadge({
  slug,
  overlay = false,
  size = "sm",
}: {
  slug: string | null | undefined;
  overlay?: boolean;
  size?: "xs" | "sm";
}) {
  // Only attempt the logo image if the slug is registered as having one
  // (lib/brands.ts LOGO_SLUGS); otherwise go straight to the colour pill so we
  // never fire a 404 for an unbundled logo.
  const [logoOk, setLogoOk] = useState(true);
  const brand = getBrand(slug);
  if (!slug) return null;
  const showLogo = logoOk && hasLogo(slug);

  const name = brand?.name ?? slug;
  const colour = brand?.colour ?? "#6b7280";
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[11px]";
  const logoH = size === "xs" ? "h-3.5" : "h-4";

  // Logo path is derived from the slug; missing file flips logoOk false on error.
  const logoSrc = `/brands/${slug}.png`;

  if (showLogo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <span
        className={
          overlay
            ? "inline-flex items-center rounded-md bg-white/85 px-1 py-0.5 shadow-sm backdrop-blur-sm dark:bg-neutral-900/80"
            : "inline-flex items-center"
        }
      >
        <img
          src={logoSrc}
          alt={name}
          className={`${logoH} w-auto object-contain`}
          onError={() => setLogoOk(false)}
        />
      </span>
    );
  }

  // Fallback: brand-coloured name pill.
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-semibold text-white ${pad} ${
        overlay ? "shadow-sm" : ""
      }`}
      style={{ backgroundColor: colour }}
    >
      <span className="text-[0.85em] leading-none">🍺</span>
      {name}
    </span>
  );
}
