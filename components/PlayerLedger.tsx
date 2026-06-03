"use client";

import { useEffect, useState } from "react";
import type { LedgerEntry } from "@/lib/types";
import { getUserLedger, signedUrl } from "@/lib/api";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Human-readable badges describing how a beer earned its points.
// Bonus = greater of chug (×2) and chain position; morning adds +1 on top.
function badges(e: LedgerEntry): { label: string; cls: string }[] {
  if (e.status === "rejected") {
    return [{ label: "Rejected", cls: "bg-red-100 text-red-700" }];
  }
  // Admin set the points by hand — that wins over the computed bonuses, so show
  // a single "Adjusted" badge instead of chug/chain/morning.
  if (e.score_override !== null) {
    return [{ label: "Adjusted ✎", cls: "bg-indigo-100 text-indigo-700" }];
  }
  const out: { label: string; cls: string }[] = [];
  const chugVal = e.is_chug ? 2 : 1;
  if (e.streak_position >= 3 && e.streak_position > chugVal) {
    out.push({ label: `Chain ×${e.streak_position}`, cls: "bg-purple-100 text-purple-700" });
  } else if (e.is_chug) {
    out.push({ label: "Chug 🍺×2", cls: "bg-amber-100 text-amber-700" });
  } else if (e.streak_position >= 2) {
    out.push({ label: `Chain ×${e.streak_position}`, cls: "bg-purple-100 text-purple-700" });
  } else {
    out.push({ label: "Normal", cls: "bg-neutral-100 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300" });
  }
  if (e.is_morning) {
    out.push({ label: "Morning +1", cls: "bg-sky-100 text-sky-700" });
  }
  return out;
}

export function PlayerLedger({
  holidayId,
  userId,
  displayName,
  onClose,
}: {
  holidayId: string;
  userId: string;
  displayName: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await getUserLedger(holidayId, userId);
        if (active) setEntries(data);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not load ledger.");
      }
    })();
    return () => {
      active = false;
    };
  }, [holidayId, userId]);

  const total = entries?.reduce((sum, e) => sum + e.points, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50 dark:bg-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
        <div>
          <h2 className="text-lg font-bold">{displayName}</h2>
          <p className="text-xs text-neutral-500">
            {entries ? `${entries.length} beer${entries.length === 1 ? "" : "s"} · ${total} pts` : "Loading…"}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium dark:bg-neutral-700"
        >
          Done
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {error && (
          <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-600">
            {error}
          </p>
        )}
        {!error && entries && entries.length === 0 && (
          <p className="p-6 text-center text-neutral-500">No beers logged yet. 🍺</p>
        )}
        <ul className="flex flex-col gap-2">
          {entries?.map((e) => {
            const open = openId === e.beer_id;
            return (
              <li
                key={e.beer_id}
                className={`overflow-hidden rounded-2xl shadow-sm ${
                  e.is_offline
                    ? "bg-amber-50 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:ring-amber-800/50"
                    : "bg-white dark:bg-neutral-800"
                }`}
              >
                <button
                  onClick={() => setOpenId(open ? null : e.beer_id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-neutral-500">
                      {fmtDate(e.full_taken_at)} · {fmtTime(e.full_taken_at)}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {badges(e).map((b, i) => (
                        <span key={i} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${b.cls}`}>
                          {b.label}
                        </span>
                      ))}
                      {e.is_offline && (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                          🛜 Offline
                        </span>
                      )}
                    </span>
                    {e.reviews_total > 0 && (
                      <span className="text-[11px] text-neutral-400">
                        {e.reviews_challenged}/{e.reviews_total} challenged
                        {e.status === "confirmed" && e.reviews_challenged > 0 && " · admin confirmed"}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-lg font-bold ${e.points === 0 ? "text-neutral-400 line-through" : ""}`}>
                      {e.points}
                    </span>
                    <span className="text-xs text-neutral-400">pts</span>
                    <span className="text-neutral-300">{open ? "▲" : "▼"}</span>
                  </div>
                </button>
                {open && <LedgerPhotos entry={e} />}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function LedgerPhotos({ entry }: { entry: LedgerEntry }) {
  const [urls, setUrls] = useState<{ full: string | null; empty: string | null } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [full, empty] = await Promise.all([
        entry.full_photo_path ? signedUrl(entry.full_photo_path) : Promise.resolve(null),
        entry.empty_photo_path ? signedUrl(entry.empty_photo_path) : Promise.resolve(null),
      ]);
      if (active) setUrls({ full, empty });
    })();
    return () => {
      active = false;
    };
  }, [entry]);

  return (
    <div className="grid grid-cols-2 gap-2 border-t border-neutral-100 px-4 py-3 dark:border-neutral-700">
      <Photo url={urls?.full ?? null} label="FULL" time={fmtTime(entry.full_taken_at)} />
      <Photo url={urls?.empty ?? null} label="EMPTY" time={fmtTime(entry.empty_taken_at)} />
    </div>
  );
}

function Photo({ url, label, time }: { url: string | null; label: string; time: string }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-700">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-neutral-400">…</div>
      )}
      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-bold text-white">
        {label}
      </span>
      <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
        {time}
      </span>
    </div>
  );
}
