"use client";

// Full-screen grand reveal: tap through the standings from last place up to the
// champion, one player at a time. Built for the moment the trip ends and the
// dark board is finally lifted.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Standing } from "@/lib/types";

const MEDALS = ["🥇", "🥈", "🥉"];

export function RevealShow({
  standings,
  onClose,
}: {
  standings: Standing[];
  onClose: () => void;
}) {
  // standings come in best-first; reveal counts up from the bottom.
  const order = [...standings].reverse();
  const [shown, setShown] = useState(0); // how many have been revealed so far
  const done = shown >= order.length;

  function next() {
    if (!done) setShown((n) => n + 1);
  }

  const current = shown > 0 ? order[shown - 1] : null;
  const place = current ? standings.findIndex((s) => s.user_id === current.user_id) : -1;
  const isChampion = place === 0;

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
        className="flex flex-1 flex-col items-center justify-center px-6 text-center"
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
            <motion.div
              key={current.user_id}
              initial={{ opacity: 0, scale: 0.7, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -20 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
              className="flex flex-col items-center gap-3"
            >
              <div className={isChampion ? "text-8xl" : "text-7xl"}>
                {MEDALS[place] ?? "🍺"}
              </div>
              <div className="text-sm font-medium uppercase tracking-widest text-amber-400">
                {isChampion ? "Champion" : `#${place + 1}`}
              </div>
              <div className={`font-black ${isChampion ? "text-5xl" : "text-4xl"}`}>
                {current.display_name}
              </div>
              <div className="text-xl text-neutral-300">
                {current.points} pts · {current.beer_count}🍺
              </div>
              {isChampion && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="mt-2 text-3xl"
                >
                  🎉👑🎉
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {done && (
          <p className="mt-10 text-sm text-neutral-500">Tap to close</p>
        )}
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
