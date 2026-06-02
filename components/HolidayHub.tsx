"use client";

import { useEffect, useState, useCallback } from "react";
import type { Holiday, AuditItem } from "@/lib/types";
import { getAuditQueue } from "@/lib/api";
import { useSession } from "./SessionProvider";
import { AuditDeck } from "./AuditDeck";
import { Leaderboard } from "./Leaderboard";
import { AdminQueue } from "./AdminQueue";
import { LogBeer } from "./LogBeer";

type Tab = "board" | "log" | "admin";

export function HolidayHub({ holiday, onLeave }: { holiday: Holiday; onLeave: () => void }) {
  const { userId } = useSession();
  const isAdmin = holiday.admin_id === userId;

  const [queue, setQueue] = useState<AuditItem[] | null>(null);
  const [gateCleared, setGateCleared] = useState(false);
  const [tab, setTab] = useState<Tab>("board");

  const loadQueue = useCallback(async () => {
    try {
      const q = await getAuditQueue(holiday.id);
      setQueue(q);
      setGateCleared(q.length === 0);
    } catch (e) {
      console.error(e);
      setQueue([]);
      setGateCleared(true);
    }
  }, [holiday.id]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Audit gate: must clear everyone else's pending beers before using the app.
  if (queue === null) {
    return <p className="p-8 text-center text-neutral-500">Loading…</p>;
  }

  if (!gateCleared && queue.length > 0) {
    return (
      <div className="flex flex-1 flex-col">
        <Header holiday={holiday} onLeave={onLeave} />
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <p className="mb-4 max-w-xs text-center text-sm text-neutral-500">
            Before you can log your own, audit your mates&apos; beers. Be fair! 🍻
          </p>
          <AuditDeck items={queue} onCleared={() => setGateCleared(true)} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <Header holiday={holiday} onLeave={onLeave} />

      <div className="flex-1 overflow-y-auto pb-20">
        {tab === "board" && <Leaderboard holidayId={holiday.id} />}
        {tab === "log" && (
          <LogBeer
            holidayId={holiday.id}
            onDone={() => setTab("board")}
            onCancel={() => setTab("board")}
          />
        )}
        {tab === "admin" && isAdmin && <AdminQueue holidayId={holiday.id} />}
      </div>

      <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md items-center justify-around border-t border-neutral-200 bg-white py-2 dark:border-neutral-700 dark:bg-neutral-900">
        <TabButton active={tab === "board"} onClick={() => setTab("board")} icon="🏆" label="Board" />
        <button
          onClick={() => setTab("log")}
          className="flex h-14 w-14 -translate-y-3 items-center justify-center rounded-full bg-amber-500 text-2xl text-white shadow-lg"
          aria-label="Log a beer"
        >
          🍺
        </button>
        {isAdmin ? (
          <TabButton active={tab === "admin"} onClick={() => setTab("admin")} icon="⚖️" label="Rulings" />
        ) : (
          <TabButton active={false} onClick={loadQueue} icon="🔄" label="Audit" />
        )}
      </nav>
    </div>
  );
}

function Header({ holiday, onLeave }: { holiday: Holiday; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(holiday.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <header className="flex items-center justify-between border-b border-neutral-200 p-4 dark:border-neutral-700">
      <button onClick={onLeave} className="text-sm text-neutral-400">← Holidays</button>
      <h1 className="truncate px-2 font-bold">{holiday.name}</h1>
      <button onClick={copy} className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-mono dark:bg-neutral-800">
        {copied ? "copied!" : `🔗 ${holiday.invite_code}`}
      </button>
    </header>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 px-4 text-xs ${
        active ? "text-amber-600" : "text-neutral-400"
      }`}
    >
      <span className="text-xl">{icon}</span>
      {label}
    </button>
  );
}
