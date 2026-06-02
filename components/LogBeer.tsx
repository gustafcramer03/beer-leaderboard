"use client";

import { useState } from "react";
import { CameraCapture } from "./CameraCapture";
import { OfflineLogBeer } from "./OfflineLogBeer";
import { startBeer, finishBeer, discardBeer } from "@/lib/api";

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
  const [beerId, setBeerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await finishBeer(holidayId, beerId, emptyFile, chug);
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
