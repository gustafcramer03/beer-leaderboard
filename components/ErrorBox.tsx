// Shared error callout. Token-styled so it reads correctly in light *and* dark
// (the old ad-hoc `bg-red-50`/`border-red-200` boxes were fixed light colours).
// Use for view/section-level errors; tiny inline form hints can stay inline.

import type { ReactNode } from "react";

export function ErrorBox({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={`rounded-card border border-bad/30 bg-bad/10 p-4 text-center text-sm text-bad ${className}`}
    >
      {children}
    </p>
  );
}
