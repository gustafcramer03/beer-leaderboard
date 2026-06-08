"use client";

import { useEffect, useState } from "react";
import { avatarUrl } from "@/lib/api";

// Round profile photo. Signs the private storage path on mount; while it has no
// path (or the sign fails) it shows the bundled Lorax default, which costs no
// storage. Reused anywhere a player's face should appear (menu, rivalry cards…).
export function Avatar({
  path,
  size = 48,
  className = "",
}: {
  path: string | null;
  size?: number;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let active = true;
    setBroken(false);
    if (!path) {
      setUrl(null);
      return;
    }
    avatarUrl(path).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [path]);

  // If neither a real avatar nor the bundled default image loads, fall back to
  // a plain orange circle so we never show a broken-image icon.
  if (broken) {
    return (
      <span
        style={{ width: size, height: size, fontSize: size * 0.5 }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-amber-300 dark:bg-amber-700 ${className}`}
        aria-hidden
      >
        🟠
      </span>
    );
  }

  const src = url ?? "/default-avatar.jpg";

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      style={{ width: size, height: size }}
      onError={() => setBroken(true)}
      className={`shrink-0 rounded-full bg-accent-soft ${
        url ? "object-cover" : "object-contain"
      } ${className}`}
    />
  );
}
