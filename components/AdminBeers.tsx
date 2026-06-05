"use client";

// Admin "Manage beers": every non-open beer in the trip, grouped by player, so
// the admin can revisit a beer that was already ruled and fix a mistake —
// re-score it, void (reject) it, or reinstate (confirm, clearing any override).
// Reuses the same RPCs as the rulings queue; the difference is this lists ALL
// beers (any status), not just the ones currently challenged.

import { useEffect, useState, useCallback, useMemo } from "react";
import type { AdminBeer } from "@/lib/types";
import { getAdminBeers, adminRuleBeer, adminSetBeerScore, signedUrl } from "@/lib/api";
import { Loading } from "./Loading";
import { PhotoPreview } from "./PhotoPreview";

function fmtGap(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

function stamp(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const STATUS_LABEL: Record<AdminBeer["status"], string> = {
  pending: "Pending",
  challenged: "Challenged",
  confirmed: "Confirmed",
  rejected: "Voided",
};

const STATUS_STYLE: Record<AdminBeer["status"], string> = {
  pending: "bg-surface-muted text-muted",
  challenged: "bg-accent-soft text-accent-strong",
  confirmed: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export function AdminBeers({ holidayId }: { holidayId: string }) {
  const [beers, setBeers] = useState<AdminBeer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBeers(await getAdminBeers(holidayId));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [holidayId]);

  useEffect(() => {
    load();
  }, [load]);

  async function rule(beerId: string, decision: "confirm" | "reject", reason: string) {
    setBusyId(beerId);
    try {
      await adminRuleBeer(beerId, decision, reason);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setBusyId(null);
    }
  }

  async function setScore(beerId: string, points: number, reason: string) {
    setBusyId(beerId);
    try {
      await adminSetBeerScore(beerId, points, reason);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setBusyId(null);
    }
  }

  // Group by player (the RPC already orders by name, then newest beer first).
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; beers: AdminBeer[] }>();
    for (const b of beers) {
      const g = map.get(b.user_id) ?? { name: b.owner_name, beers: [] };
      g.beers.push(b);
      map.set(b.user_id, g);
    }
    return [...map.values()];
  }, [beers]);

  if (loading) return <Loading label="Gathering every beer…" />;

  if (beers.length === 0) {
    return (
      <div className="p-8 text-center text-muted">
        <div className="mb-2 text-5xl">🍺</div>
        <p className="font-medium">No beers logged yet.</p>
        <p className="mt-1 text-sm">Nothing to manage — for now. 🍻</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4">
      <p className="text-sm text-muted">
        Every beer in the trip. Tap a beer to re-score, void or reinstate it if a ruling needs
        correcting.
      </p>
      {groups.map((g) => (
        <div key={g.name + g.beers[0].user_id} className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">
            {g.name}
            <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted">
              {g.beers.length}🍺 · {g.beers.reduce((n, b) => n + b.points, 0)} pts
            </span>
          </h3>
          {g.beers.map((b) => (
            <ManageCard
              key={b.beer_id}
              beer={b}
              busy={busyId === b.beer_id}
              onRule={rule}
              onSetScore={setScore}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function ManageCard({
  beer,
  busy,
  onRule,
  onSetScore,
}: {
  beer: AdminBeer;
  busy: boolean;
  onRule: (id: string, d: "confirm" | "reject", reason: string) => void;
  onSetScore: (id: string, points: number, reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState<{ full: string | null; empty: string | null }>({
    full: null,
    empty: null,
  });
  const [editing, setEditing] = useState(false);
  const [points, setPoints] = useState(beer.points);
  const [reason, setReason] = useState(beer.override_reason ?? "");
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);

  // Only sign photos once the card is expanded (saves a flood of signed URLs).
  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      const [full, empty] = await Promise.all([
        beer.full_photo_path ? signedUrl(beer.full_photo_path) : Promise.resolve(null),
        beer.empty_photo_path ? signedUrl(beer.empty_photo_path) : Promise.resolve(null),
      ]);
      if (active) setUrls({ full, empty });
    })();
    return () => {
      active = false;
    };
  }, [open, beer.full_photo_path, beer.empty_photo_path]);

  const gap =
    beer.full_taken_at && beer.empty_taken_at
      ? Math.round(
          (new Date(beer.empty_taken_at).getTime() - new Date(beer.full_taken_at).getTime()) / 1000,
        )
      : null;

  const flags: string[] = [];
  if (beer.is_offline) flags.push("🛜 Offline");
  if (beer.claimed_chug || beer.is_chug) flags.push("🍺×2 Chug");
  if (beer.is_morning) flags.push("🌅 Morning");
  if (beer.is_happy_hour) flags.push("🍻 Happy hour");
  if (beer.is_early_bird) flags.push("🐦 Early bird");
  if (beer.is_night_owl) flags.push("🦉 Night owl");

  return (
    <div className="card">
      {/* Header row — always visible, tap to expand */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[beer.status]}`}>
          {STATUS_LABEL[beer.status]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {beer.empty_taken_at ? stamp(beer.empty_taken_at) : "—"}
            {gap !== null && <span className="text-faint"> · {fmtGap(gap)}</span>}
            {beer.score_override !== null && <span className="text-accent"> · adjusted ✎</span>}
          </div>
          {beer.reviews_challenged > 0 && (
            <div className="text-[11px] text-faint">
              {beer.reviews_challenged}/{beer.reviews_total} challenged
            </div>
          )}
        </div>
        <span className="shrink-0 text-base font-black tabular-nums">{beer.points}<span className="text-xs font-medium text-faint"> pts</span></span>
        <span className="shrink-0 text-faint">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="border-t border-line p-3">
          {/* Flags */}
          {flags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5 text-[11px]">
              {flags.map((f) => (
                <span
                  key={f}
                  className="rounded-full bg-surface-muted px-2 py-0.5 font-medium text-muted"
                >
                  {f}
                </span>
              ))}
            </div>
          )}

          {/* Timing */}
          {beer.full_taken_at && beer.empty_taken_at && gap !== null && (
            <div className="mb-2 flex items-center justify-center gap-2">
              <div className="flex flex-col items-center rounded-xl bg-surface-muted px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                  Full 🍺
                </span>
                <span className="text-base font-bold tabular-nums">{stamp(beer.full_taken_at)}</span>
              </div>
              <div className="flex flex-col items-center px-1 leading-tight text-muted">
                <span className="text-lg">→</span>
                <span className="text-xs font-bold">{fmtGap(gap)}</span>
              </div>
              <div className="flex flex-col items-center rounded-xl bg-surface-muted px-3 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
                  Empty 🏁
                </span>
                <span className="text-base font-bold tabular-nums">{stamp(beer.empty_taken_at)}</span>
              </div>
            </div>
          )}

          {/* Photos */}
          <div className="grid grid-cols-2 gap-2">
            <CardPhoto
              url={urls.full}
              label="FULL"
              onOpen={() => urls.full && setPreview({ url: urls.full, label: "FULL" })}
            />
            <CardPhoto
              url={urls.empty}
              label="EMPTY"
              onOpen={() => urls.empty && setPreview({ url: urls.empty, label: "EMPTY" })}
            />
          </div>

          {/* Caption */}
          {beer.caption && (
            <p className="mt-2 text-center text-sm italic text-muted">
              &ldquo;{beer.caption}&rdquo;
            </p>
          )}

          {/* Existing ruling note */}
          {beer.override_reason && (
            <p className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-xs text-accent-strong">
              ⚖️ Earlier ruling: {beer.override_reason}
            </p>
          )}

          {/* Ruling note for this change */}
          <div className="mt-3 flex flex-col gap-1">
            <label className="text-xs font-semibold text-muted">Ruling note (optional)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 200))}
              placeholder="Why you're changing this — shown to the player on their beer."
              maxLength={200}
              rows={2}
              className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            />
            {reason.length > 0 && (
              <span className="self-end text-[11px] text-faint">{reason.length}/200</span>
            )}
          </div>

          {/* Set-score stepper */}
          {editing && (
            <div className="mt-3 flex flex-col gap-2 rounded-xl bg-surface-muted p-3">
              <p className="text-center text-xs text-muted">Set this beer&apos;s points by hand:</p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setPoints((p) => Math.max(0, p - 1))}
                  className="h-10 w-10 rounded-full bg-surface-muted text-xl font-bold"
                  aria-label="Decrease points"
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={points}
                  onChange={(e) =>
                    setPoints(Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0))))
                  }
                  className="w-20 rounded-lg border border-line bg-surface py-2 text-center text-lg font-bold"
                />
                <button
                  type="button"
                  onClick={() => setPoints((p) => Math.min(100, p + 1))}
                  className="h-10 w-10 rounded-full bg-surface-muted text-xl font-bold"
                  aria-label="Increase points"
                >
                  +
                </button>
                <span className="text-sm text-faint">pts</span>
              </div>
              <div className="mt-1 flex gap-3">
                <button
                  disabled={busy}
                  onClick={() => setEditing(false)}
                  className="flex-1 rounded-full bg-surface-muted py-2 font-semibold text-muted disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  disabled={busy}
                  onClick={() => onSetScore(beer.beer_id, points, reason)}
                  className="flex-1 rounded-full bg-green-500 py-2 font-semibold text-white disabled:opacity-40"
                >
                  Save {points} pts
                </button>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {!editing && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                disabled={busy}
                onClick={() => {
                  setPoints(beer.points);
                  setEditing(true);
                }}
                className="flex-1 rounded-full bg-accent py-2 text-sm font-semibold text-accent-contrast disabled:opacity-40"
              >
                Set score ✎
              </button>
              {beer.status === "rejected" ? (
                <button
                  disabled={busy}
                  onClick={() => onRule(beer.beer_id, "confirm", reason)}
                  className="flex-1 rounded-full bg-green-500 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Reinstate ✓
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => onRule(beer.beer_id, "reject", reason)}
                  className="flex-1 rounded-full bg-red-500 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Void ✕
                </button>
              )}
              {beer.score_override !== null && beer.status !== "rejected" && (
                <button
                  disabled={busy}
                  onClick={() => onRule(beer.beer_id, "confirm", reason)}
                  className="w-full rounded-full bg-surface-muted py-2 text-sm font-semibold text-muted disabled:opacity-40"
                >
                  Clear adjustment ↺
                </button>
              )}
            </div>
          )}

          {preview && (
            <PhotoPreview url={preview.url} label={preview.label} onClose={() => setPreview(null)} />
          )}
        </div>
      )}
    </div>
  );
}

function CardPhoto({
  url,
  label,
  onOpen,
}: {
  url: string | null;
  label: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!url}
      className="relative aspect-square overflow-hidden rounded-xl bg-surface-muted"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-faint">…</div>
      )}
      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-bold text-white">
        {label}
      </span>
      {url && (
        <span className="pointer-events-none absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          🔍 tap
        </span>
      )}
    </button>
  );
}
