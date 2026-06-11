"use client";

import { supabase, PHOTO_BUCKET, AVATAR_BUCKET } from "@/lib/supabase";
import { compressImage, compressAvatar } from "@/lib/image";
import type {
  Holiday,
  UploadWindow,
  AuditItem,
  StandingsResult,
  Beer,
  OverdueBeer,
  LedgerEntry,
  TripStats,
  AdminTrip,
  AdminMember,
  AdminMemberBeer,
  AdminStorageSummary,
  HappyHourStatus,
  Achievements,
  PaceSeries,
  DailyRecap,
  ShareCard,
  HolidayMember,
  HeadToHead,
  ActivityFeed,
  ChallengedBeer,
  AdminBeer,
  RevealMedia,
  Heatmap,
  DailyBars,
  BeerInsights,
} from "@/lib/types";

export async function myHolidays(): Promise<Holiday[]> {
  // RLS limits holidays to ones the user is a member of.
  const { data, error } = await supabase
    .from("holidays")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createHoliday(
  name: string,
  start: string,
  end: string,
  darkDays: number,
  timezone: string,
  startTime: string, // HH:MM
  endTime: string, // HH:MM
): Promise<Holiday> {
  const { data, error } = await supabase.rpc("create_holiday", {
    p_name: name,
    p_start: start,
    p_end: end,
    p_dark_days: darkDays,
    p_timezone: timezone,
    p_start_time: startTime,
    p_end_time: endTime,
  });
  if (error) throw error;
  return data as Holiday;
}

export async function joinHoliday(code: string): Promise<Holiday> {
  const { data, error } = await supabase.rpc("join_holiday", {
    p_code: code.toUpperCase().trim(),
  });
  if (error) throw error;
  return data as Holiday;
}

export async function getStandings(
  holidayId: string,
  adminPeek = false,
): Promise<StandingsResult> {
  const { data, error } = await supabase.rpc("get_latest_standings", {
    p_holiday: holidayId,
    p_admin_peek: adminPeek,
  });
  if (error) throw error;
  return data as StandingsResult;
}

export async function getUserLedger(
  holidayId: string,
  userId: string,
): Promise<LedgerEntry[]> {
  const { data, error } = await supabase.rpc("user_ledger", {
    p_holiday: holidayId,
    p_user: userId,
  });
  if (error) throw error;
  return (data as LedgerEntry[]) ?? [];
}

export async function tripStats(holidayId: string): Promise<TripStats> {
  const { data, error } = await supabase.rpc("trip_stats", { p_holiday: holidayId });
  if (error) throw error;
  return data as TripStats;
}

// A player's trophy cabinet — counts of each achievement won. Your own is
// always visible; others' are hidden while the board is dark.
export async function getAchievements(
  holidayId: string,
  userId: string,
): Promise<Achievements> {
  const { data, error } = await supabase.rpc("user_achievements", {
    p_holiday: holidayId,
    p_user: userId,
  });
  if (error) throw error;
  return (data as Achievements) ?? {};
}

// Cumulative beer-count / points time series for the pace projection board.
// Throws "board is dark" for non-admins during the dark window.
export async function getPaceSeries(holidayId: string): Promise<PaceSeries> {
  const { data, error } = await supabase.rpc("pace_series", { p_holiday: holidayId });
  if (error) throw error;
  return data as PaceSeries;
}

// Day x hour drinking heatmap (group aggregate). Returned even while dark.
export async function getHeatmap(holidayId: string): Promise<Heatmap> {
  const { data, error } = await supabase.rpc("heatmap_data", { p_holiday: holidayId });
  if (error) throw error;
  return data as Heatmap;
}

// Per-day: your beers finished vs the group average, trip-start to today.
export async function getDailyBars(holidayId: string): Promise<DailyBars> {
  const { data, error } = await supabase.rpc("daily_bars", { p_holiday: holidayId });
  if (error) throw error;
  return data as DailyBars;
}

// Per-brand popularity counts for the Beer insights tab (group aggregate).
export async function getBeerInsights(holidayId: string): Promise<BeerInsights> {
  const { data, error } = await supabase.rpc("beer_insights", { p_holiday: holidayId });
  if (error) throw error;
  return data as BeerInsights;
}

export async function refreshSnapshot(holidayId: string): Promise<void> {
  const { error } = await supabase.rpc("refresh_snapshot", { p_holiday: holidayId });
  if (error) throw error;
}

// Admin override of the board state. 'auto' clears the override back to
// date-based; 'live' / 'dark' / 'reveal' force that state.
export async function setHolidayState(
  holidayId: string,
  state: "live" | "dark" | "reveal" | "auto",
): Promise<void> {
  const { error } = await supabase.rpc("set_holiday_state", {
    p_holiday: holidayId,
    p_state: state,
  });
  if (error) throw error;
}

// Admin reschedules the trip end (date + time, in the trip's timezone). Re-snapshots
// server-side so the board reflects any resulting state change immediately.
export async function setTripEnd(
  holidayId: string,
  endDate: string, // YYYY-MM-DD
  endTime: string, // HH:MM
): Promise<void> {
  const { error } = await supabase.rpc("set_trip_end", {
    p_holiday: holidayId,
    p_end_date: endDate,
    p_end_time: endTime,
  });
  if (error) throw error;
}

// Admin reschedules the trip start (date + time, in the trip's timezone).
export async function setTripStart(
  holidayId: string,
  startDate: string, // YYYY-MM-DD
  startTime: string, // HH:MM
): Promise<void> {
  const { error } = await supabase.rpc("set_trip_start", {
    p_holiday: holidayId,
    p_start_date: startDate,
    p_start_time: startTime,
  });
  if (error) throw error;
}

// Can the caller log a beer right now? phase: 'pre' (not started) | 'open' | 'ended'.
export async function uploadWindow(holidayId: string): Promise<UploadWindow> {
  const { data, error } = await supabase.rpc("upload_window", { p_holiday: holidayId });
  if (error) throw error;
  return data as UploadWindow;
}

// Is it happy hour right now for this holiday? Drives the load-time banner.
export async function happyHourNow(holidayId: string): Promise<HappyHourStatus> {
  const { data, error } = await supabase.rpc("happy_hour_now", { p_holiday: holidayId });
  if (error) throw error;
  return data as HappyHourStatus;
}

export async function getAuditQueue(holidayId: string): Promise<AuditItem[]> {
  const { data, error } = await supabase.rpc("audit_queue", { p_holiday: holidayId });
  if (error) throw error;
  return (data as AuditItem[]) ?? [];
}

export async function submitReview(
  beerId: string,
  verdict: "confirm" | "challenge",
): Promise<void> {
  const { error } = await supabase.rpc("submit_review", {
    p_beer: beerId,
    p_verdict: verdict,
  });
  if (error) throw error;
}

export async function adminRuleBeer(
  beerId: string,
  decision: "confirm" | "reject",
  reason?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("admin_rule_beer", {
    p_beer: beerId,
    p_decision: decision,
    p_reason: (reason ?? "").trim().slice(0, 200) || null,
  });
  if (error) throw error;
}

// Admin accepts a beer as legit but sets its points by hand (overrides the
// computed chug/chain/morning score). Confirms the beer.
export async function adminSetBeerScore(
  beerId: string,
  points: number,
  reason?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("admin_set_beer_score", {
    p_beer: beerId,
    p_points: points,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

// The caller's in-progress beer (start logged, empty not yet uploaded), if any.
// Lets the Log tab resume after a reload/app switch instead of losing the start.
// Only returns one whose full photo actually uploaded; takes the most recent.
export async function getOpenBeer(holidayId: string): Promise<Beer | null> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return null;

  const { data, error } = await supabase
    .from("beers")
    .select("*")
    .eq("holiday_id", holidayId)
    .eq("user_id", uid)
    .eq("status", "open")
    .not("full_photo_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Beer) ?? null;
}

// Challenged beers in this holiday (admin queue).
export async function challengedBeers(holidayId: string): Promise<ChallengedBeer[]> {
  const { data, error } = await supabase
    .from("beers")
    .select("*")
    .eq("holiday_id", holidayId)
    .eq("status", "challenged")
    .order("empty_taken_at", { ascending: true });
  if (error) throw error;
  const beers = (data as Beer[]) ?? [];
  if (beers.length === 0) return [];

  // Enrich with the owner's display name so the admin knows whose beer it is.
  // profiles are world-readable to authenticated users (profiles_select policy).
  const ids = [...new Set(beers.map((b) => b.user_id))];
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", ids);
  const nameById = new Map(
    (profs ?? []).map((p) => [p.id as string, p.display_name as string]),
  );
  return beers.map((b) => ({ ...b, owner_name: nameById.get(b.user_id) ?? "Unknown" }));
}

// Every non-open beer in the trip (all players) for the admin "Manage beers"
// screen — used to revisit and correct an earlier ruling. Admin-gated server-side.
export async function getAdminBeers(holidayId: string): Promise<AdminBeer[]> {
  const { data, error } = await supabase.rpc("admin_beers", { p_holiday: holidayId });
  if (error) throw error;
  return (data as AdminBeer[]) ?? [];
}

// --- Logging a beer (two-step, server timestamps via DB triggers) ---

// Step 1: create the open beer row, upload the full photo, attach its path.
export async function startBeer(holidayId: string, fullPhoto: File): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error("not signed in");

  const { data: inserted, error: insErr } = await supabase
    .from("beers")
    .insert({ holiday_id: holidayId, user_id: uid })
    .select("id")
    .single();
  if (insErr) throw insErr;
  const beerId = inserted.id as string;

  const upload = await compressImage(fullPhoto);
  const path = `${holidayId}/${beerId}/full.jpg`;
  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, upload, { upsert: true, contentType: upload.type || "image/jpeg" });
  if (upErr) throw upErr;

  const { error: updErr } = await supabase
    .from("beers")
    .update({ full_photo_path: path })
    .eq("id", beerId);
  if (updErr) throw updErr;

  return beerId;
}

// Step 2: upload the empty photo and finish the beer (trigger stamps empty_taken_at).
// An optional caption + brand tag ride along on the same owner update.
export async function finishBeer(
  holidayId: string,
  beerId: string,
  emptyPhoto: File,
  claimedChug: boolean,
  caption?: string | null,
  brand?: string | null,
): Promise<void> {
  const upload = await compressImage(emptyPhoto);
  const path = `${holidayId}/${beerId}/empty.jpg`;
  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, upload, { upsert: true, contentType: upload.type || "image/jpeg" });
  if (upErr) throw upErr;

  const cap = (caption ?? "").trim().slice(0, 140) || null;
  const br = (brand ?? "").trim().slice(0, 60) || null;
  const { error: updErr } = await supabase
    .from("beers")
    .update({ empty_photo_path: path, claimed_chug: claimedChug, caption: cap, brand: br })
    .eq("id", beerId);
  if (updErr) throw updErr;
}

// Toggle the caller's emoji reaction on a beer (one per user per beer). Returns
// the fresh aggregate { counts, mine } so the UI can update precisely.
export async function reactToBeer(
  beerId: string,
  emoji: string,
): Promise<import("@/lib/reactions").ReactionState> {
  const { data, error } = await supabase.rpc("react_to_beer", {
    p_beer: beerId,
    p_emoji: emoji,
  });
  if (error) throw error;
  return data as import("@/lib/reactions").ReactionState;
}

// Log a beer that was drunk offline, from two existing camera-roll photos.
// We generate the id client-side so we can name the storage paths, upload both
// (compressed) photos, then record the row with the EXIF capture times. The DB
// flags it is_offline so reviewers and ledgers can mark it.
export async function logOfflineBeer(
  holidayId: string,
  fullPhoto: File,
  emptyPhoto: File,
  fullTaken: string, // ISO
  emptyTaken: string, // ISO
  claimedChug: boolean,
  caption?: string | null,
  brand?: string | null,
): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error("not signed in");

  const beerId = crypto.randomUUID();
  const fullPath = `${holidayId}/${beerId}/full.jpg`;
  const emptyPath = `${holidayId}/${beerId}/empty.jpg`;

  const fullUp = await compressImage(fullPhoto);
  const emptyUp = await compressImage(emptyPhoto);

  const up1 = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(fullPath, fullUp, { upsert: true, contentType: fullUp.type || "image/jpeg" });
  if (up1.error) throw up1.error;
  const up2 = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(emptyPath, emptyUp, { upsert: true, contentType: emptyUp.type || "image/jpeg" });
  if (up2.error) throw up2.error;

  const { error } = await supabase.rpc("log_offline_beer", {
    p_id: beerId,
    p_holiday: holidayId,
    p_full_path: fullPath,
    p_empty_path: emptyPath,
    p_full_taken: fullTaken,
    p_empty_taken: emptyTaken,
    p_claimed_chug: claimedChug,
    p_caption: (caption ?? "").trim().slice(0, 140) || null,
    p_brand: (brand ?? "").trim().slice(0, 60) || null,
  });
  if (error) throw error;
  return beerId;
}

