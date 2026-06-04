"use client";

import { useEffect, useState, useCallback } from "react";
import type { StandingsResult } from "@/lib/types";
import { getStandings, refreshSnapshot, setHolidayState } from "@/lib/api";
import { useSession } from "./SessionProvider";
import { PlayerLedger } from "./PlayerLedger";
import { RevealShow } from "./RevealShow";

const MEDALS = ["🥇", "🥈", "🥉"];

export function Leaderboard({
  holidayId,
  onOpenStats,
  onOpenRules,
}: {
  holidayId: string;
  onOpenStats: () => void;
  onOpenRules: () => void;
}) {
  const { userId } = useSession();
  const [result, setResult] = useState<StandingsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [peeking, setPeeking] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<{ id: string; name: string } | null>(null);
  const [stateBusy, setStateBusy] = useState(false);
  const [showReveal, setShowReveal] = useState(false);

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

  async function changeState(state: "live" | "dark" | "reveal" | "auto") {
    setStateBusy(true);
    try {
      await setHolidayState(holidayId, state);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setStateBusy(false);
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
        <div className="flex gap-2">
          <button
            onClick={onOpenStats}
            className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium dark:bg-neutral-700"
          >
            📊 Stats
          </button>
          <button
            onClick={onOpenRules}
            className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium dark:bg-neutral-700"
          >
            📖 Rules
          </button>
        </div>
        {result.is_admin && (
          <AdminTripControls state={result.state} busy={stateBusy} onChange={changeState} />
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
          {standings.length > 0 && (
            <button
              onClick={() => setShowReveal(true)}
              className="mt-3 rounded-full bg-white/20 px-4 py-2 text-sm font-semibold backdrop-blur active:scale-95"
            >
              ▶️ Play the reveal
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">League table</h2>
        <div className="flex items-center gap-3">
          {result.generated_at && (
            <span className="text-xs text-neutral-400">
              updated {new Date(result.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={onOpenStats}
            aria-label="Trip stats"
            className="rounded-full bg-neutral-100 px-3 py-1.5 text-sm font-medium dark:bg-neutral-700"
          >
            📊 Stats
          </button>
          <button
            onClick={onOpenRules}
            aria-label="How the game works"
            className="rounded-full bg-neutral-100 px-3 py-1.5 text-sm font-medium dark:bg-neutral-700"
          >
            📖 Rules
          </button>
        </div>
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
        <>
          <button
            onClick={adminRefresh}
            disabled={refreshing}
            className="mt-2 self-center rounded-full border border-amber-400 px-4 py-2 text-sm text-amber-600 disabled:opacity-40"
          >
            {refreshing ? "Refreshing…" : "↻ Refresh now (admin)"}
          </button>
          <AdminTripControls state={result.state} busy={stateBusy} onChange={changeState} />
        </>
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

      {showReveal && (
        <RevealShow standings={standings} onClose={() => setShowReveal(false)} />
      )}
    </div>
  );
}

// Admin-only board-state controls. Toggle the dark window on/off and end the
// trip to trigger the reveal. 'auto' hands control back to the calendar.
function AdminTripControls({
  state,
  busy,
  onChange,
}: {
  state: "live" | "dark" | "reveal";
  busy: boolean;
  onChange: (s: "live" | "dark" | "reveal" | "auto") => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-neutral-200 p-3 dark:border-neutral-700">
      <span className="text-center text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Admin controls
      </span>
      <div className="flex flex-wrap justify-center gap-2">
        {state !== "dark" ? (
          <button
            onClick={() => onChange("dark")}
            disabled={busy}
            className="rounded-full bg-neutral-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-neutral-200 dark:text-neutral-900"
          >
            🌑 Go dark
          </button>
        ) : (
          <button
            onClick={() => onChange("live")}
            disabled={busy}
            className="rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            ☀️ Lift the dark
          </button>
        )}

        {state !== "reveal" ? (
          <button
            onClick={() => onChange("reveal")}
            disabled={busy}
            className="rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            🏆 End trip & reveal
          </button>
        ) : (
          <button
            onClick={() => onChange("live")}
            disabled={busy}
            className="rounded-full border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-40 dark:border-neutral-600"
          >
            ↩️ Reopen the board
          </button>
        )}

        <button
          onClick={() => onChange("auto")}
          disabled={busy}
          className="rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-500 disabled:opacity-40 dark:border-neutral-600"
        >
          🗓️ Auto (by date)
        </button>
      </div>
      {busy && <span className="text-center text-xs text-neutral-400">Updating…</span>}
    </div>
  );
}
