"use client";

import { useEffect, useState, useCallback } from "react";
import type { Beer } from "@/lib/types";
import { challengedBeers, adminRuleBeer, signedUrl } from "@/lib/api";

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

  if (loading) return <p className="p-6 text-center text-neutral-500">Loading…</p>;

  if (beers.length === 0) {
    return (
      <div className="p-8 text-center text-neutral-500">
        <div className="mb-2 text-5xl">⚖️</div>
        No challenged beers right now.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-lg font-bold">Challenged beers — your ruling</h2>
      {beers.map((b) => (
        <AdminCard key={b.id} beer={b} busy={busyId === b.id} onRule={rule} />
      ))}
    </div>
  );
}

function AdminCard({
  beer,
  busy,
  onRule,
}: {
  beer: Beer;
  busy: boolean;
  onRule: (id: string, d: "confirm" | "reject") => void;
}) {
  const [urls, setUrls] = useState<{ full: string | null; empty: string | null }>({
    full: null,
    empty: null,
  });

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
      <div className="mt-3 flex gap-3">
        <button
          disabled={busy}
          onClick={() => onRule(beer.id, "confirm")}
          className="flex-1 rounded-full bg-green-500 py-2 font-semibold text-white disabled:opacity-40"
        >
          Uphold ✓
        </button>
        <button
          disabled={busy}
          onClick={() => onRule(beer.id, "reject")}
          className="flex-1 rounded-full bg-red-500 py-2 font-semibold text-white disabled:opacity-40"
        >
          Reject ✕
        </button>
      </div>
    </div>
  );
}