// Abandon an open beer that never got an empty photo.
export async function discardBeer(beerId: string): Promise<void> {
  await supabase.from("beers").delete().eq("id", beerId);
}

// --- Unfinished beers (the −1 penalty mechanic) ---

// The caller's own started beers that are now overdue (>90 min, no empty photo).
// Drives the resolution gate on app open.
export async function overdueBeers(holidayId: string): Promise<OverdueBeer[]> {
  const { data, error } = await supabase.rpc("overdue_open_beers", { p_holiday: holidayId });
  if (error) throw error;
  return (data as OverdueBeer[]) ?? [];
}

// Declare one of your open beers unfinished (−1), with an optional note. Raised
// to the admin rulings queue.
export async function declareBeerUnfinished(beerId: string, note?: string | null): Promise<void> {
  const { error } = await supabase.rpc("declare_beer_unfinished", {
    p_beer: beerId,
    p_note: (note ?? "").trim().slice(0, 200) || null,
  });
  if (error) throw error;
}

// Admin rules on an unfinished beer: uphold the −1, or reinstate as +1.
export async function adminRuleUnfinished(
  beerId: string,
  uphold: boolean,
  reason?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("admin_rule_unfinished", {
    p_beer: beerId,
    p_uphold: uphold,
    p_reason: (reason ?? "").trim().slice(0, 200) || null,
  });
  if (error) throw error;
}

