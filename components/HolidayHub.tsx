"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Holiday, AuditItem } from "@/lib/types";
import { getAuditQueue, challengedBeers, uploadAvatar } from "@/lib/api";
import { useSession } from "./SessionProvider";
import { Avatar } from "./Avatar";
import { AuditDeck } from "./AuditDeck";
import { Leaderboard } from "./Leaderboard";
import { AdminQueue } from "./AdminQueue";
import { LogBeer } from "./LogBeer";
import { HappyHourBanner } from "./HappyHourBanner";
import { AchievementsCabinet } from "./AchievementsCabinet";
import { RuleBook } from "./RuleBook";
import { TripStats } from "./TripStats";
import { PaceBoard } from "./PaceBoard";

type Tab = "board" | "log" | "menu";
type MenuView = "achievements" | "stats" | "pace" | "rules" | "rulings";

export function HolidayHub({ holiday, onLeave }: { holiday: Holiday; onLeave: () => void }) {
  const { userId, profile, refreshProfile } = useSession();
  const isAdmin = holiday.admin_id === userId;

  async function changeAvatar(file: File) {
    await uploadAvatar(file);
    await refreshProfile();
  }

  const [queue, setQueue] = useState<AuditItem[] | null>(null);
  const [gateCleared, setGateCleared] = useState(false);
  const [tab, setTab] = useState<Tab>("board");
  const [view, setView] = useState<MenuView | null>(null);
  const [auditCount, setAuditCount] = useState(0);
  const [rulingCount, setRulingCount] = useState(0);

  const loadQueue = useCallback(async () => {
    try {
      const q = await getAuditQueue(holiday.id);
      setQueue(q);
      setAuditCount(q.length);
      setGateCleared(q.length === 0);
    } catch (e) {
      console.error(e);
      setQueue([]);
      setAuditCount(0);
      setGateCleared(true);
    }
  }, [holiday.id]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Display-only counts for the nudge badges — refreshed without re-triggering
  // the audit gate, so beers others log/challenge while you're in the app
  // surface on the Menu. Ruling count is admin-only (beers awaiting a ruling).
  const refreshBadges = useCallback(async () => {
    try {
      const q = await getAuditQueue(holiday.id);
      setAuditCount(q.length);
    } catch {
      /* badge is best-effort; ignore failures */
    }
    if (isAdmin) {
      try {
        const c = await challengedBeers(holiday.id);
        setRulingCount(c.length);
      } catch {
        /* ignore */
      }
    }
  }, [holiday.id, isAdmin]);

  useEffect(() => {
    if (!gateCleared) return;
    refreshBadges();
    const id = setInterval(refreshBadges, 60_000);
    const onFocus = () => refreshBadges();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [gateCleared, refreshBadges]);

  // Audit gate: must clear everyone else's pending beers before using the app.
  if (queue === null) {
    return <p className="p-8 text-center text-neutral-500">Loading…</p>;
  }

  if (!gateCleared && queue.length > 0) {
    return (
      <div className="flex flex-1 flex-col">
        <HappyHourBanner holidayId={holiday.id} />
        <Header holiday={holiday} onLeave={onLeave} />
        <div className="flex flex-1 flex-col items-center justify-start p-4 pt-2">
          <p className="mb-3 max-w-xs text-center text-sm text-neutral-500">
            Before you can log your own, audit your mates&apos; beers. Be fair! 🍻
          </p>
          <AuditDeck
            items={queue}
            onCleared={() => {
              setGateCleared(true);
              setAuditCount(0);
            }}
          />
        </div>
      </div>
    );
  }

  function openView(v: MenuView) {
    setView(v);
  }

  async function recheckAudit() {
    await loadQueue();
  }

  return (
    <div className="flex flex-1 flex-col">
      <HappyHourBanner holidayId={holiday.id} />
      <Header holiday={holiday} onLeave={onLeave} />

      <div className="flex-1 overflow-y-auto pb-28">
        {tab === "board" && (
          <Leaderboard
            holidayId={holiday.id}
            onOpenStats={() => setView("stats")}
            onOpenRules={() => setView("rules")}
          />
        )}
        {tab === "log" && (
          <LogBeer
            holidayId={holiday.id}
            onDone={() => setTab("board")}
            onCancel={() => setTab("board")}
          />
        )}
        {tab === "menu" && (
          <MenuPage
            isAdmin={isAdmin}
            onSelect={openView}
            onRecheckAudit={recheckAudit}
            auditCount={auditCount}
            rulingCount={rulingCount}
            displayName={profile?.display_name ?? "You"}
            avatarPath={profile?.avatar_path ?? null}
            onChangeAvatar={changeAvatar}
          />
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md items-center justify-around border-t border-neutral-200 bg-white pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] dark:border-neutral-700 dark:bg-neutral-900">
        <TabButton active={tab === "board"} onClick={() => setTab("board")} icon="🏆" label="Board" />
        <button
          onClick={() => setTab("log")}
          className="flex h-14 w-14 -translate-y-3 items-center justify-center rounded-full bg-amber-500 text-2xl text-white shadow-lg"
          aria-label="Log a beer"
        >
          🍺
        </button>
        <TabButton active={tab === "menu"} onClick={() => setTab("menu")} icon="☰" label="Menu" badge={auditCount + rulingCount} />
      </nav>

      {view === "achievements" && userId && (
        <AchievementsCabinet
          holidayId={holiday.id}
          userId={userId}
          onClose={() => setView(null)}
        />
      )}
      {view === "stats" && <StatsView holidayId={holiday.id} onClose={() => setView(null)} />}
      {view === "pace" && <PaceBoard holidayId={holiday.id} onClose={() => setView(null)} />}
      {view === "rules" && <RuleBook onClose={() => setView(null)} />}
      {view === "rulings" && isAdmin && (
        <RulingsView
          holidayId={holiday.id}
          onClose={() => {
            setView(null);
            refreshBadges();
          }}
        />
      )}
    </div>
  );
}

// The Menu page: every secondary page laid out as a grid of tiles.
function MenuPage({
  isAdmin,
  onSelect,
  onRecheckAudit,
  auditCount,
  rulingCount,
  displayName,
  avatarPath,
  onChangeAvatar,
}: {
  isAdmin: boolean;
  onSelect: (v: MenuView) => void;
  onRecheckAudit: () => void;
  auditCount: number;
  rulingCount: number;
  displayName: string;
  avatarPath: string | null;
  onChangeAvatar: (file: File) => Promise<void>;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <h2 className="text-lg font-bold">Menu</h2>
      <ProfileCard displayName={displayName} avatarPath={avatarPath} onChangeAvatar={onChangeAvatar} />
      <div className="grid grid-cols-2 gap-3">
        <MenuTile icon="🏅" label="Trophy cabinet" sub="Your achievements" onClick={() => onSelect("achievements")} />
        <MenuTile icon="📊" label="Trip stats" sub="Group highlights" onClick={() => onSelect("stats")} />
        <MenuTile icon="📈" label="Pace board" sub="Trends & projections" onClick={() => onSelect("pace")} />
        <MenuTile icon="📖" label="How to play" sub="Rules & scoring" onClick={() => onSelect("rules")} />
        <MenuTile
          icon="🔄"
          label="Audit beers"
          sub={auditCount > 0 ? `${auditCount} waiting` : "Check for new ones"}
          onClick={onRecheckAudit}
          badge={auditCount}
        />
        {isAdmin && (
          <MenuTile
            icon="⚖️"
            label="Rulings"
            sub={rulingCount > 0 ? `${rulingCount} to settle` : "Settle challenges"}
            onClick={() => onSelect("rulings")}
            badge={rulingCount}
          />
        )}
      </div>
    </div>
  );
}

// Profile header in the Menu: your avatar + name with a tap-to-change photo.
// Doubles as the way existing accounts (who never saw the sign-up step) add one.
function ProfileCard({
  displayName,
  avatarPath,
  onChangeAvatar,
}: {
  displayName: string;
  avatarPath: string | null;
  onChangeAvatar: (file: File) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await onChangeAvatar(file);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-800">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="relative disabled:opacity-50"
        aria-label="Change profile photo"
      >
        <Avatar path={avatarPath} size={56} />
        <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs text-white shadow">
          📷
        </span>
      </button>
      <div className="min-w-0">
        <div className="truncate font-bold">{displayName}</div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="text-xs font-medium text-amber-600 disabled:opacity-50"
        >
          {busy ? "Uploading…" : avatarPath ? "Change photo" : "Add a profile photo"}
        </button>
      </div>
    </div>
  );
}

function MenuTile({
  icon,
  label,
  sub,
  onClick,
  badge = 0,
}: {
  icon: string;
  label: string;
  sub: string;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex flex-col items-center gap-1 rounded-2xl bg-white p-5 text-center shadow-sm transition active:scale-[0.98] dark:bg-neutral-800"
    >
      {badge > 0 && <CountBubble count={badge} className="right-2 top-2" />}
      <span className="text-4xl">{icon}</span>
      <span className="mt-1 text-sm font-bold leading-tight">{label}</span>
      <span className="text-[11px] leading-tight text-neutral-400">{sub}</span>
    </button>
  );
}

// Red notification bubble used for the audit nudge.
function CountBubble({ count, className = "" }: { count: number; className?: string }) {
  return (
    <span
      className={`absolute flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white shadow ${className}`}
      aria-label={`${count} beers to audit`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// Full-screen wrapper around the trip stats view (lives in the Menu now).
function StatsView({ holidayId, onClose }: { holidayId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50 dark:bg-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
        <h2 className="text-lg font-bold">📊 Trip stats</h2>
        <button
          onClick={onClose}
          className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium dark:bg-neutral-700"
        >
          Done
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-md">
          <TripStats holidayId={holidayId} />
        </div>
      </div>
    </div>
  );
}

// Full-screen wrapper around the admin rulings queue (moved into the Menu).
function RulingsView({ holidayId, onClose }: { holidayId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50 dark:bg-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
        <h2 className="text-lg font-bold">⚖️ Rulings</h2>
        <button
          onClick={onClose}
          className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium dark:bg-neutral-700"
        >
          Done
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-md">
          <AdminQueue holidayId={holidayId} />
        </div>
      </div>
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
  badge = 0,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center gap-0.5 px-4 text-xs ${
        active ? "text-amber-600" : "text-neutral-400"
      }`}
    >
      {badge > 0 && <CountBubble count={badge} className="right-1 -top-1" />}
      <span className="text-xl">{icon}</span>
      {label}
    </button>
  );
}
