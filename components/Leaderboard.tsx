"use client";

import { useEffect, useState, useCallback } from "react";
import type { StandingsResult } from "@/lib/types";
import { getStandings, refreshSnapshot } from "@/lib/api";
import { useSession } from "./SessionProvider";
import { PlayerLedger } from "./PlayerLedger";

const MEDALS = ["🥇", "🥈", "🥉"];

export function Leaderboard({ holidayId }: { holidayId: string }) {
  const { userId } = useSession();
  const [result, setResult] = useState<StandingsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [peeking, setPeeking] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(
    async (adminPeek = false) => {
      setLoading(true);
      try {
        setResult(await getStandings(holidayId, adminPeek));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [holidayId],
  );

  useEffect(() => {
    load();
  }, [load]);

  async function adminRefresh() {
    setRefreshing(true);
    try {
      await refreshSnapshot(holidayId);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return <p className="p-6 text-center text-neutral-500">Loading…</p>;
  if (!result) return <p className="p-6 text-center text-neutral-500">No data yet.</p>;

  if (result.state === "dark" && result.standings === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="text-7xl">🌑</div>
        <h2 className="text-xl font-bold">The board has gone dark</h2>
        <p className="max-w-xs text-sm text-neutral-500">
          Keep drinking and logging — scores are hidden for the final stretch. The winner is
          revealed on the last day. 🍻
        </p>
        {result.can_peek && (
          <button
            onClick={async () => {
              setPeeking(true);
              await load(true);
              setPeeking(false);
            }}
            disabled={peeking}
            className="mt-2 rounded-full border border-amber-400 px-4 py-2 text-sm text-amber-600 disabled:opacity-40"
          >
            {peeking ? "Peeking…" : "👁️ Peek at standings (admin)"}
          </button>
        )}
      </div>
    );
  }

  const standings = result.standings ?? [];

  return (
    <div className="flex flex-col gap-3 p-4">
      {result.state === "dark" && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-center text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          👁️ Admin peek — the board is dark for everyone else until the reveal.
        </div>
      )}

      {result.state === "reveal" && (
        <div className="rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 p-4 text-center text-white shadow">
          <div className="text-3xl">🏆 GRAND REVEAL 🏆</div>
          {standings[0] && (
            <p className="mt-1 font-bold">
              Champion: {standings[0].display_name} — {standings[0].points} pts
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">League table</h2>
        {result.generated_at && (
          <span className="text-xs text-neutral-400">
            updated {new Date(result.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {standings.map((s, i) => (
          <li key={s.user_id}>
            <button
              onClick={() => setLedgerFor({ id: s.user_id, name: s.display_name })}
              className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left shadow-sm transition active:scale-[0.99] ${
                s.user_id === userId
                  ? "bg-amber-100 dark:bg-amber-900/40"
                  : "bg-white dark:bg-neutral-800"
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="w-6 text-center font-bold">{MEDALS[i] ?? i + 1}</span>
                <span className="font-medium">
                  {s.display_name}
                  {s.user_id === userId && <span className="text-amber-600"> (you)</span>}
                </span>
              </span>
              <span className="flex items-center gap-2 text-right">
                <span>
                  <span className="text-lg font-bold">{s.points}</span>
                  <span className="ml-1 text-xs text-neutral-400">pts · {s.beer_count}🍺</span>
                </span>
                <span className="text-neutral-300">›</span>
              </span>
            </button>
          </li>
        ))}
        {standings.length === 0 && (
          <li className="p-6 text-center text-neutral-500">No beers logged yet. Be the first! 🍺</li>
        )}
      </ul>

      {result.is_admin && (
        <button
          onClick={adminRefresh}
          disabled={refreshing}
          className="mt-2 self-center rounded-full border border-amber-400 px-4 py-2 text-sm text-amber-600 disabled:opacity-40"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh now (admin)"}
        </button>
      )}
      <p className="text-center text-xs text-neutral-400">
        Scores auto-update hourly. Tap a player to see their beers.
      </p>

      {ledgerFor && (
        <PlayerLedger
          holidayId={holidayId}
          userId={ledgerFor.id}
          displayName={ledgerFor.name}
          onClose={() => setLedgerFor(null)}
        />
      )}
    </div>
  );
}
