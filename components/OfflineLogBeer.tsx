"use client";

import { useState } from "react";
import { CameraCapture } from "./CameraCapture";
import { logOfflineBeer } from "@/lib/api";
import { readPhotoTime } from "@/lib/exif";
import { celebrateBeer, celebrateChug } from "@/lib/celebrate";

// Logging a beer that was drunk with no signal (plane, ferry). You pick the two
// shots you already took from your camera roll; we read each photo's capture time
// from its metadata for scoring (chug / chain / morning), and let you tweak it if
// the metadata is missing.
type PhotoState = {
  file: File | null;
  time: string; // datetime-local value (local time)
  source: "exif" | "file" | null;
};

const blank: PhotoState = { file: null, time: "", source: null };

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function OfflineLogBeer({
  holidayId,
  onDone,
  onCancel,
}: {
  holidayId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [full, setFull] = useState<PhotoState>(blank);
  const [empty, setEmpty] = useState<PhotoState>(blank);
  const [chug, setChug] = useState(false);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(which: "full" | "empty", file: File) {
    const t = await readPhotoTime(file);
    const next: PhotoState = { file, time: toLocalInput(t.date), source: t.source };
    if (which === "full") setFull(next);
    else setEmpty(next);
  }

  const canSubmit =
    full.file && empty.file && full.time && empty.time && !busy;

  async function submit() {
    if (!full.file || !empty.file || !full.time || !empty.time) return;
    const fullISO = new Date(full.time).toISOString();
    const emptyISO = new Date(empty.time).toISOString();
    if (new Date(emptyISO) < new Date(fullISO)) {
      setError("The empty photo's time is before the full one. Check the times.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await logOfflineBeer(holidayId, full.file, empty.file, fullISO, emptyISO, chug, caption);
      if (chug) celebrateChug();
      else celebrateBeer();
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <div className="text-6xl">🛜🍺</div>
        <h2 className="text-xl font-bold">Offline beer logged!</h2>
        <p className="text-sm text-neutral-500">
          It&apos;s in the audit queue, tagged as logged offline. Scores update hourly.
        </p>
        <button
          onClick={onDone}
          className="rounded-full bg-amber-500 px-6 py-3 font-semibold text-white"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 p-6">
      <h2 className="text-xl font-bold">Log an offline beer</h2>
      <p className="max-w-xs text-center text-sm text-neutral-500">
        No signal at the time? Pick the full and empty shots from your camera roll. We read the
        time each photo was taken for scoring.
      </p>

      <Slot label="full beer" state={full} onPick={(f) => pick("full", f)} onTime={(t) => setFull((s) => ({ ...s, time: t }))} disabled={busy} />
      <Slot label="empty beer" state={empty} onPick={(f) => pick("empty", f)} onTime={(t) => setEmpty((s) => ({ ...s, time: t }))} disabled={busy} />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={chug}
          onChange={(e) => setChug(e.target.checked)}
          className="h-5 w-5 accent-amber-500"
        />
        I chugged this one (claim 🍺×2 — also judged by the time gap)
      </label>

      <div className="flex w-full max-w-xs flex-col gap-1">
        <input
          type="text"
          value={caption}
          onChange={(e) => setCaption(e.target.value.slice(0, 140))}
          placeholder="Add a caption… (optional)"
          maxLength={140}
          disabled={busy}
          className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800"
        />
        {caption.length > 0 && (
          <span className="self-end text-[11px] text-neutral-400">{caption.length}/140</span>
        )}
      </div>

      <button
        disabled={!canSubmit}
        onClick={submit}
        className="rounded-full bg-amber-600 px-6 py-3 font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Uploading…" : "Log offline beer 🍺"}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={onCancel} className="text-sm text-neutral-400 underline">
        Cancel
      </button>
    </div>
  );
}

function Slot({
  label,
  state,
  onPick,
  onTime,
  disabled,
}: {
  label: string;
  state: PhotoState;
  onPick: (f: File) => void;
  onTime: (t: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-2 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-700">
      <CameraCapture label={label} onCapture={onPick} disabled={disabled} fromGallery />
      {state.file && (
        <div className="flex w-full flex-col gap-1">
          <label className="text-xs text-neutral-500">Time taken</label>
          <input
            type="datetime-local"
            value={state.time}
            onChange={(e) => onTime(e.target.value)}
            className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
          />
          <span className="text-[11px] text-neutral-400">
            {state.source === "exif"
              ? "✓ read from the photo's metadata"
              : "⚠ no time in this photo — using file date, please check"}
          </span>
        </div>
      )}
    </div>
  );
}
