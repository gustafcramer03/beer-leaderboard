"use client";

import { useEffect, useState, useCallback } from "react";
import type { AdminBeer } from "@/lib/types";
import { getAdminBeers, adminRuleBeer, adminSetBeerScore, adminRuleUnfinished, signedUrl } from "@/lib/api";
import { Loading } from "./Loading";
import { PhotoPreview } from "./PhotoPreview";
import { useToast } from "./Toast";

function fmtGap(s: number) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

function stamp(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// The active multipliers/bonuses on a beer, as labelled pills, so the admin can
// see at a glance why it's worth what it's worth before adjusting the score.
function beerFlags(b: AdminBeer): string[] {
  const flags: string[] = [];
  if (b.is_offline) flags.push("🛜 Offline");
  if (b.claimed_chug || b.is_chug) flags.push("🍺×2 Chug");
  if (b.is_morning) flags.push("🌅 Morning +1");
  if (b.is_happy_hour) flags.push("🍻 Happy hour +1");
  if (b.is_early_bird) flags.push("🐦 Early bird +1");
  if (b.is_night_owl) flags.push("🦉 Night owl +1");
  return flags;
}

export function AdminQueue({ holidayId }: { holidayId: string }) {
  const [beers, setBeers] = useState<AdminBeer[]>([]);
  const [unfinished, setUnfinished] = useState<AdminBeer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getAdminBeers(holidayId);
      setBeers(all.filter((b) => b.status === "challenged"));
      setUnfinished(all.filter((b) => b.status === "unfinished" && !b.admin_ruled_at));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [holidayId]);

  useEffect(() => {
    load();
  }, [load]);

  async function rule(beerId: string, decision: "confirm" | "reject", reason: string) {
    setBusyId(beerId);
    try {
      await adminRuleBeer(beerId, decision, reason);
      toast(decision === "confirm" ? "Beer upheld ✓" : "Beer rejected", "success");
      await load();
    } catch (e) {
      console.error(e);
      toast(e instanceof Error ? e.message : "Ruling failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function setScore(beerId: string, points: number, reason: string) {
    setBusyId(beerId);
    try {
      await adminSetBeerScore(beerId, points, reason);
      toast(`Score set to ${points} pt${points === 1 ? "" : "s"}`, "success");
      await load();
    } catch (e) {
      console.error(e);
      toast(e instanceof Error ? e.message : "Couldn't set the score", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function ruleUnfinished(beerId: string, uphold: boolean, reason: string) {
    setBusyId(beerId);
    try {
      await adminRuleUnfinished(beerId, uphold, reason);
      toast(uphold ? "Penalty upheld — −1 stands" : "Point reinstated — +1", "success");
      await load();
    } catch (e) {
      console.error(e);
      toast(e instanceof Error ? e.message : "Couldn't rule on it", "error");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Loading label="Reviewing the disputes…" />;

  if (beers.length === 0 && unfinished.length === 0) {
    return (
      <div className="p-8 text-center text-muted">
        <div className="mb-2 text-5xl">⚖️</div>
        <p className="font-medium">Nothing to rule on right now.</p>
        <p className="mt-1 text-sm">Order in the court. 🧑‍⚖️</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {unfinished.length > 0 && (
        <>
          <h2 className="font-display text-lg font-bold">Unfinished beer?</h2>
          {unfinished.map((b) => (
            <UnfinishedCard
              key={b.beer_id}
              beer={b}
              busy={busyId === b.beer_id}
              onRule={ruleUnfinished}
            />
          ))}
        </>
      )}
      {beers.length > 0 && (
        <>
          <h2 className="font-display text-lg font-bold">Challenged beers — your ruling</h2>
          {beers.map((b) => (
            <AdminCard
              key={b.beer_id}
              beer={b}
              busy={busyId === b.beer_id}
              onRule={rule}
              onSetScore={setScore}
            />
          ))}
        </>
      )}
    </div>
  );
}

// An unfinished beer awaiting the admin's verdict: uphold the −1, or reinstate
// the point (+1). Shows the owner's note and their full (start) photo.
function UnfinishedCard({
  beer,
  busy,
  onRule,
}: {
  beer: AdminBeer;
  busy: boolean;
  onRule: (id: string, uphold: boolean, reason: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (beer.full_photo_path) {
      signedUrl(beer.full_photo_path).then((u) => {
        if (active) setUrl(u);
      });
    }
    return () => {
      active = false;
    };
  }, [beer.full_photo_path]);

  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-col items-center gap-1 text-center">
        <p className="font-bold">{beer.owner_name}</p>
        <p className="text-xs text-muted">
          Started {beer.full_taken_at ? new Date(beer.full_taken_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "—"} · never finished
        </p>
      </div>

      <div className="mb-3 rounded-xl bg-bad/10 px-3 py-2 text-center">
        <div className="text-xs font-semibold uppercase tracking-wide text-bad">Currently worth</div>
        <div className="text-2xl font-bold text-bad">−1</div>
      </div>

      {beer.unfinished_note ? (
        <p className="mb-3 rounded-xl bg-surface-muted px-3 py-2 text-sm italic text-muted">
          &ldquo;{beer.unfinished_note}&rdquo;
        </p>
      ) : (
        <p className="mb-3 text-center text-xs text-faint">No explanation given.</p>
      )}

      {url && (
        <button
          onClick={() => setPreview(url)}
          className="mb-3 mx-auto block aspect-square w-32 overflow-hidden rounded-xl bg-surface-muted"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="start" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        </button>
      )}

      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 200))}
        placeholder="Reason (optional, shown to the player)"
        maxLength={200}
        disabled={busy}
        className="mb-3 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
      />

      <div className="flex gap-2">
        <button
          onClick={() => onRule(beer.beer_id, true, reason)}
          disabled={busy}
          className="press flex-1 rounded-full bg-bad py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Uphold −1
        </button>
        <button
          onClick={() => onRule(beer.beer_id, false, reason)}
          disabled={busy}
          className="press flex-1 rounded-full bg-good py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Reinstate +1
        </button>
      </div>

      {preview && <PhotoPreview url={preview} label="START" onClose={() => setPreview(null)} />}
    </div>
  );
}

function AdminCard({
  beer,
  busy,
  onRule,
  onSetScore,
}: {
  beer: AdminBeer;
  busy: boolean;
  onRule: (id: string, d: "confirm" | "reject", reason: string) => void;
  onSetScore: (id: string, points: number, reason: string) => void;
}) {
  const [urls, setUrls] = useState<{ full: string | null; empty: string | null }>({
    full: null,
    empty: null,
  });
  const [editing, setEditing] = useState(false);
  const [points, setPoints] = useState(beer.points);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [full, empty] = await Promise.all([
        beer.full_photo_path ? signedUrl(beer.full_photo_path) : Promise.resolve(null),
        beer.empty_photo_path ? signedUrl(beer.empty_photo_path) : Promise.resolve(null),
      ]);
      setUrls({ full, empty });
    })();
  }, [beer]);

  const gap =
    beer.full_taken_at && beer.empty_taken_at
      ? Math.round(
          (new Date(beer.empty_taken_at).getTime() - new Date(beer.full_taken_at).getTime()) / 1000,
        )
      : null;

  const flags = beerFlags(beer);

  return (
    <div className="card p-4">
      {/* Who & what */}
      <div className="mb-2 flex flex-col items-center gap-1 text-center">
        <p className="font-bold">{beer.owner_name}</p>
      </div>

      {/* Currently due — the computed score + the multipliers behind it */}
      <div className="mb-3 rounded-xl bg-accent-soft px-3 py-2 text-center">
        <div className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
          Currently worth
        </div>
        <div className="text-2xl font-black tabular-nums text-accent-strong">
          {beer.points} pts
        </div>
        {flags.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap justify-center gap-1.5 text-[11px]">
            {flags.map((f) => (
              <span
                key={f}
                className="rounded-full bg-surface px-2 py-0.5 font-medium text-accent-strong shadow-sm"
              >
                {f}
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-1 text-[11px] text-accent">
            Base beer · no bonuses
          </div>
        )}
      </div>

      {/* Timing — when each shot was taken + the gap */}
      {beer.full_taken_at && beer.empty_taken_at && gap !== null && (
        <div className="mb-2 flex items-center justify-center gap-2">
          <div className="flex flex-col items-center rounded-xl bg-surface-muted px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
              Full 🍺
            </span>
            <span className="text-base font-bold tabular-nums">{stamp(beer.full_taken_at)}</span>
          </div>
          <div className="flex flex-col items-center px-1 leading-tight text-muted">
            <span className="text-lg">→</span>
            <span className="text-xs font-bold">{fmtGap(gap)}</span>
          </div>
          <div className="flex flex-col items-center rounded-xl bg-surface-muted px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">
              Empty 🏁
            </span>
            <span className="text-base font-bold tabular-nums">{stamp(beer.empty_taken_at)}</span>
          </div>
        </div>
      )}

      {/* Photos */}
      <div className="grid grid-cols-2 gap-2">
        <CardPhoto
          url={urls.full}
          label="FULL"
          onOpen={() => urls.full && setPreview({ url: urls.full, label: "FULL" })}
        />
        <CardPhoto
          url={urls.empty}
          label="EMPTY"
          onOpen={() => urls.empty && setPreview({ url: urls.empty, label: "EMPTY" })}
        />
      </div>

      {/* Caption */}
      {beer.caption && (
        <p className="mt-2 text-center text-sm italic text-muted">
          &ldquo;{beer.caption}&rdquo;
        </p>
      )}

      {/* The ruling note — applies to whichever decision you make */}
      <div className="mt-3 flex flex-col gap-1">
        <label className="text-xs font-semibold text-muted">Your ruling (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 200))}
          placeholder="Why you're deciding this — shown to the player on their beer."
          maxLength={200}
          rows={2}
          className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
        {reason.length > 0 && (
          <span className="self-end text-[11px] text-faint">{reason.length}/200</span>
        )}
      </div>

      {/* Set-score stepper (only when adjusting points) */}
      {editing && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl bg-surface-muted p-3">
          <p className="text-center text-xs text-muted">
            Accept this beer but set its points by hand (computed: {beer.points}):
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setPoints((p) => Math.max(0, p - 1))}
              className="h-10 w-10 rounded-full bg-surface-muted text-xl font-bold"
              aria-label="Decrease points"
            >
              −
            </button>
            <input
              type="number"
              min={0}
              max={100}
              value={points}
              onChange={(e) =>
                setPoints(Math.max(0, Math.min(100, Math.floor(Number(e.target.value) || 0))))
              }
              className="w-20 rounded-lg border border-line bg-surface py-2 text-center text-lg font-bold"
            />
            <button
              type="button"
              onClick={() => setPoints((p) => Math.min(100, p + 1))}
              className="h-10 w-10 rounded-full bg-surface-muted text-xl font-bold"
              aria-label="Increase points"
            >
              +
            </button>
            <span className="text-sm text-faint">pts</span>
          </div>
          <div className="mt-1 flex gap-3">
            <button
              disabled={busy}
              onClick={() => setEditing(false)}
              className="flex-1 rounded-full bg-surface-muted py-2 font-semibold text-muted disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              disabled={busy}
              onClick={() => onSetScore(beer.beer_id, points, reason)}
              className="flex-1 rounded-full bg-green-500 py-2 font-semibold text-white disabled:opacity-40"
            >
              Save {points} pts
            </button>
          </div>
        </div>
      )}

      {/* Decision buttons */}
      {!editing && (
        <div className="mt-3 flex gap-2">
          <button
            disabled={busy}
            onClick={() => onRule(beer.beer_id, "confirm", reason)}
            className="flex-1 rounded-full bg-green-500 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Uphold ✓
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setPoints(beer.points);
              setEditing(true);
            }}
            className="flex-1 rounded-full bg-accent py-2 text-sm font-semibold text-accent-contrast disabled:opacity-40"
          >
            Set score ✎
          </button>
          <button
            disabled={busy}
            onClick={() => onRule(beer.beer_id, "reject", reason)}
            className="flex-1 rounded-full bg-red-500 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Reject ✕
          </button>
        </div>
      )}

      {preview && (
        <PhotoPreview url={preview.url} label={preview.label} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

function CardPhoto({
  url,
  label,
  onOpen,
}: {
  url: string | null;
  label: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!url}
      className="relative aspect-square overflow-hidden rounded-xl bg-surface-muted"
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center text-faint">…</div>
      )}
      <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-bold text-white">
        {label}
      </span>
      {url && (
        <span className="pointer-events-none absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          🔍 tap
        </span>
      )}
    </button>
  );
}
