"use client";

import { useEffect, useMemo, useState } from "react";
import { holidayMembers, getHeadToHead } from "@/lib/api";
import type { HolidayMember, RivalryPlayer, HeadToHead } from "@/lib/types";
import { Avatar } from "./Avatar";
import { Loading } from "./Loading";
import { ErrorBox } from "./ErrorBox";

type MetricKey =
  | "points"
  | "beers"
  | "chugs"
  | "fastest_chug"
  | "longest_chain"
  | "morning_beers"
  | "happy_hours"
  | "early_birds"
  | "night_owls"
  | "active_days";

const METRICS: { key: MetricKey; label: string; icon: string; lowerBetter?: boolean }[] = [
  { key: "points", label: "Points", icon: "🎯" },
  { key: "beers", label: "Beers", icon: "🍺" },
  { key: "chugs", label: "Chugs", icon: "⚡" },
  { key: "fastest_chug", label: "Fastest chug", icon: "⏱️", lowerBetter: true },
  { key: "longest_chain", label: "Longest chain", icon: "🔗" },
  { key: "morning_beers", label: "Morning beers", icon: "🌅" },
  { key: "happy_hours", label: "Happy hours", icon: "🍻" },
  { key: "early_birds", label: "Early bird wins", icon: "🐦" },
  { key: "night_owls", label: "Night owl wins", icon: "🌙" },
  { key: "active_days", label: "Active days", icon: "📅" },
];

