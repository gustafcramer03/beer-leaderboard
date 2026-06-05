"use client";

import { useState } from "react";

// Shared loading + empty-state flourishes so every corner of the app feels warm
// rather than showing a bare "Loading…". A bouncing beer with a random pun, and
// pulse skeletons shaped like the content that's coming.

const LINES = [
  "Pouring the standings…",
  "Counting the empties…",
  "Tallying the tab…",
  "Chasing down the froth…",
  "Letting the head settle…",
  "Rounding up the regulars…",
  "Checking who's buying…",
  "Wiping down the bar…",
];

// A friendly full-block loader: a bouncing 🍺 over a random witty line. Pass a
// fixed `label` to override the random pun (e.g. a context-specific message).
export function Loading({ label, className = "" }: { label?: string; className?: string }) {
  // Pick once on mount so it doesn't flicker between re-renders.
  const [line] = useState(() => label ?? LINES[Math.floor(Math.random() * LINES.length)]);
  return (
    <div className={`flex flex-col items-center justify-center gap-3 p-8 text-center ${className}`}>
      <span className="animate-bounce text-4xl" role="img" aria-label="loading">
        🍺
      </span>
      <p className="text-sm text-muted">{line}</p>
    </div>
  );
}

// A pulsing placeholder row shaped like a leaderboard entry (rank · name · pts).
export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <ul className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="card flex items-center justify-between px-4 py-3"
        >
          <span className="flex items-center gap-3">
            <span className="h-5 w-5 animate-pulse rounded-full bg-surface-muted" />
            <span
              className="h-4 animate-pulse rounded bg-surface-muted"
              style={{ width: `${6 + ((i * 3) % 5)}rem` }}
            />
          </span>
          <span className="h-4 w-16 animate-pulse rounded bg-surface-muted" />
        </li>
      ))}
    </ul>
  );
}

// A pulsing placeholder for a list of stacked cards (feed rows, stat tiles).
export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="card flex items-center gap-3 p-3"
        >
          <span className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-surface-muted" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3.5 w-3/4 animate-pulse rounded bg-surface-muted" />
            <span className="h-3 w-1/3 animate-pulse rounded bg-surface-muted" />
          </span>
        </div>
      ))}
    </div>
  );
}
