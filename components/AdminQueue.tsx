"use client";

import { useEffect, useState, useCallback } from "react";
import type { ChallengedBeer } from "@/lib/types";
import { challengedBeers, adminRuleBeer, adminSetBeerScore, signedUrl } from "@/lib/api";
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

export function AdminQueue({ holidayId }: { holidayId: string }) {
  const [beers, setBeers] = useState<ChallengedBeer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBeers(await challengedBeers(holidayId));
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

  if (loading) return <Loading label="Reviewing the disputes…" />;

  if (beers.length === 0) {
    return (
      <div className="p-8 text-center text-neutral-500">
        <div className="mb-2 text-5xl">⚖️</div>
        <p className="font-medium">No challenged beers right now.</p>
        <p className="mt-1 text-sm">Order in the court. 🧑‍⚖️</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-lg font-bold">Challenged beers — your ruling</h2>
      {beers.map((b) => (
        <AdminCard
          key={b.id}
          beer={b}
          busy={busyId === b.id}
          onRule={rule}
          onSetScore={setScore}
        />
      ))}
    </div>
  );
}

function AdminCard({
  beer,
  busy,
  onRule,
  onSetScore,
}: {
  beer: ChallengedBeer;
  busy: boolean;
  onRule: (id: string, d: "confirm" | "reject", reason: string) => void;
  onSetScore: (id: string, points: number, reason: string) => void;
}) {
  const [urls, setUrls] = useState<{ full: string | null; empty: string | null }>({
    full: null,
    empty: null,
  });
  const [editing, setEditing] = useState(false);
  const [points, setPoints] = useState(1);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [full, empty] = await Promise.all([
        beer.full_photo_path ? signedUrl(beer.full_photo_path) : Promise.resolve(null),
        beer.empty_photo_path ? signedUrl(beer.empty_photo_path) : Promise.resolve(null),
      ]);
      setUrls({ full, empty });
    })();
  }, [beer]);

  const gap =
    beer.full_taken_at && beer.empty_taken_at
      ? Math.round(
          (new Date(beer.empty_taken_at).getTime() - new Date(beer.full_taken_at).getTime()) / 1000,
        )
      : null;
  const looksChugged = gap !== null && gap <= 60;

  return (
    <div className="rounded-2xl bg-white p-4 shadow dark:bg-neutral-800">
      {/* Who & what */}
      <div className="mb-2 flex flex-col items-center gap-1 text-center">
        <p className="font-bold">{beer.owner_name}</p>
        <div className="flex flex-wrap justify-center gap-1.5 text-[11px]">
          {beer.is_offline && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-700">
              🛜 Offline
            </span>
          )}
          {(beer.claimed_chug || looksChugged) && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
              {beer.claimed_chug ? "claims chug" : "looks chugged"} 🍺×2
            </span>
          )}
        </div>
      </div>

      {/* Timing — when each shot was taken + the gap */}
      {beer.full_taken_at && beer.empty_taken_at && gap !== null && (
        <div className="mb-2 flex items-center justify-center gap-2">
          <div className="flex flex-col items-center rounded-xl bg-neutral-100 px-3 py-1.5 dark:bg-neutral-700">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
              Full 🍺
            </span>
            <span className="text-base font-bold tabular-nums">{stamp(beer.full_taken_at)}</span>
          </div>
          <div className="flex flex-col items-center px-1 leading-tight text-neutral-500">
            <span className="text-lg">→</span>
            <span className="text-xs font-bold">{fmtGap(gap)}</span>
          </div>
          <div className="flex flex-col items-center rounded-xl bg-neutral-100 px-3 py-1.5 dark:bg-neutral-700">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
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
        <p className="mt-2 text-center text-sm italic text-neutral-600 dark:text-neutral-300">
          &ldquo;{beer.caption}&rdquo;
        </p>
      )}

      {/* The ruling note — applies to whichever decision you make */}
      <div className="mt-3 flex flex-col gap-1">
        <label className="text-xs font-semibold text-neutral-500">Your ruling (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 200))}
          placeholder="Why you're deciding this — shown to the player on their beer."
          maxLength={200}
          rows={2}
          className="w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-900"
        />
        {reason.length > 0 && (
          <span className="self-end text-[11px] text-neutral-400">{reason.length}/200</span>
        )}
      </div>

      {/* Set-score stepper (only when adjusting points) */}
      {editing && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl bg-neutral-50 p-3 dark:bg-neutral-900/40">
          <p className="text-center text-xs text-neutral-500">
            Accept this beer but set its points by hand:
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setPoints((p) => Math.max(0, p - 1))}
              className="h-10 w-10 rounded-full bg-neutral-200 text-xl font-bold dark:bg-neutral-700"
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
              className="w-20 rounded-lg border border-neutral-300 bg-white py-2 text-center text-lg font-bold dark:border-neutral-600 dark:bg-neutral-900"
            />
            <button
              type="button"
              onClick={() => setPoints((p) => Math.min(100, p + 1))}
              className="h-10 w-10 rounded-full bg-neutral-200 text-xl font-bold dark:bg-neutral-700"
              aria-label="Increase points"
            >
              +
            </button>
            <span className="text-sm text-neutral-400">pts</span>
          </div>
          <div className="mt-1 flex gap-3">
            <button
              disabled={busy}
              onClick={() => setEditing(false)}
              className="flex-1 rounded-full bg-neutral-200 py-2 font-semibold text-neutral-700 disabled:opacity-40 dark:bg-neutral-700 dark:text-neutral-200"
            >
              Cancel
            </button>
            <button
              disabled={busy}
              onClick={() => onSetScore(beer.id, points, reason)}
              className="flex-1 rounded-full bg-green-500 py-2 font-semibold text-white disabled:opacity-40"
            >
              Save {points} pts
            </button>
          </div>
        </div>
      )}

      {/* Decision buttons */}
      {!editing && (
        <div className="mt-3 flex gap-2">
          <button
            disabled={busy}
            onClick={() => onRule(beer.id, "confirm", reason)}
            className="flex-1 rounded-full bg-green-500 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Uphold ✓
          </button>
          <button
            disabled={busy}
            onClick={() => setEditing(true)}
            className="flex-1 rounded-full bg-amber-500 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Set score ✎
          </button>
          <button
            disabled={busy}
            onClick={() => onRule(beer.id, "reject", reason)}
            className="flex-1 rounded-full bg-red-500 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Reject ✕
          </button>
        </div>
      )}

      {preview && (
        <PhotoPreview url={preview.url} label={preview.label} onClose={() => setPreview(null)} />
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
      className="relative aspect-square overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-700"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-neutral-400">…</div>
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
