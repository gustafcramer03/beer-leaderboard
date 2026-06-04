// Web Push sender — called by the Postgres cron (dispatch_happy_hour_push) via
// pg_net. Receives the happy-hour start/end events plus every target device's
// push subscription, and fans out the notifications using the Web Push protocol
// (VAPID). Authenticated by a shared secret header so only our DB can call it.
//
// Secrets live in Vercel env (never committed):
//   PUSH_SECRET        — must match private.push_config.push_secret
//   VAPID_PUBLIC_KEY   — also embedded client-side (public)
//   VAPID_PRIVATE_KEY  — private signing key
//   VAPID_SUBJECT      — mailto: contact (defaults to a placeholder)

import webpush from "web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sub = { endpoint: string; p256dh: string; auth: string };
type Event = { title: string; body: string; subscriptions: Sub[] };

let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:push@beer-leaderboard.app";
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  vapidReady = true;
  return true;
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.PUSH_SECRET;
  if (!secret || req.headers.get("x-push-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  if (!ensureVapid()) {
    return new Response("push not configured", { status: 503 });
  }

  let payload: { events?: Event[] };
  try {
    payload = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const events = Array.isArray(payload.events) ? payload.events : [];

  let sent = 0;
  let failed = 0;
  let gone = 0;

  for (const ev of events) {
    const notif = JSON.stringify({
      title: ev.title,
      body: ev.body,
      url: "/",
    });
    const subs = Array.isArray(ev.subscriptions) ? ev.subscriptions : [];
    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          notif,
          { TTL: 3600 },
        ),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        sent++;
      } else {
        // 404/410 = subscription expired/unsubscribed; not a real error.
        const code = (r.reason as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) gone++;
        else failed++;
      }
    }
  }

  return Response.json({ ok: true, events: events.length, sent, failed, gone });
}
