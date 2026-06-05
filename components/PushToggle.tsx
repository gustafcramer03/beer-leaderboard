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
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <span className="text-2xl">🔔</span>
        <div className="min-w-0 flex-1">
          <div className="font-bold">Happy-hour alerts</div>
          <div className="text-xs text-muted">
            Get pinged when happy hour starts &amp; ends
          </div>
        </div>
        {standalone && !denied && (
          <button
            onClick={toggle}
            disabled={busy}
            aria-pressed={subscribed}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              subscribed ? "bg-accent" : "bg-surface-muted"
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
        <p className="mt-3 rounded-xl border border-accent/40 bg-accent-soft p-3 text-xs text-accent-strong">
          To get alerts on iPhone, add this app to your Home Screen first: tap the
          Share button, then <strong>Add to Home Screen</strong>, and open it from there.
        </p>
      )}

      {/* Non-iOS but somehow not standalone — gentle hint, still allow enabling. */}
      {!ios && !standalone && !denied && (
        <button
          onClick={toggle}
          disabled={busy}
          className="mt-3 w-full rounded-xl bg-accent py-2 text-sm font-semibold text-accent-contrast disabled:opacity-50"
        >
          {busy ? "…" : subscribed ? "Turn off alerts" : "Turn on alerts"}
        </button>
      )}

      {denied && (
        <p className="mt-3 rounded-xl bg-surface-muted p-3 text-xs text-muted">
          Notifications are blocked. Enable them for this app in your device or
          browser settings, then come back.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
