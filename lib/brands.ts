// Canonical beer-brand catalogue for tagging. Each beer can be tagged with one
// brand slug (stored in beers.brand). The slug is the only thing persisted; the
// frontend maps it back to a display name + brand colour here, and tries to load
// a logo at /brands/{slug}.png — if that file is missing the BrandBadge falls
// back to a brand-coloured name pill ("colour chip + logo drop-in"). No
// copyrighted logo files are bundled by default; drop PNGs into public/brands/
// over time and they light up automatically.
//
// `colour` is the brand's signature colour (used for the pill + chip). `kind`
// is a loose style label for the insights breakdown. `country` groups the
// catalogue (the first proper trip is in Greece, so Greek beers are first-class).

export type BrandCountry = "Greece" | "UK" | "International";
export type BrandKind = "lager" | "ale" | "stout" | "cider" | "wheat" | "ipa" | "other";

export type Brand = {
  slug: string;
  name: string;
  country: BrandCountry;
  kind: BrandKind;
  colour: string; // hex, the brand's signature colour
};

// Ordered Greece-first (the inaugural trip), then UK pub staples, then the big
// internationals you'll find on tap everywhere. Keep slugs lowercase a-z0-9 + hyphen.
export const BRANDS: Brand[] = [
  // --- Greece ---
  { slug: "mythos", name: "Mythos", country: "Greece", kind: "lager", colour: "#0a4ea3" },
  { slug: "alfa", name: "Alfa", country: "Greece", kind: "lager", colour: "#c8102e" },
  { slug: "fix-hellas", name: "Fix Hellas", country: "Greece", kind: "lager", colour: "#d4151c" },
  { slug: "vergina", name: "Vergina", country: "Greece", kind: "lager", colour: "#b8860b" },
  { slug: "mamos", name: "Mamos", country: "Greece", kind: "lager", colour: "#c0392b" },
  { slug: "nymfi", name: "Nymfi", country: "Greece", kind: "lager", colour: "#1f7a5a" },
  { slug: "nissos", name: "Nissos", country: "Greece", kind: "lager", colour: "#0e7fb3" },
  { slug: "septem", name: "Septem", country: "Greece", kind: "ale", colour: "#1a1a1a" },
  { slug: "voreia", name: "Voreia", country: "Greece", kind: "ale", colour: "#2c3e50" },
  { slug: "corfu-beer", name: "Corfu Beer", country: "Greece", kind: "ale", colour: "#1c6ea4" },
  { slug: "eza", name: "EZA", country: "Greece", kind: "lager", colour: "#e09f3e" },
  { slug: "pils-hellas", name: "Pils Hellas", country: "Greece", kind: "lager", colour: "#caa01a" },
  { slug: "solo", name: "Solo", country: "Greece", kind: "lager", colour: "#1565c0" },

  // --- UK pub staples ---
  { slug: "carling", name: "Carling", country: "UK", kind: "lager", colour: "#d2122e" },
  { slug: "fosters", name: "Foster's", country: "UK", kind: "lager", colour: "#0a3d91" },
  { slug: "carlsberg", name: "Carlsberg", country: "UK", kind: "lager", colour: "#00603a" },
  { slug: "madri", name: "Madrí Excepcional", country: "UK", kind: "lager", colour: "#b8902b" },
  { slug: "tennents", name: "Tennent's", country: "UK", kind: "lager", colour: "#e2231a" },
  { slug: "john-smiths", name: "John Smith's", country: "UK", kind: "ale", colour: "#b5006a" },
  { slug: "boddingtons", name: "Boddingtons", country: "UK", kind: "ale", colour: "#f2c200" },
  { slug: "guinness", name: "Guinness", country: "UK", kind: "stout", colour: "#1a1a1a" },
  { slug: "doom-bar", name: "Doom Bar", country: "UK", kind: "ale", colour: "#1b3a5b" },
  { slug: "london-pride", name: "London Pride", country: "UK", kind: "ale", colour: "#1c2f5a" },
  { slug: "greene-king-ipa", name: "Greene King IPA", country: "UK", kind: "ale", colour: "#c8102e" },
  { slug: "hobgoblin", name: "Hobgoblin", country: "UK", kind: "ale", colour: "#e67817" },
  { slug: "old-speckled-hen", name: "Old Speckled Hen", country: "UK", kind: "ale", colour: "#b8860b" },
  { slug: "newcastle-brown", name: "Newcastle Brown Ale", country: "UK", kind: "ale", colour: "#0a4ea3" },
  { slug: "camden-hells", name: "Camden Hells", country: "UK", kind: "lager", colour: "#e2231a" },
  { slug: "punk-ipa", name: "BrewDog Punk IPA", country: "UK", kind: "ipa", colour: "#19a3a3" },
  { slug: "beavertown-neck-oil", name: "Beavertown Neck Oil", country: "UK", kind: "ipa", colour: "#f04e98" },
  { slug: "strongbow", name: "Strongbow", country: "UK", kind: "cider", colour: "#c8102e" },
  { slug: "magners", name: "Magners", country: "UK", kind: "cider", colour: "#1f7a3d" },
  { slug: "thatchers", name: "Thatchers", country: "UK", kind: "cider", colour: "#d4151c" },
  { slug: "aspall", name: "Aspall", country: "UK", kind: "cider", colour: "#0a3d91" },
  { slug: "bulmers", name: "Bulmers", country: "UK", kind: "cider", colour: "#c0392b" },

  // --- International (on tap everywhere) ---
  { slug: "stella-artois", name: "Stella Artois", country: "International", kind: "lager", colour: "#c8102e" },
  { slug: "heineken", name: "Heineken", country: "International", kind: "lager", colour: "#00843d" },
  { slug: "peroni", name: "Peroni", country: "International", kind: "lager", colour: "#0a3d91" },
  { slug: "birra-moretti", name: "Birra Moretti", country: "International", kind: "lager", colour: "#0a5c3a" },
  { slug: "budweiser", name: "Budweiser", country: "International", kind: "lager", colour: "#c8102e" },
  { slug: "corona", name: "Corona", country: "International", kind: "lager", colour: "#d9b310" },
  { slug: "estrella-damm", name: "Estrella Damm", country: "International", kind: "lager", colour: "#c8102e" },
  { slug: "san-miguel", name: "San Miguel", country: "International", kind: "lager", colour: "#c8102e" },
  { slug: "cruzcampo", name: "Cruzcampo", country: "International", kind: "lager", colour: "#e1231a" },
  { slug: "amstel", name: "Amstel", country: "International", kind: "lager", colour: "#d4151c" },
  { slug: "kronenbourg", name: "Kronenbourg 1664", country: "International", kind: "lager", colour: "#0a4ea3" },
  { slug: "coors", name: "Coors", country: "International", kind: "lager", colour: "#b01c2e" },
  { slug: "pravha", name: "Pravha", country: "International", kind: "lager", colour: "#1c6ea4" },
  { slug: "asahi", name: "Asahi", country: "International", kind: "lager", colour: "#0a3d91" },
  { slug: "tuborg", name: "Tuborg", country: "International", kind: "lager", colour: "#0e7d3a" },
  { slug: "desperados", name: "Desperados", country: "International", kind: "lager", colour: "#7a9a01" },
  { slug: "hoegaarden", name: "Hoegaarden", country: "International", kind: "wheat", colour: "#1c6ea4" },
  { slug: "erdinger", name: "Erdinger", country: "International", kind: "wheat", colour: "#0a3d91" },
  { slug: "paulaner", name: "Paulaner", country: "International", kind: "wheat", colour: "#003a70" },
  { slug: "staropramen", name: "Staropramen", country: "International", kind: "lager", colour: "#b8902b" },
  { slug: "pilsner-urquell", name: "Pilsner Urquell", country: "International", kind: "lager", colour: "#0a7d3a" },

  // --- Catch-all ---
  { slug: "other", name: "Other / unknown", country: "International", kind: "other", colour: "#6b7280" },
];

