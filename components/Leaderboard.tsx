"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { StandingsResult, Standing } from "@/lib/types";
import { getStandings, refreshSnapshot, setHolidayState, setTripEnd, setTripStart } from "@/lib/api";
import { useSession } from "./SessionProvider";
import { PlayerLedger } from "./PlayerLedger";
import { RevealShow } from "./RevealShow";
import { SkeletonRows } from "./Loading";

const MEDALS = ["🥇", "🥈", "🥉"];

// Optimistic overlay: a not-yet-reconciled +N beers / +N points on your own row.
// We bump beers by exactly the count (always correct) and points by a provisional
// +1 each (a chug/chain/bonus may be worth more — the background refresh fixes it).
type Optimistic = { beers: number; points: number };

function applyOptimistic(
  standings: Standing[],
  opt: Optimistic | null,
  userId: string | null,
): Standing[] {
  if (!opt || !userId) return standings;
  const next = standings.map((s) =>
    s.user_id === userId
      ? { ...s, points: s.points + opt.points, beer_count: s.beer_count + opt.beers }
      : s,
  );
  // Mirror compute_standings ordering: points desc, beers desc, name asc.
  next.sort(
    (a, b) =>
      b.points - a.points ||
      b.beer_count - a.beer_count ||
      a.display_name.localeCompare(b.display_name),
  );
  return next;
}

