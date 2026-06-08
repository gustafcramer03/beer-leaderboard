"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Holiday, AuditItem } from "@/lib/types";
import { tabVariants, sheetVariants } from "@/lib/motion";
import { getAuditQueue, challengedBeers, uploadAvatar } from "@/lib/api";
import { useSession } from "./SessionProvider";
import { Avatar } from "./Avatar";
import { AuditDeck } from "./AuditDeck";
import { Leaderboard } from "./Leaderboard";
import { AdminQueue } from "./AdminQueue";
import { AdminBeers } from "./AdminBeers";
import { LogBeer } from "./LogBeer";
import { HappyHourBanner } from "./HappyHourBanner";
import { AchievementsCabinet } from "./AchievementsCabinet";
import { DailyRecapPopup, DailyRecapView } from "./DailyRecap";
import { RuleBook } from "./RuleBook";
import { TripStats } from "./TripStats";
import { PaceBoard } from "./PaceBoard";
import { DrinkingHeatmap } from "./DrinkingHeatmap";
import { BeerInsights } from "./BeerInsights";
import { RivalryCard } from "./RivalryCard";
import { ActivityFeed } from "./ActivityFeed";
import { ShareCardView } from "./ShareCard";
import { PushToggle } from "./PushToggle";
import { Loading } from "./Loading";

