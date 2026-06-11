"use client";

import { useEffect, useState } from "react";
import { CameraCapture } from "./CameraCapture";
import { OfflineLogBeer } from "./OfflineLogBeer";
import { BrandPicker } from "./BrandPicker";
import {
  startBeer,
  finishBeer,
  discardBeer,
  getOpenBeer,
  signedUrl,
  declareBeerUnfinished,
} from "@/lib/api";
import { celebrateBeer, celebrateChug } from "@/lib/celebrate";
import { useToast } from "./Toast";

type Step = "full" | "empty" | "done";

export function LogBeer({
  holidayId,
  onDone,
  onCancel,
  onUnfinished,
  resumeBeerId,
  resumeFullPath,
}: {
  holidayId: string;
  onDone: () => void;
  onCancel: () => void;
  // Called after the user declares this beer unfinished (−1). When omitted,
  // falls back to onDone. Lets the parent fire the optimistic penalty.
  onUnfinished?: () => void;
  // When set, resume this specific beer at the empty step (used by the overdue
  // resolution gate) instead of auto-detecting the latest open beer.
  resumeBeerId?: string;
  resumeFullPath?: string | null;
}) {
  const [offline, setOffline] = useState(false);
  const [step, setStep] = useState<Step>("full");
  const [fullFile, setFullFile] = useState<File | null>(null);
  const [emptyFile, setEmptyFile] = useState<File | null>(null);
  const [chug, setChug] = useState(false);
  const [caption, setCaption] = useState("");
  const [brand, setBrand] = useState<string | null>(null);
  const [beerId, setBeerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Resume an in-progress beer: if we logged a start earlier but never finished
  // (reload / app switch), the open row still lives server-side. Jump straight
  // to the empty step so the user can finish the same beer — keeping its
  // original start time, so the chug clock stays honest.
  const [resuming, setResuming] = useState(true);
  const [resumedFullUrl, setResumedFullUrl] = useState<string | null>(null);
  // "I didn't finish this beer" confirm flow.
  const [bailing, setBailing] = useState(false);
  const [bailNote, setBailNote] = useState("");

  useEffect(() => {
    let active = true;
    // Resolution-gate path: resume a specific beer at the empty step.
    if (resumeBeerId) {
      setBeerId(resumeBeerId);
      setStep("empty");
      setResuming(false);
      if (resumeFullPath) {
        signedUrl(resumeFullPath).then((url) => {
          if (active) setResumedFullUrl(url);
        });
      }
      return () => {
        active = false;
      };
    }
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
  }, [holidayId, resumeBeerId, resumeFullPath]);

  async function declareUnfinished() {
    if (!beerId) return;
    setBusy(true);
    setError(null);
    try {
      await declareBeerUnfinished(beerId, bailNote);
      toast("Marked unfinished — that's −1 🏳️", "info");
      (onUnfinished ?? onDone)();
    } catch (e) {
      setError(msg(e));
      toast(msg(e), "error");
      setBusy(false);
    }
  }

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
      toast(msg(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!emptyFile || !beerId) return;
    setBusy(true);
    setError(null);
    try {
      await finishBeer(holidayId, beerId, emptyFile, chug, caption, brand);
      if (chug) celebrateChug();
      else celebrateBeer();
      toast(chug ? "Chug logged 🍺×2" : "Beer logged 🍺", "success");
      setStep("done");
    } catch (e) {
      setError(msg(e));
      toast(msg(e), "error");
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
    return <p className="p-6 text-center text-muted">Checking for a beer in progress…</p>;
  }

  if (step === "done") {
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <div className="text-6xl">🍺</div>
        <h2 className="font-display text-xl font-bold">Beer logged!</h2>
        <p className="max-w-xs text-sm text-muted">
          Tap Done to head back to the board — your beer is in the audit queue for your mates to
          verify, and scores update hourly.
        </p>
        <button
          onClick={onDone}
          className="press rounded-full bg-accent px-6 py-3 font-semibold text-accent-contrast"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 p-6">
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className={`h-1.5 w-7 rounded-full ${step === "full" ? "bg-accent" : "bg-good"}`} />
          <span className={`h-1.5 w-7 rounded-full ${step === "empty" ? "bg-accent" : "bg-line"}`} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-wide text-faint">
          Step {step === "full" ? "1" : "2"} of 2
        </span>
      </div>
      <h2 className="font-display text-xl font-bold">
        {step === "full" ? "Your full beer" : "Your empty beer"}
      </h2>
      <p className="max-w-xs text-center text-sm text-muted">
        {step === "full"
          ? "Snap your full pint to start. The clock starts now (server time)."
          : "Drink up, then snap the empty glass to finish. Tick “I chugged it” below to claim a chug (🍺×2)."}
      </p>

      {step === "full" && (
        <>
          <CameraCapture label="full beer" onCapture={setFullFile} disabled={busy} />
          <button
            disabled={!fullFile || busy}
            onClick={continueToEmpty}
            className="press rounded-full bg-accent px-6 py-3 font-semibold text-accent-contrast disabled:opacity-40"
          >
            {busy ? "Saving…" : "Next: empty photo →"}
          </button>
          <button
            onClick={() => setOffline(true)}
            disabled={busy}
            className="rounded-full border border-line px-5 py-2 text-sm text-muted disabled:opacity-40"
          >
            🛜 Log offline beer
          </button>
          <p className="max-w-xs text-center text-[11px] text-faint">
            Drank one with no signal (plane, ferry)? Log it later from photos in your camera roll.
          </p>
        </>
      )}

      {step === "empty" && (
        <>
          {resumedFullUrl && (
            <div className="flex w-full max-w-xs items-center gap-3 rounded-2xl border border-accent/40 bg-accent-soft p-3 text-left">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resumedFullUrl}
                alt="your full beer"
                className="h-14 w-14 flex-none rounded-lg object-cover"
              />
              <div className="text-xs text-accent-strong">
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
            I chugged this one (claim 🍺×2)
          </label>
          <div className="flex w-full max-w-xs flex-col gap-1">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, 140))}
              placeholder="Add a caption… (optional)"
              maxLength={140}
              disabled={busy}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
            />
            {caption.length > 0 && (
              <span className="self-end text-[11px] text-faint">{caption.length}/140</span>
            )}
          </div>
          <BrandPicker value={brand} onChange={setBrand} disabled={busy} />
          <button
            disabled={!emptyFile || busy}
            onClick={finish}
            className="press rounded-full bg-accent px-6 py-3 font-semibold text-accent-contrast disabled:opacity-40"
          >
            {busy ? "Saving…" : "Finish 🍺"}
          </button>

          {/* Couldn't finish it? Own up — costs a point. */}
          {!bailing ? (
            <button
              onClick={() => setBailing(true)}
              disabled={busy}
              className="text-sm text-faint underline disabled:opacity-40"
            >
              🏳️ I didn&apos;t finish this beer
            </button>
          ) : (
            <div className="flex w-full max-w-xs flex-col gap-2 rounded-card border border-bad/30 bg-bad/10 p-3 text-center">
              <p className="font-display text-base font-bold">Bottling it? 🐱</p>
              <p className="text-xs text-muted">
                Leaving a soldier behind costs you a point. Don&apos;t pussy out unless you really
                have to.
              </p>
              <input
                type="text"
                value={bailNote}
                onChange={(e) => setBailNote(e.target.value.slice(0, 200))}
                placeholder="What happened? (optional)"
                maxLength={200}
                disabled={busy}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  onClick={declareUnfinished}
                  disabled={busy}
                  className="press flex-1 rounded-full bg-bad px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {busy ? "…" : "Yeah, I bottled it (−1)"}
                </button>
                <button
                  onClick={() => setBailing(false)}
                  disabled={busy}
                  className="press flex-1 rounded-full bg-surface-muted px-4 py-2 text-sm font-medium disabled:opacity-40"
                >
                  No — I&apos;ll finish it
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && <p className="text-sm text-bad">{error}</p>}
      <button onClick={cancel} className="text-sm text-faint underline">
        Cancel
      </button>
    </div>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}
