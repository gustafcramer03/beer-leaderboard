"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate, type PanInfo } from "framer-motion";
import type { AuditItem } from "@/lib/types";
import { signedUrl, submitReview } from "@/lib/api";
import { PhotoPreview } from "./PhotoPreview";

function secondsBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000);
}

function fmtGap(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
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

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-15, 15]);
  const confirmOpacity = useTransform(x, [40, 130], [0, 1]); // swipe RIGHT = legit (Tinder yes)
  const challengeOpacity = useTransform(x, [-130, -40], [1, 0]); // swipe LEFT = challenge (Tinder nope)

  const current = items[index];

  useEffect(() => {
    let active = true;
    if (!current) return;
    setUrls({ full: null, empty: null });
    (async () => {
      const [full, empty] = await Promise.all([
        signedUrl(current.full_photo_path),
        signedUrl(current.empty_photo_path),
      ]);
      if (active) setUrls({ full, empty });
    })();
    return () => {
      active = false;
    };
  }, [current]);

  async function decide(verdict: "confirm" | "challenge") {
    if (!current || busy) return;
    setBusy(true);
    try {
      await submitReview(current.beer_id, verdict);
    } catch (e) {
      console.error(e);
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
    if (offset > 100 || velocity > 750) flyOut(550, () => decide("confirm"));
    else if (offset < -100 || velocity < -750) flyOut(-550, () => decide("challenge"));
    else animate(x, 0, { type: "spring", stiffness: 600, damping: 38 });
  }

  function flyOut(to: number, then: () => void) {
    animate(x, to, { duration: 0.18, ease: "easeOut", onComplete: then });
  }

  if (!current) return null;

  const gap = secondsBetween(current.full_taken_at, current.empty_taken_at);
  const looksChugged = gap <= 60;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-center">
        <p className="text-sm text-neutral-500">
          {items.length - index} beer{items.length - index === 1 ? "" : "s"} left to audit
        </p>
        <p className="text-xs text-neutral-400">
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
        className="relative w-full max-w-sm cursor-grab touch-none rounded-3xl bg-white p-3 shadow-xl active:cursor-grabbing dark:bg-neutral-800"
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
          <p className="mb-2 text-center text-sm italic text-neutral-600 dark:text-neutral-300">
            &ldquo;{current.caption}&rdquo;
          </p>
        )}
        <div className="grid grid-cols-1 gap-2">
          <Photo
            url={urls.full}
            label="FULL"
            time={stamp(current.full_taken_at)}
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
          <span className="rounded-full bg-neutral-100 px-2 py-1 dark:bg-neutral-700">
            ⏱ gap {fmtGap(gap)}
          </span>
          {(current.claimed_chug || looksChugged) && (
            <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">
              {current.claimed_chug ? "claims chug" : "looks chugged"} 🍺×2
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
          className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-2xl text-white shadow disabled:opacity-40"
          aria-label="Challenge"
        >
          ✕
        </button>
        <button
          onClick={() => flyOut(550, () => decide("confirm"))}
          disabled={busy}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-2xl text-white shadow disabled:opacity-40"
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
  onOpen,
}: {
  url: string | null;
  label: string;
  time: string;
  onOpen: () => void;
}) {
  // The card itself is draggable (left/right swipe), so distinguish a real tap
  // from a swipe by tracking how far the pointer moved before release.
  const down = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      className="relative mx-auto h-[23vh] w-[23vh] max-w-full overflow-hidden rounded-xl bg-neutral-200 dark:bg-neutral-700"
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
      {url && (
        <span className="pointer-events-none absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          🔍 tap
        </span>
      )}
    </div>
  );
}