type Tab = "board" | "log" | "menu";
type MenuView =
  | "achievements"
  | "stats"
  | "pace"
  | "heatmap"
  | "insights"
  | "rivalry"
  | "activity"
  | "recap"
  | "share"
  | "rules"
  | "rulings"
  | "manage";

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

  // Optimistic board + pull-to-refresh wiring. `logSignal` bumps the board's
  // own row by +1 the instant a beer is logged; `refreshSignal` triggers a
  // background reconcile from the pull gesture. `pull` is the live drag offset
  // (px) for the rubber-band indicator; `pullRefreshing` keeps the spinner up
  // until the board reports it has settled.
  const [logSignal, setLogSignal] = useState(0);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [pull, setPull] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);

  const PULL_THRESHOLD = 60;
  const PULL_MAX = 110;

  function onTouchStart(e: React.TouchEvent) {
    // Only arm the gesture on the board tab, at the very top of the scroller,
    // and when we're not already refreshing.
    if (tab !== "board" || pullRefreshing) return;
    if ((scrollRef.current?.scrollTop ?? 0) > 0) return;
    startY.current = e.touches[0].clientY;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy <= 0) {
      setPull(0);
      return;
    }
    // Rubber-band: damp the drag and cap it.
    setPull(Math.min(PULL_MAX, dy * 0.5));
  }

  function onTouchEnd() {
    if (startY.current === null) return;
    if (pull >= PULL_THRESHOLD && !pullRefreshing) {
      setPullRefreshing(true);
      setRefreshSignal((n) => n + 1);
    }
    setPull(0);
    startY.current = null;
  }

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
    // Poll only while visible, and coalesce the focus + visibilitychange events
    // (both fire on tab-return) so we don't double-fetch on every switch back.
    let last = 0;
    const tick = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - last < 3000) return;
      last = now;
      refreshBadges();
    };
    tick();
    const id = setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [gateCleared, refreshBadges]);

  // Audit gate: must clear everyone else's pending beers before using the app.
  if (queue === null) {
    return <Loading label="Lining up the bottles…" />;
  }

  if (!gateCleared && queue.length > 0) {
    return (
      <div className="flex flex-1 flex-col">
        <HappyHourBanner holidayId={holiday.id} />
        <Header holiday={holiday} onLeave={onLeave} />
        <div className="flex flex-1 flex-col items-center justify-start p-4 pt-2">
          <p className="mb-3 max-w-xs text-center text-sm text-muted">
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
      <DailyRecapPopup holidayId={holiday.id} />
      <HappyHourBanner holidayId={holiday.id} />
      <Header holiday={holiday} onLeave={onLeave} />

      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto pb-28"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {tab === "board" && (pull > 0 || pullRefreshing) && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-center"
            style={{ height: pullRefreshing ? 44 : pull }}
          >
            <span
              className="text-2xl"
              style={{
                transform: pullRefreshing
                  ? "none"
                  : `rotate(${Math.min(180, (pull / PULL_THRESHOLD) * 180)}deg)`,
              }}
            >
              {pullRefreshing ? "🍺" : pull >= PULL_THRESHOLD ? "🍺" : "↓"}
            </span>
          </div>
        )}
        {/* Board stays mounted across tabs so its optimistic state survives. */}
        <div
          className={tab === "board" ? "" : "hidden"}
          style={
            tab === "board" && (pull > 0 || pullRefreshing)
              ? { transform: `translateY(${pullRefreshing ? 44 : pull}px)`, transition: startY.current === null ? "transform 0.2s" : "none", willChange: "transform" }
              : undefined
          }
        >
          <Leaderboard
            holidayId={holiday.id}
            endDate={holiday.end_date}
            endTime={holiday.end_time}
            timezone={holiday.timezone}
            active={tab === "board"}
            logSignal={logSignal}
            refreshSignal={refreshSignal}
            onRefreshSettled={() => setPullRefreshing(false)}
            onOpenStats={() => setView("stats")}
            onOpenRules={() => setView("rules")}
          />
        </div>
        <AnimatePresence mode="wait">
          {tab === "log" && (
            <motion.div key="log" variants={tabVariants} initial="initial" animate="enter" exit="exit">
              <LogBeer
                holidayId={holiday.id}
                onDone={() => {
                  setLogSignal((n) => n + 1);
                  setTab("board");
                }}
                onCancel={() => setTab("board")}
              />
            </motion.div>
          )}
          {tab === "menu" && (
            <motion.div key="menu" variants={tabVariants} initial="initial" animate="enter" exit="exit">
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 mx-auto flex max-w-md items-center justify-around border-t border-line bg-surface pt-2 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-nav">
        <TabButton active={tab === "board"} onClick={() => setTab("board")} icon="🏆" label="Board" />
        <button
          onClick={() => setTab("log")}
          className="press flex h-14 w-14 -translate-y-3 items-center justify-center rounded-full bg-accent text-2xl text-accent-contrast shadow-lg"
          aria-label="Log a beer"
        >
          🍺
        </button>
        <TabButton active={tab === "menu"} onClick={() => setTab("menu")} icon="☰" label="Menu" badge={auditCount + rulingCount} />
      </nav>

      <AnimatePresence>
        {view && (
          <motion.div
            key={view}
            className="fixed inset-0 z-50"
            variants={sheetVariants}
            initial="initial"
            animate="enter"
            exit="exit"
          >
            {renderView()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  function renderView() {
    const close = () => setView(null);
    const closeAndRefresh = () => {
      setView(null);
      refreshBadges();
    };
    switch (view) {
      case "achievements":
        return userId ? (
          <AchievementsCabinet holidayId={holiday.id} userId={userId} onClose={close} />
        ) : null;
      case "stats":
        return <StatsView holidayId={holiday.id} onClose={close} />;
      case "pace":
        return <PaceBoard holidayId={holiday.id} onClose={close} />;
      case "heatmap":
        return <DrinkingHeatmap holidayId={holiday.id} onClose={close} />;
      case "insights":
        return <BeerInsights holidayId={holiday.id} onClose={close} />;
      case "rivalry":
        return <RivalryCard holidayId={holiday.id} onClose={close} />;
      case "activity":
        return <ActivityFeed holidayId={holiday.id} timezone={holiday.timezone} onClose={close} />;
      case "recap":
        return <DailyRecapView holidayId={holiday.id} onClose={close} />;
      case "share":
        return <ShareCardView holidayId={holiday.id} onClose={close} />;
      case "rules":
        return <RuleBook onClose={close} />;
      case "rulings":
        return isAdmin ? <RulingsView holidayId={holiday.id} onClose={closeAndRefresh} /> : null;
      case "manage":
        return isAdmin ? <ManageView holidayId={holiday.id} onClose={closeAndRefresh} /> : null;
      default:
        return null;
    }
  }
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
      <h2 className="font-display text-2xl font-bold">Menu</h2>
      <ProfileCard displayName={displayName} avatarPath={avatarPath} onChangeAvatar={onChangeAvatar} />
      <PushToggle />
      <div className="grid grid-cols-2 gap-3">
        <MenuTile icon="🏅" label="Trophy cabinet" sub="Your achievements" onClick={() => onSelect("achievements")} />
        <MenuTile icon="📊" label="Trip stats" sub="Group highlights" onClick={() => onSelect("stats")} />
        <MenuTile icon="📰" label="What's happening" sub="Live activity feed" onClick={() => onSelect("activity")} />
        <MenuTile icon="🌅" label="Daily recap" sub="Yesterday's wrap-up" onClick={() => onSelect("recap")} />
        <MenuTile icon="📈" label="Pace board" sub="Trends & projections" onClick={() => onSelect("pace")} />
        <MenuTile icon="🔥" label="Drinking heatmap" sub="When the group drinks" onClick={() => onSelect("heatmap")} />
        <MenuTile icon="🍻" label="Beer insights" sub="Most popular brands" onClick={() => onSelect("insights")} />
        <MenuTile icon="⚔️" label="Head to head" sub="Compare two players" onClick={() => onSelect("rivalry")} />
        <MenuTile icon="📲" label="Share card" sub="Flex on your story" onClick={() => onSelect("share")} />
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
        {isAdmin && (
          <MenuTile
            icon="🛠️"
            label="Manage beers"
            sub="Fix scores & rulings"
            onClick={() => onSelect("manage")}
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
    <div className="card flex items-center gap-3 p-4">
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
        <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs text-accent-contrast shadow">
          📷
        </span>
      </button>
      <div className="min-w-0">
        <div className="truncate font-bold">{displayName}</div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="text-xs font-medium text-accent disabled:opacity-50"
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
      className="press card relative flex flex-col items-center gap-1 p-5 text-center"
    >
      {badge > 0 && <CountBubble count={badge} className="right-2 top-2" />}
      <span className="text-4xl">{icon}</span>
      <span className="mt-1 text-sm font-bold leading-tight">{label}</span>
      <span className="text-[11px] leading-tight text-faint">{sub}</span>
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
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-sunken">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 className="font-display text-xl font-bold">📊 Trip stats</h2>
        <button
          onClick={onClose}
          className="press rounded-full bg-surface-muted px-4 py-2 text-sm font-medium"
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
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-sunken">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 className="font-display text-xl font-bold">⚖️ Rulings</h2>
        <button
          onClick={onClose}
          className="press rounded-full bg-surface-muted px-4 py-2 text-sm font-medium"
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

// Full-screen wrapper around the admin "Manage beers" board — revisit and fix
// the score/status of any beer in the trip after the initial ruling.
function ManageView({ holidayId, onClose }: { holidayId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-sunken">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 className="font-display text-xl font-bold">🛠️ Manage beers</h2>
        <button
          onClick={onClose}
          className="press rounded-full bg-surface-muted px-4 py-2 text-sm font-medium"
        >
          Done
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-md">
          <AdminBeers holidayId={holidayId} />
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
    <header className="flex items-center justify-between border-b border-line p-4">
      <button onClick={onLeave} className="text-sm text-faint">← Holidays</button>
      <h1 className="truncate px-2 font-display text-lg font-bold">{holiday.name}</h1>
      <button onClick={copy} className="press rounded-full bg-surface-muted px-3 py-1 text-xs font-mono">
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
      aria-current={active ? "page" : undefined}
      className={`press relative flex flex-col items-center gap-0.5 px-4 text-xs ${
        active ? "text-accent" : "text-faint"
      }`}
    >
      {badge > 0 && <CountBubble count={badge} className="right-1 -top-1" />}
      <span
        className={`flex h-8 w-12 items-center justify-center rounded-full text-xl transition-colors ${
          active ? "bg-accent-soft" : ""
        }`}
      >
        {icon}
      </span>
      <span className={active ? "font-semibold" : ""}>{label}</span>
    </button>
  );
}
