"use client";

import { useEffect, useState } from "react";
import { CameraCapture } from "./CameraCapture";
import { OfflineLogBeer } from "./OfflineLogBeer";
import { startBeer, finishBeer, discardBeer, getOpenBeer, signedUrl } from "@/lib/api";
import { celebrateBeer, celebrateChug } from "@/lib/celebrate";

type Step = "full" | "empty" | "done";

export function LogBeer({
  holidayId,
  onDone,
  onCancel,
}: {
  holidayId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [offline, setOffline] = useState(false);
  const [step, setStep] = useState<Step>("full");
  const [fullFile, setFullFile] = useState<File | null>(null);
  const [emptyFile, setEmptyFile] = useState<File | null>(null);
  const [chug, setChug] = useState(false);
  const [caption, setCaption] = useState("");
  const [beerId, setBeerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resume an in-progress beer: if we logged a start earlier but never finished
  // (reload / app switch), the open row still lives server-side. Jump straight
  // to the empty step so the user can finish the same beer — keeping its
  // original start time, so the chug clock stays honest.
  const [resuming, setResuming] = useState(true);
  const [resumedFullUrl, setResumedFullUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getOpenBeer(holidayId)
      .then(async (open) => {
        if (!active || !open) return;
        setBeerId(open.id);
        setStep("empty");
        if (open.full_photo_path) {
          const url = await signedUrl(open.full_photo_path);
          if (active) setResumedFullUrl(url);
        }
      })
      .catch(() => {
        /* best-effort; fall back to a fresh start */
      })
      .finally(() => {
        if (active) setResuming(false);
      });
    return () => {
      active = false;
    };
  }, [holidayId]);

  async function continueToEmpty() {
    if (!fullFile) return;
    setBusy(true);
    setError(null);
    try {
      const id = await startBeer(holidayId, fullFile);
      setBeerId(id);
      setStep("empty");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!emptyFile || !beerId) return;
    setBusy(true);
    setError(null);
    try {
      await finishBeer(holidayId, beerId, emptyFile, chug, caption);
      if (chug) celebrateChug();
      else celebrateBeer();
      setStep("done");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (beerId) {
      try {
        await discardBeer(beerId);
      } catch {
        /* ignore */
      }
    }
    onCancel();
  }

  if (offline) {
    return (
      <OfflineLogBeer
        holidayId={holidayId}
        onDone={onDone}
        onCancel={() => setOffline(false)}
      />
    );
  }

  if (resuming) {
    return <p className="p-6 text-center text-neutral-500">Checking for a beer in progress…</p>;
  }

  if (step === "done") {
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <div className="text-6xl">🍺</div>
        <h2 className="text-xl font-bold">Beer logged!</h2>
        <p className="text-sm text-neutral-500">
          It&apos;s now in the audit queue for your mates to verify. Scores update hourly.
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
      <h2 className="text-xl font-bold">
        {step === "full" ? "Step 1: your full beer" : "Step 2: your empty beer"}
      </h2>
      <p className="max-w-xs text-center text-sm text-neutral-500">
        {step === "full"
          ? "Snap your full pint to start. The clock starts now (server time)."
          : "Drink up, then snap the empty glass to finish. A gap under 60s counts as a chug (🍺×2)."}
      </p>

      {step === "full" && (
        <>
          <CameraCapture label="full beer" onCapture={setFullFile} disabled={busy} />
          <button
            disabled={!fullFile || busy}
            onClick={continueToEmpty}
            className="rounded-full bg-amber-600 px-6 py-3 font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Saving…" : "Continue →"}
          </button>
          <button
            onClick={() => setOffline(true)}
            disabled={busy}
            className="rounded-full border border-neutral-300 px-5 py-2 text-sm text-neutral-600 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300"
          >
            🛜 Log offline beer
          </button>
          <p className="max-w-xs text-center text-[11px] text-neutral-400">
            Drank one with no signal (plane, ferry)? Log it later from photos in your camera roll.
          </p>
        </>
      )}

      {step === "empty" && (
        <>
          {resumedFullUrl && (
            <div className="flex w-full max-w-xs items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-left dark:border-amber-700 dark:bg-amber-900/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resumedFullUrl}
                alt="your full beer"
                className="h-14 w-14 flex-none rounded-lg object-cover"
              />
              <div className="text-xs text-amber-700 dark:text-amber-300">
                <p className="font-semibold">Picked up where you left off ✓</p>
                <p>Your full beer is saved. Snap the empty to finish it.</p>
              </div>
            </div>
          )}
          <CameraCapture label="empty beer" onCapture={setEmptyFile} disabled={busy} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={chug}
              onChange={(e) => setChug(e.target.checked)}
              className="h-5 w-5 accent-amber-500"
            />
            I chugged this one (claim 🍺×2 — verified by timestamps)
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
            disabled={!emptyFile || busy}
            onClick={finish}
            className="rounded-full bg-amber-600 px-6 py-3 font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Saving…" : "Finish 🍺"}
          </button>
        </>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button onClick={cancel} className="text-sm text-neutral-400 underline">
        Cancel
      </button>
    </div>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}
