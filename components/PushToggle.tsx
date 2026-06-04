"use client";

import { useEffect, useState } from "react";
import {
  pushSupported,
  isStandalone,
  isIOS,
  pushStatus,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push";

// Menu card to enable/disable happy-hour push notifications on this device.
// On iOS, push only works from an installed (Add to Home Screen) PWA, so we
// nudge Safari-tab users to install first.
export function PushToggle() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ok = pushSupported();
    setSupported(ok);
    setStandalone(isStandalone());
    setIos(isIOS());
    if (!ok) return;
    pushStatus()
      .then((s) => {
        setSubscribed(s.subscribed);
        setDenied(s.permission === "denied");
      })
      .catch(() => {});
  }, []);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (subscribed) {
        await unsubscribeFromPush();
        setSubscribed(false);
      } else {
        const ok = await subscribeToPush();
        setSubscribed(ok);
        if (!ok) {
          setDenied(Notification.permission === "denied");
          if (Notification.permission !== "denied") {
            setError("Couldn't enable notifications. Try again.");
          }
        }
      }
    } catch (e) {
      console.error(e);
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // While detecting, render nothing to avoid a flash.
  if (supported === null) return null;

  // Unsupported browser — keep it out of the way entirely.
  if (!supported) return null;

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-800">
      <div className="flex items-center gap-3">
        <span className="text-2xl">🔔</span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">Happy-hour alerts</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            Get pinged when happy hour starts &amp; ends
          </div>
        </div>
        {standalone && !denied && (
          <button
            onClick={toggle}
            disabled={busy}
            aria-pressed={subscribed}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              subscribed ? "bg-amber-500" : "bg-neutral-300 dark:bg-neutral-600"
            }`}
            aria-label={subscribed ? "Disable notifications" : "Enable notifications"}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                subscribed ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        )}
      </div>

      {/* iOS, not installed: notifications can't work from a Safari tab. */}
      {ios && !standalone && (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          To get alerts on iPhone, add this app to your Home Screen first: tap the
          Share button, then <strong>Add to Home Screen</strong>, and open it from there.
        </p>
      )}

      {/* Non-iOS but somehow not standalone — gentle hint, still allow enabling. */}
      {!ios && !standalone && !denied && (
        <button
          onClick={toggle}
          disabled={busy}
          className="mt-3 w-full rounded-xl bg-amber-500 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "…" : subscribed ? "Turn off alerts" : "Turn on alerts"}
        </button>
      )}

      {denied && (
        <p className="mt-3 rounded-xl bg-neutral-100 p-3 text-xs text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
          Notifications are blocked. Enable them for this app in your device or
          browser settings, then come back.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
