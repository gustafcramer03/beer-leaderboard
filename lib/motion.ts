import type { Transition, Variants } from "framer-motion";

// Shared motion vocabulary. SNAP matches the AuditDeck flyout tempo (0.18s);
// SPRING is the house spring for sheet-style entrances.
export const SNAP: Transition = { type: "tween", duration: 0.18, ease: [0.22, 1, 0.36, 1] };
export const SPRING: Transition = { type: "spring", stiffness: 520, damping: 40, mass: 0.9 };

export const tabVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  enter: { opacity: 1, y: 0, transition: SNAP },
  exit: { opacity: 0, y: -6, transition: { ...SNAP, duration: 0.12 } },
};

export const sheetVariants: Variants = {
  initial: { opacity: 0, y: 24 },
  enter: { opacity: 1, y: 0, transition: SPRING },
  exit: { opacity: 0, y: 24, transition: SNAP },
};