export async function signedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 120);
  return data?.signedUrl ?? null;
}

// Batch variant: sign many beer-photo paths in a single round-trip (vs. one
// request per photo). Returns a path → signed URL map; failed/absent paths are
// simply missing from the map. Falsy paths are ignored.
export async function signedUrls(paths: (string | null | undefined)[]): Promise<Record<string, string>> {
  const real = [...new Set(paths.filter((p): p is string => !!p))];
  if (real.length === 0) return {};
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(real, 120);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  }
  return out;
}

// --- Profile avatars ---

// Compress (square ~256px JPEG) and store the caller's avatar, then point their
// profile row at it. Returns the storage path. Overwrites any existing avatar.
export async function uploadAvatar(file: File): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) throw new Error("not signed in");

  const upload = await compressAvatar(file);
  const path = `${uid}/avatar.jpg`;
  const { error: upErr } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, upload, { upsert: true, contentType: "image/jpeg" });
  if (upErr) throw upErr;

  const { error: updErr } = await supabase
    .from("profiles")
    .update({ avatar_path: path })
    .eq("id", uid);
  if (updErr) throw updErr;

  return path;
}

// Avatar signed URLs are cached in-memory and deduped: the same avatar often
// appears in several places at once (reveal, share card, rivalry, feed), and
// the URL is valid for an hour, so re-signing on every mount is wasteful. We
// keep entries well inside the 3600s validity window.
const AVATAR_TTL_MS = 30 * 60 * 1000; // refresh well before the 1h URL expiry
const avatarCache = new Map<string, { url: string | null; ts: number }>();
const avatarInflight = new Map<string, Promise<string | null>>();

