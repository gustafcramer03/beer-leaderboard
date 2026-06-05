"use client";

import { useEffect, useRef, useState } from "react";
import type { LedgerEntry } from "@/lib/types";
import { getUserLedger, signedUrl, reactToBeer } from "@/lib/api";
import { REACTION_EMOJIS } from "@/lib/reactions";
import { PhotoPreview } from "./PhotoPreview";
import { BrandBadge } from "./BrandBadge";

// Save a remote image to the device. On mobile we hand it to the native share
// sheet (which offers "Save Image" / "Save to Photos" → the camera roll); if
// that isn't available we fall back to a plain download.
async function saveImageToDevice(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type || "image/jpeg" });

  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };
  if (typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return;
    } catch (e) {
      // User dismissed the share sheet — nothing more to do.
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Otherwise fall through to the download fallback.
    }
  }

  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

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
  if (e.is_happy_hour) {
    out.push({ label: "Happy hour ⏰ +1", cls: "bg-pink-100 text-pink-700" });
  }
  if (e.is_early_bird) {
    out.push({ label: "Early Bird 🐦 +1", cls: "bg-lime-100 text-lime-700" });
  }
  if (e.is_night_owl) {
    out.push({ label: "Night Owl 🌙 +1", cls: "bg-indigo-100 text-indigo-700" });
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

  // Toggle a reaction and fold the fresh server aggregate back into the entry.
  async function react(beerId: string, emoji: string) {
    try {
      const res = await reactToBeer(beerId, emoji);
      setEntries(
        (prev) =>
          prev?.map((e) =>
            e.beer_id === beerId
              ? { ...e, reactions: res.counts, my_reaction: res.mine }
              : e,
          ) ?? prev,
      );
    } catch (e) {
      console.error(e);
    }
  }

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
                {e.caption && (
                  <p className="-mt-1 px-4 pb-2 text-sm italic text-neutral-600 dark:text-neutral-300">
                    &ldquo;{e.caption}&rdquo;
                  </p>
                )}
                <ReactionBar entry={e} onReact={react} />
                {open && (
                  <>
                    {e.override_reason && (
                      <p className="border-t border-neutral-100 px-4 py-2 text-[11px] leading-snug text-indigo-700 dark:border-neutral-700 dark:text-indigo-300">
                        <span className="font-semibold">
                          {e.score_override !== null
                            ? "Adjusted ✎"
                            : e.status === "rejected"
                              ? "Ruling ⚖️ Rejected"
                              : "Ruling ⚖️"}
                        </span>{" "}
                        — {e.override_reason}
                      </p>
                    )}
                    <LedgerPhotos entry={e} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// WhatsApp-style reaction bar: existing reactions as pills (your own ringed),
// plus a "react" trigger that pops the emoji picker. Tapping an emoji toggles it
// (one reaction per person per beer).
function ReactionBar({
  entry,
  onReact,
}: {
  entry: LedgerEntry;
  onReact: (beerId: string, emoji: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const pills = Object.entries(entry.reactions).filter(([, n]) => n > 0);

  return (
    <div className="relative flex flex-wrap items-center gap-1.5 px-4 pb-3">
      {pills.map(([emoji, n]) => {
        const mine = entry.my_reaction === emoji;
        return (
          <button
            key={emoji}
            onClick={() => onReact(entry.beer_id, emoji)}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-sm transition active:scale-95 ${
              mine
                ? "bg-amber-100 ring-1 ring-amber-400 dark:bg-amber-900/40"
                : "bg-neutral-100 dark:bg-neutral-700"
            }`}
          >
            <span>{emoji}</span>
            <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-300">{n}</span>
          </button>
        );
      })}

      <button
        onClick={() => setPicking((p) => !p)}
        className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-sm text-neutral-500 transition active:scale-95 dark:bg-neutral-700 dark:text-neutral-300"
        aria-label="React to this beer"
      >
        🙂<span className="text-xs font-bold">+</span>
      </button>

      {picking && (
        <>
          {/* tap-away backdrop */}
          <button
            className="fixed inset-0 z-10 cursor-default"
            aria-label="Close reactions"
            onClick={() => setPicking(false)}
          />
          <div className="absolute bottom-9 left-4 z-20 flex gap-1 rounded-full border border-neutral-200 bg-white p-1.5 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  onReact(entry.beer_id, emoji);
                  setPicking(false);
                }}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-xl transition active:scale-90 ${
                  entry.my_reaction === emoji ? "bg-amber-100 dark:bg-amber-900/40" : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </>
      )}
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
      <Photo url={urls?.full ?? null} label="FULL" time={fmtTime(entry.full_taken_at)} brand={entry.brand} />
      <Photo url={urls?.empty ?? null} label="EMPTY" time={fmtTime(entry.empty_taken_at)} />
    </div>
  );
}

function Photo({
  url,
  label,
  time,
  brand,
}: {
  url: string | null;
  label: string;
  time: string;
  brand?: string | null;
}) {
  // A short tap opens the zoom inspector. A long-press (or right-click) reveals
  // a "Save to Photos" option — in a home-screen PWA iOS suppresses its own
  // image menu, so we provide our own.
  const [menu, setMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const timer = useRef<number | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);
  const longFired = useRef(false);

  function clearTimer() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }
  function startPress(e: React.PointerEvent) {
    if (!url) return;
    down.current = { x: e.clientX, y: e.clientY };
    longFired.current = false;
    clearTimer();
    timer.current = window.setTimeout(() => {
      longFired.current = true;
      setMenu(true);
    }, 450);
  }
  function movePress(e: React.PointerEvent) {
    const d = down.current;
    if (d && (Math.abs(e.clientX - d.x) > 8 || Math.abs(e.clientY - d.y) > 8)) {
      clearTimer(); // a scroll/drag, not a press
    }
  }
  function endPress(e: React.PointerEvent) {
    clearTimer();
    const d = down.current;
    down.current = null;
    if (!url || !d) return;
    // A clean short tap (long-press didn't fire, menu closed, little movement)
    // opens the zoom preview.
    if (
      !longFired.current &&
      !menu &&
      Math.abs(e.clientX - d.x) < 8 &&
      Math.abs(e.clientY - d.y) < 8
    ) {
      setPreview(true);
    }
  }

  async function save() {
    if (!url) return;
    setSaving(true);
    try {
      await saveImageToDevice(url, `beer-${label.toLowerCase()}-${time.replace(/\D/g, "")}.jpg`);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
      setMenu(false);
    }
  }

  return (
    <div
      className="relative aspect-square overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-700"
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerMove={movePress}
      onPointerLeave={clearTimer}
      onContextMenu={(e) => {
        if (!url) return;
        e.preventDefault();
        longFired.current = true;
        setMenu(true);
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={label}
          draggable={false}
          className="h-full w-full select-none object-cover"
          style={{ WebkitTouchCallout: "none" }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-neutral-400">…</div>
      )}
      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-bold text-white">
        {label}
      </span>
      <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">
        {time}
      </span>
      {url && (
        <span className="pointer-events-none absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          🔍
        </span>
      )}
      {url && brand && (
        <span className="pointer-events-none absolute bottom-1 left-1">
          <BrandBadge slug={brand} overlay size="xs" />
        </span>
      )}

      {menu && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/50"
          onClick={() => setMenu(false)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              save();
            }}
            disabled={saving}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-neutral-900 shadow active:scale-95 disabled:opacity-60"
          >
            {saving ? "Saving…" : "📷 Save to Photos"}
          </button>
        </div>
      )}

      {preview && url && (
        <PhotoPreview url={url} label={label} onClose={() => setPreview(false)} />
      )}
    </div>
  );
}
