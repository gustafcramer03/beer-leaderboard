"use client";

// Full-screen grand reveal: tap through the standings from last place up to the
// champion, one player at a time. Each player gets their profile photo centre
// stage with a scattered handful of their own beer photos around it. Built for
// the moment the trip ends and the dark board is finally lifted.

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Standing, RevealMedia } from "@/lib/types";
import { getRevealMedia, signedUrl, avatarUrl } from "@/lib/api";
import { celebrateBig } from "@/lib/celebrate";

const MEDALS = ["🥇", "🥈", "🥉"];

// Fixed scatter slots around the centred avatar. Each beer photo drops into one
// of these (with a little rotation) so the layout feels lively but never covers
// the name/points in the middle.
const SCATTER: { style: React.CSSProperties; rot: number }[] = [
  { style: { top: "6%", left: "8%" }, rot: -9 },
  { style: { top: "9%", right: "7%" }, rot: 8 },
  { style: { top: "34%", left: "2%" }, rot: -6 },
  { style: { top: "38%", right: "3%" }, rot: 7 },
  { style: { bottom: "10%", left: "10%" }, rot: 10 },
  { style: { bottom: "8%", right: "12%" }, rot: -8 },
];

function sample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export function RevealShow({
  standings,
  holidayId,
  onClose,
}: {
  standings: Standing[];
  holidayId: string;
  onClose: () => void;
}) {
  // standings come in best-first; reveal counts up from the bottom.
  const order = useMemo(() => [...standings].reverse(), [standings]);
  const [shown, setShown] = useState(0); // how many have been revealed so far
  const done = shown >= order.length;

  const [media, setMedia] = useState<RevealMedia>({});

  // Pull the avatar + beer-photo pool once when the show opens.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const m = await getRevealMedia(holidayId);
        if (active) setMedia(m);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      active = false;
    };
  }, [holidayId]);

  function next() {
    if (!done) setShown((n) => n + 1);
  }

  const current = shown > 0 ? order[shown - 1] : null;
  const place = current ? standings.findIndex((s) => s.user_id === current.user_id) : -1;
  const isChampion = place === 0;

  // Big confetti + haptic the moment the champion is unveiled.
  useEffect(() => {
    if (isChampion) celebrateBig();
  }, [isChampion]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950 text-white">
      <div className="flex items-center justify-between p-4">
        <span className="text-sm text-neutral-500">
          {done ? "That's everyone 🍻" : shown === 0 ? "Tap to begin" : `${order.length - shown} to go`}
        </span>
        <button onClick={onClose} aria-label="Close reveal" className="text-2xl text-neutral-400">
          ✕
        </button>
      </div>

      <button
        onClick={done ? onClose : next}
        className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 text-center"
      >
        {shown === 0 && (
          <div className="flex flex-col items-center gap-4">
            <div className="text-7xl">🥁</div>
            <h1 className="text-3xl font-black">The Grand Reveal</h1>
            <p className="max-w-xs text-sm text-neutral-400">
              Counting up from last place. Tap anywhere to reveal the next drinker.
            </p>
          </div>
        )}

        <AnimatePresence mode="wait">
          {current && (
            <RevealCard
              key={current.user_id}
              standing={current}
              place={place}
              isChampion={isChampion}
              media={media[current.user_id]}
            />
          )}
        </AnimatePresence>

        {done && <p className="mt-10 text-sm text-neutral-500">Tap to close</p>}
      </button>

      {order.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <div className="text-6xl">🤷</div>
          <p className="text-neutral-400">No beers were logged — nothing to reveal.</p>
        </div>
      )}
    </div>
  );
}

function RevealCard({
  standing,
  place,
  isChampion,
  media,
}: {
  standing: Standing;
  place: number;
  isChampion: boolean;
  media?: { avatar_path: string | null; photos: string[] };
}) {
  const [avatar, setAvatar] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);

  // Sign the avatar + a random handful of beer photos for this player.
  useEffect(() => {
    let active = true;
    setAvatar(null);
    setPhotos([]);
    (async () => {
      const picks = sample(media?.photos ?? [], SCATTER.length);
      const [av, signed] = await Promise.all([
        media?.avatar_path ? avatarUrl(media.avatar_path) : Promise.resolve(null),
        Promise.all(picks.map((p) => signedUrl(p))),
      ]);
      if (!active) return;
      setAvatar(av);
      setPhotos(signed.filter((u): u is string => !!u));
    })();
    return () => {
      active = false;
    };
  }, [media]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: -20 }}
      transition={{ type: "spring", stiffness: 260, damping: 20 }}
      className="flex flex-col items-center gap-3"
    >
      {/* Scattered beer photos (behind the central content; don't catch taps) */}
      {photos.map((url, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0.5, rotate: 0 }}
          animate={{ opacity: 1, scale: 1, rotate: SCATTER[i].rot }}
          transition={{ delay: 0.15 + i * 0.08, type: "spring", stiffness: 200, damping: 18 }}
          style={SCATTER[i].style}
          className="pointer-events-none absolute h-24 w-24 overflow-hidden rounded-2xl border-2 border-white/20 shadow-xl"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="h-full w-full object-cover" />
        </motion.div>
      ))}

      {/* Central profile photo (or medal fallback) */}
      <div
        className={`relative z-10 flex items-center justify-center overflow-hidden rounded-full border-4 ${
          isChampion ? "h-36 w-36 border-amber-400" : "h-28 w-28 border-white/30"
        } bg-neutral-800 shadow-2xl`}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt={standing.display_name} className="h-full w-full object-cover" />
        ) : (
          <span className={isChampion ? "text-6xl" : "text-5xl"}>{MEDALS[place] ?? "🍺"}</span>
        )}
        {avatar && (
          <span className="absolute -bottom-1 right-1 text-3xl drop-shadow">
            {MEDALS[place] ?? ""}
          </span>
        )}
      </div>

      <div className="z-10 text-sm font-medium uppercase tracking-widest text-amber-400">
        {isChampion ? "Champion" : `#${place + 1}`}
      </div>
      <div className={`z-10 font-black ${isChampion ? "text-5xl" : "text-4xl"}`}>
        {standing.display_name}
      </div>
      <div className="z-10 text-xl text-neutral-300">
        {standing.points} pts · {standing.beer_count}🍺
      </div>
      {isChampion && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="z-10 mt-2 text-3xl"
        >
          🎉👑🎉
        </motion.div>
      )}
    </motion.div>
  );
}