export async function avatarUrl(path: string): Promise<string | null> {
  const now = Date.now();
  const hit = avatarCache.get(path);
  if (hit && now - hit.ts < AVATAR_TTL_MS) return hit.url;

  const pending = avatarInflight.get(path);
  if (pending) return pending;

  const req = (async () => {
    const { data } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 3600);
    const url = data?.signedUrl ?? null;
    avatarCache.set(path, { url, ts: Date.now() });
    avatarInflight.delete(path);
    return url;
  })();
  avatarInflight.set(path, req);
  return req;
}

export async function getDailyRecap(holidayId: string): Promise<DailyRecap> {
  const { data, error } = await supabase.rpc("daily_recap", { p_holiday: holidayId });
  if (error) throw error;
  return data as DailyRecap;
}

export async function getShareCard(holidayId: string): Promise<ShareCard> {
  const { data, error } = await supabase.rpc("share_card", { p_holiday: holidayId });
  if (error) throw error;
  return data as ShareCard;
}

// Per-player avatar + beer-photo pool for the grand reveal, keyed by user_id.
export async function getRevealMedia(holidayId: string): Promise<RevealMedia> {
  const { data, error } = await supabase.rpc("reveal_media", { p_holiday: holidayId });
  if (error) throw error;
  return (data as RevealMedia) ?? {};
}

// --- Web Push subscriptions (per-device) ---

// Register/refresh this device's push subscription (upsert keyed on endpoint).
export async function savePushSubscription(
  endpoint: string,
  p256dh: string,
  auth: string,
  userAgent: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_ua: userAgent,
  });
  if (error) throw error;
}

// Forget this device's push subscription.
export async function deletePushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase.rpc("delete_push_subscription", {
    p_endpoint: endpoint,
  });
  if (error) throw error;
}

