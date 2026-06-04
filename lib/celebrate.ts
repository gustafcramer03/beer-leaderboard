"use client";

import confetti from "canvas-confetti";

// Small celebration helpers — confetti bursts and haptic buzzes for key moments.
// Confetti draws on its own full-screen canvas (above modals); haptics use the
// Web Vibration API, which silently no-ops where unsupported (e.g. iOS Safari).

const GOLD = ["#f59e0b", "#fbbf24", "#fde68a", "#ffffff"];

// Best-effort vibration; never throws if the API is missing or blocked.
export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported — ignore */
  }
}

// A normal beer: one quick, modest pop from the lower-centre.
export function celebrateBeer() {
  confetti({
    particleCount: 70,
    spread: 70,
    startVelocity: 42,
    origin: { y: 0.7 },
    scalar: 0.9,
  });
}

// A chug: bigger and golden — a centre blast plus two side cannons.
export function celebrateChug() {
  confetti({
    particleCount: 160,
    spread: 100,
    startVelocity: 55,
    origin: { y: 0.65 },
    colors: GOLD,
    scalar: 1.15,
  });
  confetti({ particleCount: 80, angle: 60, spread: 80, origin: { x: 0, y: 0.7 }, colors: GOLD });
  confetti({ particleCount: 80, angle: 120, spread: 80, origin: { x: 1, y: 0.7 }, colors: GOLD });
}

// A big moment (grand reveal, Legend of the Day): a ~1s sustained shower from
// both edges. Paired with a celebratory haptic.
export function celebrateBig() {
  vibrate([60, 40, 120]);
  const end = Date.now() + 1000;
  (function frame() {
    confetti({ particleCount: 6, angle: 60, spread: 70, origin: { x: 0 }, colors: GOLD });
    confetti({ particleCount: 6, angle: 120, spread: 70, origin: { x: 1 }, colors: GOLD });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}
