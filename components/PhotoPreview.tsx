"use client";

// A near-full-screen photo inspector with pinch-to-zoom, double-tap zoom and
// drag-to-pan. Used to inspect beer photos in more detail (e.g. from the audit
// swipe deck). Self-contained pointer handling — no external zoom library.

import { useRef, useState } from "react";

type Pt = { x: number; y: number };

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

export function PhotoPreview({
  url,
  label,
  onClose,
}: {
  url: string;
  label?: string;
  onClose: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointers = useRef<Map<number, Pt>>(new Map());
  const pinch = useRef<{ dist: number; scale: number; tx: number; ty: number; focal: Pt } | null>(
    null,
  );
  const lastTap = useRef(0);
  const moved = useRef(false);

  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  // Mirror current transform into a ref so pointer handlers avoid stale state.
  const t = useRef({ scale: 1, tx: 0, ty: 0 });
  t.current = { scale, tx, ty };

  function center(): Pt {
    const el = viewportRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  // Keep the (scaled) image from drifting too far past the viewport edges.
  function clamp(nx: number, ny: number, s: number): Pt {
    const el = viewportRef.current;
    if (!el) return { x: nx, y: ny };
    const r = el.getBoundingClientRect();
    const maxX = ((s - 1) * r.width) / 2;
    const maxY = ((s - 1) * r.height) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, nx)),
      y: Math.max(-maxY, Math.min(maxY, ny)),
    };
  }

  function apply(s: number, nx: number, ny: number) {
    const c = clamp(nx, ny, s);
    setScale(s);
    setTx(c.x);
    setTy(c.y);
  }

  function zoomToPoint(clientX: number, clientY: number) {
    const c = center();
    const F = { x: clientX - c.x, y: clientY - c.y };
    if (t.current.scale > 1.01) {
      apply(1, 0, 0); // reset
    } else {
      // From s0=1, t0=0: t1 = F - F*ns = F*(1-ns) keeps the tapped point fixed.
      apply(DOUBLE_TAP_SCALE, F.x * (1 - DOUBLE_TAP_SCALE), F.y * (1 - DOUBLE_TAP_SCALE));
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const c = center();
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: t.current.scale,
        tx: t.current.tx,
        ty: t.current.ty,
        focal: { x: (a.x + b.x) / 2 - c.x, y: (a.y + b.y) / 2 - c.y },
      };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2 && pinch.current) {
      moved.current = true;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const s0 = pinch.current.scale;
      const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (dist / pinch.current.dist) * s0));
      const F = pinch.current.focal;
      const ntx = F.x - (F.x - pinch.current.tx) * (ns / s0);
      const nty = F.y - (F.y - pinch.current.ty) * (ns / s0);
      apply(ns, ntx, nty);
    } else if (pointers.current.size === 1 && t.current.scale > 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved.current = true;
      apply(t.current.scale, t.current.tx + dx, t.current.ty + dy);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;

    if (pointers.current.size === 0) {
      // Tap (no drag/pinch): double-tap zooms, single tap on backdrop closes.
      if (!moved.current) {
        const now = Date.now();
        if (now - lastTap.current < 280) {
          zoomToPoint(e.clientX, e.clientY);
          lastTap.current = 0;
        } else {
          lastTap.current = now;
        }
      }
      if (t.current.scale <= 1.01 && (t.current.tx !== 0 || t.current.ty !== 0)) {
        setTx(0);
        setTy(0);
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        // Tapping the dim backdrop (outside the image) closes the preview.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close preview"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-2xl text-white"
      >
        ✕
      </button>

      <div
        ref={viewportRef}
        className="relative h-[80vh] w-[92vw] max-w-2xl touch-none select-none overflow-hidden rounded-2xl bg-neutral-900"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => zoomToPoint(e.clientX, e.clientY)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={label ?? "photo"}
          draggable={false}
          decoding="async"
          className="h-full w-full object-contain"
          style={{
            transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
            transition: pointers.current.size === 0 ? "transform 0.15s ease-out" : "none",
          }}
        />
        {label && (
          <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs font-bold text-white">
            {label}
          </span>
        )}
      </div>

      <p className="mt-3 text-center text-xs text-white/70">
        Pinch or double-tap to zoom · drag to pan · tap outside to close
      </p>
    </div>
  );
}