export function Leaderboard({
  holidayId,
  startDate,
  startTime,
  endDate,
  endTime,
  timezone,
  active = true,
  logSignal = 0,
  penaltySignal = 0,
  refreshSignal = 0,
  onRefreshSettled,
  onOpenStats,
  onOpenRules,
}: {
  holidayId: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  active?: boolean;
  logSignal?: number;
  penaltySignal?: number;
  refreshSignal?: number;
  onRefreshSettled?: () => void;
  onOpenStats: () => void;
  onOpenRules: () => void;
}) {
  const { userId } = useSession();
  const [result, setResult] = useState<StandingsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [optimistic, setOptimistic] = useState<Optimistic | null>(null);
  const peekRef = useRef(false);

  const [peeking, setPeeking] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<{ id: string; name: string } | null>(null);
  const [stateBusy, setStateBusy] = useState(false);
  const [showReveal, setShowReveal] = useState(false);

  // The final table stays hidden until you've played the grand reveal at least
  // once (persisted per holiday so a reload doesn't re-gate you). Seeing the
  // board before the reveal would spoil the whole moment.
  const revealKey = `reveal-seen-${holidayId}`;
  const [revealSeen, setRevealSeen] = useState(false);
  useEffect(() => {
    try {
      setRevealSeen(localStorage.getItem(revealKey) === "1");
    } catch {
      // localStorage unavailable (private mode) — gate just won't persist.
    }
  }, [revealKey]);

  function closeReveal() {
    setShowReveal(false);
    setRevealSeen(true);
    try {
      localStorage.setItem(revealKey, "1");
    } catch {
      /* ignore */
    }
  }

  // Sticky "your position" chip: a clone of your own row that pins to the top
  // edge when your row has scrolled above the viewport, and to the bottom edge
  // (above the nav) when it's below. Hidden while your real row is visible.
  // rootMargin trims the bottom so a row hidden behind the nav counts as off.
  const meRef = useRef<HTMLLIElement>(null);
  const [chipPos, setChipPos] = useState<"top" | "bottom" | null>(null);

  useEffect(() => {
    const el = meRef.current;
    if (!el) {
      setChipPos(null);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setChipPos(null);
          return;
        }
        const aboveTop = entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0);
        setChipPos(aboveTop ? "top" : "bottom");
      },
      { root: null, rootMargin: "0px 0px -96px 0px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [result, userId]);

  const load = useCallback(
    async (adminPeek = false, quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        setResult(await getStandings(holidayId, adminPeek));
      } catch (e) {
        console.error(e);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [holidayId],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Reconcile the optimistic overlay against the truth: force a fresh snapshot,
  // re-fetch standings quietly (no skeleton flash), then clear the overlay.
  const reconcile = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshSnapshot(holidayId);
      await load(peekRef.current, true);
      setOptimistic(null);
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  }, [holidayId, load]);

  // Optimistic +1 the instant a beer is logged, then reconcile in the
  // background. Skip the very first render (refs seeded to incoming props).
  const prevLog = useRef(logSignal);
  useEffect(() => {
    if (logSignal === prevLog.current) return;
    prevLog.current = logSignal;
    // Only overlay when there's a visible board with your row to bump.
    setResult((cur) => {
      if (cur?.standings && cur.standings.some((s) => s.user_id === userId)) {
        setOptimistic((o) => ({
          beers: (o?.beers ?? 0) + 1,
          points: (o?.points ?? 0) + 1,
        }));
      }
      return cur;
    });
    reconcile();
  }, [logSignal, reconcile, userId]);

  // Optimistic −1 the instant a beer is declared unfinished (no beer added),
  // then reconcile. Mirrors the +1 path above.
  const prevPenalty = useRef(penaltySignal);
  useEffect(() => {
    if (penaltySignal === prevPenalty.current) return;
    prevPenalty.current = penaltySignal;
    setResult((cur) => {
      if (cur?.standings && cur.standings.some((s) => s.user_id === userId)) {
        setOptimistic((o) => ({
          beers: o?.beers ?? 0,
          points: (o?.points ?? 0) - 1,
        }));
      }
      return cur;
    });
    reconcile();
  }, [penaltySignal, reconcile, userId]);

  // Pull-to-refresh from the parent: reconcile, then tell it we've settled.
  const prevRefresh = useRef(refreshSignal);
  useEffect(() => {
    if (refreshSignal === prevRefresh.current) return;
    prevRefresh.current = refreshSignal;
    (async () => {
      await reconcile();
      onRefreshSettled?.();
    })();
  }, [refreshSignal, reconcile, onRefreshSettled]);

  // Quietly re-fetch when the board tab is re-activated (off→on), so switching
  // back from another tab shows fresh numbers without a skeleton flash. Guarded
  // by a short min-interval so rapid tab toggles don't fire duplicate fetches.
  const prevActive = useRef(active);
  const lastQuietLoad = useRef(0);
  useEffect(() => {
    if (active && !prevActive.current) {
      const now = Date.now();
      if (now - lastQuietLoad.current > 5000) {
        lastQuietLoad.current = now;
        load(peekRef.current, true);
      }
    }
    prevActive.current = active;
  }, [active, load]);

  async function adminRefresh() {
    await reconcile();
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

  async function saveTripEnd(date: string, time: string) {
    setStateBusy(true);
    try {
      await setTripEnd(holidayId, date, time);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setStateBusy(false);
    }
  }

  async function saveTripStart(date: string, time: string) {
    setStateBusy(true);
    try {
      await setTripStart(holidayId, date, time);
      await load();
    } catch (e) {
      console.error(e);
    } finally {
      setStateBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <span className="h-5 w-28 animate-pulse rounded bg-surface-muted" />
          <span className="h-5 w-20 animate-pulse rounded bg-surface-muted" />
        </div>
        <SkeletonRows count={6} />
      </div>
    );
  }
  if (!result) return <p className="p-6 text-center text-muted">No data yet.</p>;

  if (result.state === "dark" && result.standings === null) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="text-7xl">🌑</div>
        <h2 className="font-display text-xl font-bold">The board has gone dark</h2>
        <p className="max-w-xs text-sm text-muted">
          Keep drinking and logging — scores are hidden for the final stretch. The winner is
          revealed on the last day. 🍻
        </p>
        {result.reveal_at && <RevealCountdown revealAt={result.reveal_at} />}
        {result.can_peek && (
          <button
            onClick={async () => {
              setPeeking(true);
              peekRef.current = true;
              await load(true);
              setPeeking(false);
            }}
            disabled={peeking}
            className="press mt-2 rounded-full border border-accent px-4 py-2 text-sm text-accent disabled:opacity-40"
          >
            {peeking ? "Peeking…" : "👁️ Peek at standings (admin)"}
          </button>
        )}
        <div className="flex gap-2">
          <button
            onClick={onOpenStats}
            className="press rounded-full bg-surface-muted px-4 py-2 text-sm font-medium"
          >
            📊 Stats
          </button>
          <button
            onClick={onOpenRules}
            className="press rounded-full bg-surface-muted px-4 py-2 text-sm font-medium"
          >
            📖 Rules
          </button>
        </div>
        {result.is_admin && (
          <AdminTripControls
            state={result.state}
            busy={stateBusy}
            onChange={changeState}
            startDate={startDate}
            startTime={startTime}
            endDate={endDate}
            endTime={endTime}
            timezone={timezone}
            onSaveStart={saveTripStart}
            onSaveEnd={saveTripEnd}
          />
        )}
      </div>
    );
  }

  const standings = applyOptimistic(result.standings ?? [], optimistic, userId);
  const meIndex = standings.findIndex((s) => s.user_id === userId);
  const me = meIndex >= 0 ? standings[meIndex] : null;

  // Trip's over but you haven't played the reveal yet — hide the table behind a
  // cover so nobody spoils the result by glancing at the board.
  if (result.state === "reveal" && !revealSeen) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="text-7xl">🍺🥁</div>
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-2xl font-black">The trip&apos;s over!</h2>
          <p className="max-w-xs text-sm text-muted">
            The final table is under wraps. No peeking — the standings stay hidden until
            you&apos;ve been through the grand reveal.
          </p>
        </div>
        <button
          onClick={() => setShowReveal(true)}
          className="press rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-7 py-4 text-lg font-bold text-white shadow-lg"
        >
          🍺 Find out who&apos;s top of the hops
        </button>
        <button
          onClick={() => setShowReveal(true)}
          className="text-xs text-faint underline"
        >
          Tap to start the countdown from last place
        </button>

        {showReveal && (
          <RevealShow standings={standings} holidayId={holidayId} onClose={closeReveal} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {result.state === "dark" && (
        <div className="rounded-card border border-accent/40 bg-accent-soft p-3 text-center text-xs text-accent-strong">
          👁️ Admin peek — the board is dark for everyone else until the reveal.
        </div>
      )}

      {result.state === "reveal" && (
        <div className="rounded-card bg-gradient-to-r from-amber-400 to-yellow-500 p-4 text-center text-white shadow-raise">
          <div className="text-3xl">🏆 GRAND REVEAL 🏆</div>
          <p className="mt-1 text-sm font-medium text-white/90">The trip is done — final standings below.</p>
          {standings.length > 0 && (
            <button
              onClick={() => setShowReveal(true)}
              className="press mt-3 rounded-full bg-white/20 px-4 py-2 text-sm font-semibold backdrop-blur"
            >
              ▶️ Replay the reveal
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">League table</h2>
        <div className="flex items-center gap-3">
          {result.generated_at && (
            <span className="text-xs text-faint">
              updated {new Date(result.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={onOpenStats}
            aria-label="Trip stats"
            className="press rounded-full bg-surface-muted px-3 py-1.5 text-sm font-medium"
          >
            📊 Stats
          </button>
          <button
            onClick={onOpenRules}
            aria-label="How the game works"
            className="press rounded-full bg-surface-muted px-3 py-1.5 text-sm font-medium"
          >
            📖 Rules
          </button>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {standings.map((s, i) => (
          <li key={s.user_id} ref={s.user_id === userId ? meRef : null}>
            <button
              onClick={() => setLedgerFor({ id: s.user_id, name: s.display_name })}
              className={`press flex w-full items-center justify-between rounded-card border border-line px-4 py-3 text-left shadow-card ${
                s.user_id === userId ? "bg-accent-soft" : "bg-surface"
              }`}
            >
              <span className="flex items-center gap-3">
                <span className="w-6 text-center font-bold">{MEDALS[i] ?? i + 1}</span>
                <span className="font-medium">
                  {s.display_name}
                  {s.user_id === userId && <span className="text-accent"> (you)</span>}
                </span>
              </span>
              <span className="flex items-center gap-2 text-right">
                <span>
                  <span className="text-lg font-bold">{s.points}</span>
                  <span className="ml-1 text-xs text-faint">pts · {s.beer_count}🍺</span>
                </span>
                <span className="text-faint">›</span>
              </span>
            </button>
          </li>
        ))}
        {standings.length === 0 && (
          <li className="p-6 text-center text-muted">No beers logged yet. Be the first! 🍺</li>
        )}
      </ul>

      {result.is_admin && (
        <>
          <button
            onClick={adminRefresh}
            disabled={refreshing}
            className="press mt-2 self-center rounded-full border border-accent px-4 py-2 text-sm text-accent disabled:opacity-40"
          >
            {refreshing ? "Refreshing…" : "↻ Refresh now (admin)"}
          </button>
          <AdminTripControls
            state={result.state}
            busy={stateBusy}
            onChange={changeState}
            startDate={startDate}
            startTime={startTime}
            endDate={endDate}
            endTime={endTime}
            timezone={timezone}
            onSaveStart={saveTripStart}
            onSaveEnd={saveTripEnd}
          />
        </>
      )}
      <p className="text-center text-xs text-faint">
        {refreshing ? "Syncing the latest scores…" : "Pull down to refresh. Tap a player to see their beers."}
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
        <RevealShow standings={standings} holidayId={holidayId} onClose={closeReveal} />
      )}

      {chipPos && me && (
        <button
          onClick={() => meRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
          className={`press fixed inset-x-0 z-30 mx-auto flex w-[calc(100%-2rem)] max-w-md items-center justify-between rounded-card border border-accent/40 bg-accent-soft px-4 py-3 text-left shadow-raise ring-1 ring-accent/30 ${
            chipPos === "top" ? "top-2" : "bottom-24"
          }`}
        >
          <span className="flex items-center gap-3">
            <span className="w-6 text-center font-bold">{MEDALS[meIndex] ?? meIndex + 1}</span>
            <span className="font-medium">
              {me.display_name}
              <span className="text-accent"> (you)</span>
            </span>
          </span>
          <span className="flex items-center gap-2 text-right">
            <span>
              <span className="text-lg font-bold">{me.points}</span>
              <span className="ml-1 text-xs text-faint">pts · {me.beer_count}🍺</span>
            </span>
            <span className="text-accent">{chipPos === "top" ? "↑" : "↓"}</span>
          </span>
        </button>
      )}
    </div>
  );
}

// Live countdown to the grand reveal shown on the dark screen. Ticks every
// second; once the target passes it flips to an "imminent" message (the admin
// may have forced the board dark past end_date, so the board itself stays dark
// until the state actually flips to reveal).
function RevealCountdown({ revealAt }: { revealAt: string }) {
  const target = new Date(revealAt).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = target - now;

  if (remaining <= 0) {
    return (
      <div className="mt-2 rounded-card border border-accent/40 bg-accent-soft px-5 py-3 text-center text-sm font-semibold text-accent-strong">
        🏆 The reveal is imminent…
      </div>
    );
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const units: { value: number; label: string }[] = [
    { value: days, label: "days" },
    { value: hours, label: "hrs" },
    { value: minutes, label: "min" },
    { value: seconds, label: "sec" },
  ];

  return (
    <div className="mt-2 flex flex-col items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-faint">
        Grand reveal in
      </span>
      <div className="flex gap-2">
        {units.map((u) => (
          <div
            key={u.label}
            className="flex min-w-14 flex-col items-center rounded-xl bg-surface-muted px-3 py-2"
          >
            <span className="text-2xl font-bold tabular-nums">
              {String(u.value).padStart(2, "0")}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-faint">{u.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Admin-only board-state controls. Toggle the dark window on/off and end the
// trip to trigger the reveal. 'auto' hands control back to the calendar.
function AdminTripControls({
  state,
  busy,
  onChange,
  startDate,
  startTime,
  endDate,
  endTime,
  timezone,
  onSaveStart,
  onSaveEnd,
}: {
  state: "live" | "dark" | "reveal";
  busy: boolean;
  onChange: (s: "live" | "dark" | "reveal" | "auto") => void;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  onSaveStart: (date: string, time: string) => void;
  onSaveEnd: (date: string, time: string) => void;
}) {
  // times arrive as a Postgres time ("HH:MM:SS"); inputs want "HH:MM".
  const [sDate, setSDate] = useState(startDate);
  const [sTime, setSTime] = useState(startTime.slice(0, 5));
  const startDirty = sDate !== startDate || sTime !== startTime.slice(0, 5);
  const [date, setDate] = useState(endDate);
  const [time, setTime] = useState(endTime.slice(0, 5));
  const dirty = date !== endDate || time !== endTime.slice(0, 5);

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-card border border-line p-3">
      <span className="text-center text-xs font-semibold uppercase tracking-wide text-faint">
        Admin controls
      </span>

      <div className="flex flex-col gap-2 rounded-xl bg-surface-muted p-3">
        <span className="text-xs font-medium text-muted">
          Scheduled start {timezone ? `(${timezone})` : ""}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={sDate}
            onChange={(e) => setSDate(e.target.value)}
            disabled={busy}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          />
          <input
            type="time"
            value={sTime}
            onChange={(e) => setSTime(e.target.value)}
            disabled={busy}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          />
          <button
            onClick={() => onSaveStart(sDate, sTime)}
            disabled={busy || !startDirty || !sDate || !sTime}
            className="press rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-40"
          >
            Save start
          </button>
        </div>
        <span className="text-[11px] text-faint">Beers can only be logged once the trip has started.</span>
      </div>

      <div className="flex flex-col gap-2 rounded-xl bg-surface-muted p-3">
        <span className="text-xs font-medium text-muted">
          Scheduled end {timezone ? `(${timezone})` : ""}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={busy}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          />
          <button
            onClick={() => onSaveEnd(date, time)}
            disabled={busy || !dirty || !date || !time}
            className="press rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-40"
          >
            Save end
          </button>
        </div>
        <span className="text-[11px] text-faint">
          The board reveals at this moment; it goes dark the configured number of days before.
        </span>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {state !== "dark" ? (
          <button
            onClick={() => onChange("dark")}
            disabled={busy}
            className="press rounded-full bg-text px-4 py-2 text-sm font-medium text-surface disabled:opacity-40"
          >
            🌑 Go dark
          </button>
        ) : (
          <button
            onClick={() => onChange("live")}
            disabled={busy}
            className="press rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-contrast disabled:opacity-40"
          >
            ☀️ Lift the dark
          </button>
        )}

        {state !== "reveal" ? (
          <button
            onClick={() => onChange("reveal")}
            disabled={busy}
            className="press rounded-full bg-gradient-to-r from-amber-400 to-yellow-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            🏆 End trip & reveal
          </button>
        ) : (
          <button
            onClick={() => onChange("live")}
            disabled={busy}
            className="press rounded-full border border-line px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            ↩️ Reopen the board
          </button>
        )}

        <button
          onClick={() => onChange("auto")}
          disabled={busy}
          className="press rounded-full border border-line px-4 py-2 text-sm text-muted disabled:opacity-40"
        >
          🗓️ Auto (by date)
        </button>
      </div>
      {busy && <span className="text-center text-xs text-faint">Updating…</span>}
    </div>
  );
}
