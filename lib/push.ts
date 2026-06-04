// Client-side Web Push helpers: subscribe/unsubscribe the current device and
// register the subscription with the server (save_push_subscription RPC). The
// VAPID public key is safe to embed here — it's public by design.
"use client";

import { savePushSubscription, deletePushSubscription } from "@/lib/api";

export const VAPID_PUBLIC_KEY =
  "BJ47wkJdkU-D6nEjkyL6sH7T8gC-IkRhXbcPSjd3vKgpHDvw7hNlPJjxjcR-L2iqV4gRTe63RTo5ihWZQ-ZtFqY";

// Browser supports the full push stack (SW + PushManager + Notification API).
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// True when launched as an installed PWA (Add to Home Screen) rather than a
// browser tab. iOS only delivers push to installed PWAs.
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari exposes this non-standard flag.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; detect via touch.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js");
}

// Current permission + whether this device already has a live subscription.
export async function pushStatus(): Promise<{
  permission: NotificationPermission;
  subscribed: boolean;
}> {
  const permission = Notification.permission;
  if (!pushSupported() || permission !== "granted") {
    return { permission, subscribed: false };
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { permission, subscribed: !!sub };
}

// Request permission, subscribe this device, and persist it server-side.
// Returns true on success. Throws on hard failures so callers can surface them.
export async function subscribeToPush(): Promise<boolean> {
  if (!pushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await getRegistration();
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const keys = json.keys ?? {};
  if (!json.endpoint || !keys.p256dh || !keys.auth) return false;

  await savePushSubscription(
    json.endpoint,
    keys.p256dh,
    keys.auth,
    typeof navigator !== "undefined" ? navigator.userAgent : null,
  );
  return true;
}

// Unsubscribe this device and forget it server-side.
export async function unsubscribeFromPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  try {
    await deletePushSubscription(endpoint);
  } catch {
    // best effort — the row is harmless if it lingers
  }
}
