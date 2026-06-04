"use client";

import { supabase, PHOTO_BUCKET, AVATAR_BUCKET } from "@/lib/supabase";
import { compressImage, compressAvatar } from "@/lib/image";
import type {
  Holiday,
  AuditItem,
  StandingsResult,
  Beer,
  LedgerEntry,
  TripStats,
  AdminTrip,
  AdminMember,
  AdminStorageSummary,
  HappyHourStatus,
  Achievements,
  PaceSeries,
  LegendOfTheDay,
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
): Promise<Holiday> {
  const { data, error } = await supabase.rpc("create_holiday", {
    p_name: name,
    p_start: start,
    p_end: end,
    p_dark_days: darkDays,
    p_timezone: timezone,
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
): Promise<void> {
  const { error } = await supabase.rpc("admin_rule_beer", {
    p_beer: beerId,
    p_decision: decision,
  });
  if (error) throw error;
}

// Admin accepts a beer as legit but sets its points by hand (overrides the
// computed chug/chain/morning score). Confirms the beer.
export async function adminSetBeerScore(
  beerId: string,
  points: number,
): Promise<void> {
  const { error } = await supabase.rpc("admin_set_beer_score", {
    p_beer: beerId,
    p_points: points,
  });
  if (error) throw error;
}

// Challenged beers in this holiday (admin queue).
export async function challengedBeers(holidayId: string): Promise<Beer[]> {
  const { data, error } = await supabase
    .from("beers")
    .select("*")
    .eq("holiday_id", holidayId)
    .eq("status", "challenged")
    .order("empty_taken_at", { ascending: true });
  if (error) throw error;
  return (data as Beer[]) ?? [];
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
export async function finishBeer(
  holidayId: string,
  beerId: string,
  emptyPhoto: File,
  claimedChug: boolean,
): Promise<void> {
  const upload = await compressImage(emptyPhoto);
  const path = `${holidayId}/${beerId}/empty.jpg`;
  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, upload, { upsert: true, contentType: upload.type || "image/jpeg" });
  if (upErr) throw upErr;

  const { error: updErr } = await supabase
    .from("beers")
    .update({ empty_photo_path: path, claimed_chug: claimedChug })
    .eq("id", beerId);
  if (updErr) throw updErr;
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
  });
  if (error) throw error;
  return beerId;
}

// Abandon an open beer that never got an empty photo.
export async function discardBeer(beerId: string): Promise<void> {
  await supabase.from("beers").delete().eq("id", beerId);
}

export async function signedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 120);
  return data?.signedUrl ?? null;
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

export async function avatarUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function getLegendOfTheDay(holidayId: string): Promise<LegendOfTheDay> {
  const { data, error } = await supabase.rpc("legend_of_the_day", { p_holiday: holidayId });
  if (error) throw error;
  return data as LegendOfTheDay;
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