// Logo drop-in registry. Add a slug here AFTER dropping public/brands/{slug}.png
// and its real logo lights up everywhere (corner of photos, picker, insights).
// Until a slug is listed, BrandBadge renders the brand-coloured name pill — so we
// never fire 404s for logos that aren't bundled. Empty by default (no copyrighted
// logo files ship with the repo).
export const LOGO_SLUGS = new Set<string>([
  // e.g. "mythos", "guinness", "stella-artois"
]);

export function hasLogo(slug: string | null | undefined): boolean {
  return !!slug && LOGO_SLUGS.has(slug);
}

const BY_SLUG: Record<string, Brand> = Object.fromEntries(BRANDS.map((b) => [b.slug, b]));

export function getBrand(slug: string | null | undefined): Brand | null {
  if (!slug) return null;
  return BY_SLUG[slug] ?? null;
}

// Display helpers for unknown/legacy slugs that aren't in the catalogue.
export function brandName(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return BY_SLUG[slug]?.name ?? slug;
}

export function brandColour(slug: string | null | undefined): string {
  if (!slug) return "#6b7280";
  return BY_SLUG[slug]?.colour ?? "#6b7280";
}

// Brands grouped by country, in catalogue order, for the picker UI.
export const BRANDS_BY_COUNTRY: { country: BrandCountry; brands: Brand[] }[] = (
  ["Greece", "UK", "International"] as BrandCountry[]
).map((country) => ({
  country,
  brands: BRANDS.filter((b) => b.country === country),
}));

const KIND_LABELS: Record<BrandKind, string> = {
  lager: "Lager",
  ale: "Ale",
  stout: "Stout",
  cider: "Cider",
  wheat: "Wheat",
  ipa: "IPA",
  other: "Other",
};

export function kindLabel(kind: BrandKind): string {
  return KIND_LABELS[kind] ?? "Other";
}
