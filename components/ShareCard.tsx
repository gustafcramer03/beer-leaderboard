"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getShareCard, avatarUrl } from "@/lib/api";
import type { ShareCard as ShareCardData } from "@/lib/types";
import { Loading } from "./Loading";
import { celebrateBig } from "@/lib/celebrate";

type Card = NonNullable<ShareCardData["card"]>;

const W = 1080;
const H = 1920; // Instagram story 9:16

// "Share card" — renders the caller's headline stats to a 1080x1920 canvas
// (Instagram-story sized) and offers it to the native share sheet as a PNG
// file, so it can be posted straight to a story. Falls back to a download on
// platforms without the Web Share files API (most desktops). Withheld while the
// board is dark, since the rank would leak who's ahead before the reveal.
export function ShareCardView({
  holidayId,
  onClose,
}: {
  holidayId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ShareCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let active = true;
    getShareCard(holidayId)
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e instanceof Error ? e.message : "Couldn't build your card"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [holidayId]);

  // Draw the card once we have data. Load the avatar CORS-clean so the canvas
  // stays exportable; if it can't load (cross-origin block, no photo) we draw
  // initials instead and the canvas remains untainted.
  useEffect(() => {
    const card = data?.card;
    const canvas = canvasRef.current;
    if (!card || !canvas) return;
    let cancelled = false;

    async function run(card: Card) {
      let avatar: HTMLImageElement | null = null;
      const url = card.avatar_path ? await avatarUrl(card.avatar_path) : null;
      if (url) {
        avatar = await loadImage(url).catch(() => null);
      }
      if (cancelled || !canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawCard(ctx, card, avatar);
      setDrawn(true);
      celebrateBig();
    }

    setDrawn(false);
    run(card);
    return () => {
      cancelled = true;
    };
  }, [data]);

  const exportBlob = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        const canvas = canvasRef.current;
        if (!canvas) return resolve(null);
        canvas.toBlob((b) => resolve(b), "image/png");
      }),
    [],
  );

  const card = data?.card;

  async function share() {
    if (!card) return;
    setSharing(true);
    try {
      const blob = await exportBlob();
      if (!blob) throw new Error("Couldn't render the image");
      const file = new File([blob], "beer-stats.png", { type: "image/png" });
      const text = `${card.display_name} — #${card.rank} of ${card.players} on ${card.holiday_name}! 🍺`;
      const nav = navigator as Navigator & {
        canShare?: (d: ShareData) => boolean;
      };
      try {
        if (nav.canShare && nav.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "My beer stats", text });
          return;
        }
      } catch (e) {
        // User dismissed the sheet — don't then force a download on them.
        if (e instanceof Error && e.name === "AbortError") return;
      }
      download(blob);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Share failed");
    } finally {
      setSharing(false);
    }
  }

  async function save() {
    const blob = await exportBlob();
    if (blob) download(blob);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-sunken">
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <h2 className="font-display text-lg font-bold">📲 Share card</h2>
        <button
          onClick={onClose}
          className="press rounded-full bg-surface-muted px-4 py-2 text-sm font-medium"
        >
          Done
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-4">
          {loading && <Loading label="Designing your flex…" />}

          {error && <p className="p-6 text-center text-sm text-bad">{error}</p>}

          {!loading && !error && data && data.card === null && (
            <p className="p-8 text-center text-sm text-muted">
              🌑 The board&apos;s dark — your share card unlocks at the grand reveal.
            </p>
          )}

          {card && (
            <>
              {/* The canvas is full-res (1080x1920); CSS scales it to a phone-
                  friendly preview. The exported file is always full quality. */}
              <div className="w-full max-w-[280px] overflow-hidden rounded-3xl shadow-lg">
                <canvas
                  ref={canvasRef}
                  width={W}
                  height={H}
                  className="block h-auto w-full"
                />
              </div>

              <p className="text-center text-xs text-faint">
                Tap Share, then pick Instagram → Story. Or save the image and post it yourself.
              </p>

              <div className="flex w-full max-w-[280px] flex-col gap-2">
                <button
                  onClick={share}
                  disabled={!drawn || sharing}
                  className="press w-full rounded-full bg-accent py-3 font-semibold text-accent-contrast disabled:opacity-40"
                >
                  {sharing ? "Opening…" : "📲 Share to story"}
                </button>
                <button
                  onClick={save}
                  disabled={!drawn}
                  className="w-full rounded-full border border-accent/40 py-3 font-semibold text-accent-strong disabled:opacity-40"
                >
                  Save image
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- drawing --------------------------------------------------------------

function drawCard(ctx: CanvasRenderingContext2D, c: Card, avatar: HTMLImageElement | null) {
  // Background: warm amber → deep stout gradient.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#f59e0b");
  bg.addColorStop(0.55, "#b45309");
  bg.addColorStop(1, "#3b1d06");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle foam-bubble flecks for texture.
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < 40; i++) {
    const x = (i * 137.5) % W;
    const y = (i * 241.3) % H;
    const r = ((i * 53) % 40) + 8;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Wordmark + trip name.
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `800 44px ${FONT}`;
  ctx.fillText("🍺 BEER LEADERBOARD", W / 2, 150);
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 60px ${FONT}`;
  fitText(ctx, c.holiday_name.toUpperCase(), W / 2, 230, W - 140, 60);

  // Avatar in a ringed circle.
  const cx = W / 2;
  const cy = 470;
  const r = 150;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.lineWidth = 14;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 7, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) {
    drawImageCover(ctx, avatar, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = "#fcd34d";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = "#7c2d12";
    ctx.font = `900 150px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.fillText(initials(c.display_name), cx, cy + 6);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  // Name.
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 78px ${FONT}`;
  fitText(ctx, c.display_name, W / 2, 730, W - 120, 78);

  // Rank hero.
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 300px ${FONT}`;
  ctx.fillText(`#${c.rank}`, W / 2, 1080);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `700 50px ${FONT}`;
  ctx.fillText(`of ${c.players} player${c.players === 1 ? "" : "s"}`, W / 2, 1150);

  // Two hero numbers: beers + points.
  bigStat(ctx, W * 0.3, 1330, `${c.beers}`, "🍺 BEERS");
  bigStat(ctx, W * 0.7, 1330, `${c.points}`, "🎯 POINTS");

  // Secondary stat chips.
  const chips: [string, string][] = [
    ["⚡", c.fastest_chug != null ? `${c.fastest_chug}s chug` : "no chug yet"],
    ["🔥", `${c.longest_chain} chain`],
    ["🌅", `${c.active_days} day${c.active_days === 1 ? "" : "s"}`],
  ];
  drawChips(ctx, chips, 1560);

  // Footer watermark.
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText("beer-leaderboard.vercel.app", W / 2, 1850);
}

const FONT = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

function bigStat(ctx: CanvasRenderingContext2D, x: number, y: number, value: string, label: string) {
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 130px ${FONT}`;
  ctx.fillText(value, x, y);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `800 40px ${FONT}`;
  ctx.fillText(label, x, y + 64);
}

function drawChips(ctx: CanvasRenderingContext2D, chips: [string, string][], y: number) {
  const n = chips.length;
  const gap = 28;
  const totalGap = gap * (n - 1);
  const chipW = Math.min(300, (W - 120 - totalGap) / n);
  const chipH = 150;
  const totalW = chipW * n + totalGap;
  let x = (W - totalW) / 2;
  ctx.textAlign = "center";
  for (const [emoji, label] of chips) {
    roundRect(ctx, x, y, chipW, chipH, 36);
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fill();
    const midX = x + chipW / 2;
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 64px ${FONT}`;
    ctx.fillText(emoji, midX, y + 78);
    ctx.font = `800 34px ${FONT}`;
    fitText(ctx, label, midX, y + 122, chipW - 24, 34);
    x += chipW + gap;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Shrink the font until the text fits within maxWidth, then draw it.
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  startPx: number,
) {
  let px = startPx;
  // FONT weight is whatever the caller set; re-set size each step.
  const weight = ctx.font.split(" ")[0];
  while (px > 16 && measure(ctx, text, weight, px) > maxWidth) px -= 2;
  ctx.font = `${weight} ${px}px ${FONT}`;
  ctx.fillText(text, x, y);
}

function measure(ctx: CanvasRenderingContext2D, text: string, weight: string, px: number): number {
  ctx.font = `${weight} ${px}px ${FONT}`;
  return ctx.measureText(text).width;
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const ir = img.width / img.height;
  const dr = dw / dh;
  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;
  if (ir > dr) {
    sw = img.height * dr;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / dr;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "🍺";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function download(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "beer-stats.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