// Roster for the head-to-head player picker (id, name, avatar).
export async function holidayMembers(holidayId: string): Promise<HolidayMember[]> {
  const { data, error } = await supabase.rpc("holiday_members", { p_holiday: holidayId });
  if (error) throw error;
  return (data as HolidayMember[]) ?? [];
}

// Side-by-side stats for two players. `players` is null while the board is dark.
export async function getHeadToHead(
  holidayId: string,
  userA: string,
  userB: string,
): Promise<HeadToHead> {
  const { data, error } = await supabase.rpc("head_to_head", {
    p_holiday: holidayId,
    p_a: userA,
    p_b: userB,
  });
  if (error) throw error;
  return data as HeadToHead;
}

// The live activity feed — only the bigger moments (chugs, early bird, chains,
// milestones, lead changes…), newest first. `events` is null while the board is
// dark for non-admins.
export async function getActivityFeed(
  holidayId: string,
  limit = 50,
): Promise<ActivityFeed> {
  const { data, error } = await supabase.rpc("activity_feed", {
    p_holiday: holidayId,
    p_limit: limit,
  });
  if (error) throw error;
  return data as ActivityFeed;
}

// --- DB Management (password-gated owner tooling) ---

export async function adminListTrips(password: string): Promise<AdminTrip[]> {
  const { data, error } = await supabase.rpc("admin_list_trips", { p_password: password });
  if (error) throw error;
  return (data as AdminTrip[]) ?? [];
}

export async function adminTripMembers(
  password: string,
  holidayId: string,
): Promise<AdminMember[]> {
  const { data, error } = await supabase.rpc("admin_trip_members", {
    p_password: password,
    p_holiday: holidayId,
  });
  if (error) throw error;
  return (data as AdminMember[]) ?? [];
}

// A member's beers (with photo paths) for the DB-management photo browser.
// Password-gated server-side; works for any trip regardless of membership.
export async function adminMemberBeers(
  password: string,
  holidayId: string,
  userId: string,
): Promise<AdminMemberBeer[]> {
  const { data, error } = await supabase.rpc("admin_member_beers", {
    p_password: password,
    p_holiday: holidayId,
    p_user: userId,
  });
  if (error) throw error;
  return (data as AdminMemberBeer[]) ?? [];
}

// Mint signed URLs for beer photos in any trip via the server route (service
// role bypasses storage RLS). Used by the DB-management photo browser so the
// owner can view photos even for trips they're not a member of. Returns a
// path → signed URL map (missing/failed paths are absent or null).
export async function adminPhotoUrls(
  password: string,
  paths: string[],
): Promise<Record<string, string | null>> {
  const res = await fetch("/api/admin/photo-urls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, paths }),
  });
  if (!res.ok) throw new Error(`photo-urls ${res.status}`);
  const data = (await res.json()) as { urls?: Record<string, string | null> };
  return data.urls ?? {};
}

export async function adminStorageSummary(password: string): Promise<AdminStorageSummary> {
  const { data, error } = await supabase.rpc("admin_storage_summary", { p_password: password });
  if (error) throw error;
  return data as AdminStorageSummary;
}

async function adminPhotoPaths(
  password: string,
  holidayId: string,
  userId?: string,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("admin_trip_photo_paths", {
    p_password: password,
    p_holiday: holidayId,
    p_user: userId ?? null,
  });
  if (error) throw error;
  return (data as string[]) ?? [];
}

// Purge a whole trip: remove its photo blobs from storage first (frees the
// actual files), then delete the trip rows (cascades members/beers/reviews).
export async function adminDeleteTrip(password: string, holidayId: string): Promise<void> {
  const paths = await adminPhotoPaths(password, holidayId);
  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from(PHOTO_BUCKET).remove(paths);
    if (rmErr) throw rmErr;
  }
  const { error } = await supabase.rpc("admin_delete_holiday", {
    p_password: password,
    p_holiday: holidayId,
  });
  if (error) throw error;
}

// Remove one member from a trip and free their photos.
export async function adminDeleteMember(
  password: string,
  holidayId: string,
  userId: string,
): Promise<void> {
  const paths = await adminPhotoPaths(password, holidayId, userId);
  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from(PHOTO_BUCKET).remove(paths);
    if (rmErr) throw rmErr;
  }
  const { error } = await supabase.rpc("admin_delete_member", {
    p_password: password,
    p_holiday: holidayId,
    p_user: userId,
  });
  if (error) throw error;
}
