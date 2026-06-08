"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate, type PanInfo } from "framer-motion";
import type { AuditItem } from "@/lib/types";
import { signedUrls, submitReview } from "@/lib/api";
import { PhotoPreview } from "./PhotoPreview";
import { BrandBadge } from "./BrandBadge";
import { useToast } from "./Toast";

function secondsBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
}

function fmtGap(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

function stamp(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function AuditDeck({
  items,
  onCleared,
}: {
  items: AuditItem[];
  onCleared: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [urls, setUrls] = useState<{ full: string | null; empty: string | null }>({
    full: null,
    empty: null,
  });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const { toast } = useToast();

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  // Labels are primed at a low opacity even at rest (so the swipe meaning is
  // obvious before you drag), then ramp to full as you pull that way.
  const confirmOpacity = useTransform(x, [0, 40, 130], [0.3, 0.45, 1]); // swipe RIGHT = legit
  const challengeOpacity = useTransform(x, [-130, -40, 0], [1, 0.45, 0.3]); // swipe LEFT = challenge

  const current = items[index];

  // Cache signed URLs per beer so an already-seen card is instant, and so we can
  // prefetch the NEXT card's photos while you look at the current one.
  const urlCache = useRef<Map<string, { full: string | null; empty: string | null }>>(new Map());

  const loadUrls = useCallback(async (item: AuditItem | undefined) => {
    if (!item) return null;
    const cached = urlCache.current.get(item.beer_id);
    if (cached) return cached;
    const map = await signedUrls([item.full_photo_path, item.empty_photo_path]);
    const entry = {
      full: map[item.full_photo_path] ?? null,
      empty: map[item.empty_photo_path] ?? null,
    };
    urlCache.current.set(item.beer_id, entry);
    return entry;
  }, []);

  useEffect(() => {
    let active = true;
    if (!current) return;
    setUrls(urlCache.current.get(current.beer_id) ?? { full: null, empty: null });
    (async () => {
      const entry = await loadUrls(current);
      if (active && entry) setUrls(entry);
      // Warm the next card's photos in the background so the swipe feels instant.
      void loadUrls(items[index + 1]);
    })();
    return () => {
      active = false;
    };
  }, [current, index, items, loadUrls]);

  async function decide(verdict: "confirm" | "challenge") {
    if (!current || busy) return;
    setBusy(true);
    try {
      await submitReview(current.beer_id, verdict);
    } catch (e) {
      console.error(e);
      // Don't skip the card on failure — bring it back so the vote can be retried.
      toast("Couldn't submit your verdict — try again", "error");
      setBusy(false);
      animate(x, 0, { type: "spring", stiffness: 600, damping: 38 });
      return;
    }
    const next = index + 1;
    x.set(0);
    setBusy(false);
    if (next >= items.length) {
      onCleared();
    } else {
      setIndex(next);
    }
  }

  function onDragEnd(_: unknown, info: PanInfo) {
    const offset = info.offset.x;
    const velocity = info.velocity.x;
    if (offset > 100 || velocity > 450) flyOut(550, () => decide("confirm"));
    else if (offset < -100 || velocity < -450) flyOut(-550, () => decide("challenge"));
    else animate(x, 0, { type: "spring", stiffness: 600, damping: 38 });
  }

  function flyOut(to: number, then: () => void) {
    animate(x, to, { duration: 0.18, ease: "easeOut", onComplete: then });
  }

  if (!current) return null;

  const gap = secondsBetween(current.full_taken_at, current.empty_taken_at);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-center">
        <p className="text-sm text-muted">
          {items.length - index} beer{items.length - index === 1 ? "" : "s"} left to audit
        </p>
        <p className="text-xs text-faint">
          Swipe <span className="font-semibold text-green-600">right = legit</span> ·{" "}
          <span className="font-semibold text-red-600">left = challenge</span>
        </p>
      </div>

      <motion.div
        style={{ x, rotate }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={1}
        dragMomentum={false}
        onDragEnd={onDragEnd}
        className="relative w-full max-w-sm cursor-grab touch-none rounded-3xl bg-surface p-3 shadow-raise will-change-transform active:cursor-grabbing"
      >
        <motion.div
          style={{ opacity: confirmOpacity }}
          className="absolute right-4 top-4 z-10 rotate-[12deg] rounded-lg border-4 border-green-500 px-3 py-1 text-xl font-black text-green-500"
        >
          LEGIT
        </motion.div>
        <motion.div
          style={{ opacity: challengeOpacity }}
          className="absolute left-4 top-4 z-10 rotate-[-12deg] rounded-lg border-4 border-red-500 px-3 py-1 text-xl font-black text-red-500"
        >
          CHALLENGE
        </motion.div>

        <p className="mb-1 text-center font-bold">{current.owner_name}</p>
        {current.is_offline && (
          <p className="mb-2 text-center text-xs font-semibold text-sky-600">
            🛜 Logged offline — time is from the photo&apos;s metadata
          </p>
        )}
        {current.caption && (
          <p className="mb-2 text-center text-sm italic text-muted">
            &ldquo;{current.caption}&rdquo;
          </p>
        )}
        <div className="mb-2 flex items-center justify-center gap-2">
          <div className="flex flex-col items-center rounded-xl bg-surface-muted px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
              Full 🍺
            </span>
            <span className="text-base font-bold tabular-nums">{stamp(current.full_taken_at)}</span>
          </div>
          <div className="flex flex-col items-center px-1 leading-tight text-muted">
            <span className="text-lg">→</span>
            <span className="text-xs font-bold">{fmtGap(gap)}</span>
          </div>
          <div className="flex flex-col items-center rounded-xl bg-surface-muted px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
              Empty 🏁
            </span>
            <span className="text-base font-bold tabular-nums">{stamp(current.empty_taken_at)}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2">
          <Photo
            url={urls.full}
            label="FULL"
            time={stamp(current.full_taken_at)}
            brand={current.brand}
            onOpen={() => urls.full && setPreview({ url: urls.full, label: "FULL" })}
          />
          <Photo
            url={urls.empty}
            label="EMPTY"
            time={stamp(current.empty_taken_at)}
            onOpen={() => urls.empty && setPreview({ url: urls.empty, label: "EMPTY" })}
          />
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs">
          {current.claimed_chug && (
            <span className="rounded-full bg-accent-soft px-2 py-1 text-accent-strong">
              claims chug 🍺×2
            </span>
          )}
          {!current.claimed_chug && gap <= 60 && (
            <span className="rounded-full bg-surface-muted px-2 py-1 text-muted">
              fast finish ({fmtGap(gap)}) · not claimed
            </span>
          )}
          {current.is_morning && (
            <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700">Morning +1</span>
          )}
          {current.is_happy_hour && (
            <span className="rounded-full bg-pink-100 px-2 py-1 text-pink-700">Happy hour ⏰ +1</span>
          )}
          {current.is_early_bird && (
            <span className="rounded-full bg-lime-100 px-2 py-1 text-lime-700">Early Bird 🐦 +1</span>
          )}
          {current.is_night_owl && (
            <span className="rounded-full bg-indigo-100 px-2 py-1 text-indigo-700">Night Owl 🌙 +1</span>
          )}
        </div>
      </motion.div>

      <div className="flex gap-6">
        <button
          onClick={() => flyOut(-550, () => decide("challenge"))}
          disabled={busy}
          className="press flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-2xl text-white shadow disabled:opacity-40"
          aria-label="Challenge"
        >
          ✕
        </button>
        <button
          onClick={() => flyOut(550, () => decide("confirm"))}
          disabled={busy}
          className="press flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-2xl text-white shadow disabled:opacity-40"
          aria-label="Confirm legit"
        >
          ✓
        </button>
      </div>

      {preview && (
        <PhotoPreview url={preview.url} label={preview.label} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

function Photo({
  url,
  label,
  time,
  brand,
  onOpen,
}: {
  url: string | null;
  label: string;
  time: string;
  brand?: string | null;
  onOpen: () => void;
}) {
  // The card itself is draggable (left/right swipe), so distinguish a real tap
  // from a swipe by tracking how far the pointer moved before release.
  const down = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      className="relative mx-auto h-[23vh] w-[23vh] max-w-full overflow-hidden rounded-xl bg-surface-muted"
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const d = down.current;
        down.current = null;
        if (!url || !d) return;
        if (Math.abs(e.clientX - d.x) < 8 && Math.abs(e.clientY - d.y) < 8) onOpen();
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={label}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-line" />
      )}
      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-bold text-white">
        {label}
      </span>
      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
        {time}
      </span>
      {url && (
        <span className="pointer-events-none absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          🔍 tap
        </span>
      )}
      {url && brand && (
        <span className="pointer-events-none absolute bottom-1 left-1">
          <BrandBadge slug={brand} overlay size="xs" />
        </span>
      )}
    </div>
  );
}