// Head-to-head rivalry card: pick two players and see their stats side by side,
// the stronger value in green and the weaker in red.
export function RivalryCard({ holidayId, onClose }: { holidayId: string; onClose: () => void }) {
  const [members, setMembers] = useState<HolidayMember[] | null>(null);
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const [picking, setPicking] = useState<"a" | "b" | null>(null);
  const [data, setData] = useState<HeadToHead | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    holidayMembers(holidayId)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [holidayId]);

  useEffect(() => {
    if (!aId || !bId) {
      setData(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    getHeadToHead(holidayId, aId, bId)
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e instanceof Error ? e.message : "Couldn't load comparison"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [holidayId, aId, bId]);

  const aMember = members?.find((m) => m.user_id === aId) ?? null;
  const bMember = members?.find((m) => m.user_id === bId) ?? null;

  const players = data?.players ?? null;

  // Tally category wins so we can crown an overall leader.
  const tally = useMemo(() => {
    if (!players) return null;
    let a = 0;
    let b = 0;
    for (const m of METRICS) {
      const w = winner(players[0][m.key], players[1][m.key], m.lowerBetter);
      if (w === "a") a++;
      else if (w === "b") b++;
    }
    return { a, b };
  }, [players]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-sunken">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 className="font-display text-lg font-bold">⚔️ Head to head</h2>
        <button
          onClick={onClose}
          className="press rounded-full bg-surface-muted px-4 py-2 text-sm font-medium"
        >
          Done
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
          {/* Player slots */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <PlayerSlot member={aMember} onClick={() => setPicking("a")} />
            <span className="text-2xl font-black text-faint">VS</span>
            <PlayerSlot member={bMember} onClick={() => setPicking("b")} />
          </div>

          {/* Overall leader banner */}
          {players && tally && (
            <div className="rounded-2xl bg-gradient-to-r from-amber-400 to-yellow-500 px-4 py-3 text-center text-white shadow">
              {tally.a === tally.b ? (
                <span className="font-bold">Dead heat — {tally.a}–{tally.b} 🤝</span>
              ) : (
                <span className="font-bold">
                  👑 {(tally.a > tally.b ? players[0] : players[1]).display_name} leads{" "}
                  {Math.max(tally.a, tally.b)}–{Math.min(tally.a, tally.b)}
                </span>
              )}
            </div>
          )}

          {loading && <Loading label="Sizing up the contenders…" />}
          {error && <ErrorBox className="m-4">{error}</ErrorBox>}

          {!loading && !error && (!aId || !bId) && (
            <p className="p-8 text-center text-sm text-muted">
              Pick two players to see how they stack up. ⚔️
            </p>
          )}

          {!loading && !error && aId && bId && data && data.players === null && (
            <p className="p-8 text-center text-sm text-muted">
              🌑 The board is dark — head-to-head is hidden until the reveal.
            </p>
          )}

          {/* Comparison rows */}
          {players && (
            <div className="card overflow-hidden">
              {METRICS.map((m, i) => {
                const av = players[0][m.key];
                const bv = players[1][m.key];
                const w = winner(av, bv, m.lowerBetter);
                return (
                  <div
                    key={m.key}
                    className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-3 ${
                      i > 0 ? "border-t border-line" : ""
                    }`}
                  >
                    <span className={`text-right text-lg tabular-nums ${sideClass(w === "a", w === "b")}`}>
                      {format(m.key, av)}
                    </span>
                    <span className="flex flex-col items-center px-1 text-center">
                      <span className="text-base">{m.icon}</span>
                      <span className="text-[10px] uppercase leading-tight tracking-wide text-faint">
                        {m.label}
                      </span>
                    </span>
                    <span className={`text-left text-lg tabular-nums ${sideClass(w === "b", w === "a")}`}>
                      {format(m.key, bv)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Member picker overlay */}
      {picking && (
        <div
          className="fixed inset-0 z-[60] flex items-end bg-black/50 sm:items-center sm:justify-center"
          onClick={() => setPicking(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[70vh] w-full overflow-y-auto rounded-t-3xl bg-surface p-4 sm:max-w-sm sm:rounded-3xl"
          >
            <h3 className="mb-3 text-center font-bold">
              Choose {picking === "a" ? "the first" : "the second"} player
            </h3>
            <div className="flex flex-col gap-1">
              {(members ?? []).map((m) => {
                const takenByOther = m.user_id === (picking === "a" ? bId : aId);
                return (
                  <button
                    key={m.user_id}
                    disabled={takenByOther}
                    onClick={() => {
                      if (picking === "a") setAId(m.user_id);
                      else setBId(m.user_id);
                      setPicking(null);
                    }}
                    className="press flex items-center gap-3 rounded-xl p-2 text-left transition disabled:opacity-30 hover:bg-surface-muted"
                  >
                    <Avatar path={m.avatar_path} size={40} />
                    <span className="font-medium">{m.display_name}</span>
                    {takenByOther && <span className="ml-auto text-xs text-faint">already picked</span>}
                  </button>
                );
              })}
              {members && members.length === 0 && (
                <p className="p-4 text-center text-sm text-muted">No members found.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerSlot({ member, onClick }: { member: HolidayMember | null; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="card press flex flex-col items-center gap-2 p-3 transition"
    >
      {member ? (
        <>
          <Avatar path={member.avatar_path} size={72} />
          <span className="max-w-full truncate text-sm font-bold">{member.display_name}</span>
          <span className="text-[11px] text-accent">Change</span>
        </>
      ) : (
        <>
          <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 border-dashed border-line text-3xl text-faint">
            +
          </span>
          <span className="text-sm font-medium text-faint">Choose player</span>
        </>
      )}
    </button>
  );
}

// Which side wins a metric. null (only fastest_chug) counts as worst.
function winner(a: number | null, b: number | null, lowerBetter?: boolean): "a" | "b" | "tie" {
  if (a == null && b == null) return "tie";
  if (a == null) return "b";
  if (b == null) return "a";
  if (a === b) return "tie";
  const aWins = lowerBetter ? a < b : a > b;
  return aWins ? "a" : "b";
}

function sideClass(win: boolean, lose: boolean): string {
  if (win) return "font-bold text-good";
  if (lose) return "text-bad";
  return "text-muted";
}

function format(key: MetricKey, value: number | null): string {
  if (value == null) return "—";
  if (key === "fastest_chug") {
    if (value < 60) return `${value}s`;
    const m = Math.floor(value / 60);
    const s = value % 60;
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  return String(value);
}
