"use client";

import { useEffect, useState, useCallback } from "react";
import type { Beer } from "@/lib/types";
import { challengedBeers, adminRuleBeer, adminSetBeerScore, signedUrl } from "@/lib/api";
import { Loading } from "./Loading";

export function AdminQueue({ holidayId }: { holidayId: string }) {
  const [beers, setBeers] = useState<Beer[]>([]);
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

  async function rule(beerId: string, decision: "confirm" | "reject") {
    setBusyId(beerId);
    try {
      await adminRuleBeer(beerId, decision);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setBusyId(null);
    }
  }

  async function setScore(beerId: string, points: number) {
    setBusyId(beerId);
    try {
      await adminSetBeerScore(beerId, points);
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
  beer: Beer;
  busy: boolean;
  onRule: (id: string, d: "confirm" | "reject") => void;
  onSetScore: (id: string, points: number) => void;
}) {
  const [urls, setUrls] = useState<{ full: string | null; empty: string | null }>({
    full: null,
    empty: null,
  });
  const [editing, setEditing] = useState(false);
  const [points, setPoints] = useState(1);

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

  return (
    <div className="rounded-2xl bg-white p-4 shadow dark:bg-neutral-800">
      <div className="grid grid-cols-2 gap-2">
        {[urls.full, urls.empty].map((u, i) => (
          <div key={i} className="aspect-square overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-700">
            {u && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u} alt="" className="h-full w-full object-cover" />
            )}
          </div>
        ))}
      </div>
      {gap !== null && (
        <p className="mt-2 text-center text-xs text-neutral-500">
          gap {gap}s {beer.claimed_chug ? "· claims chug" : ""}
        </p>
      )}

      {editing ? (
        <div className="mt-3 flex flex-col gap-2">
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
              onClick={() => onSetScore(beer.id, points)}
              className="flex-1 rounded-full bg-green-500 py-2 font-semibold text-white disabled:opacity-40"
            >
              Save {points} pts
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            disabled={busy}
            onClick={() => onRule(beer.id, "confirm")}
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
            onClick={() => onRule(beer.id, "reject")}
            className="flex-1 rounded-full bg-red-500 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Reject ✕
          </button>
        </div>
      )}
    </div>
  );
}
