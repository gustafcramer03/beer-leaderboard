// DB-management photo browser: mint short-lived signed URLs for beer photos in
// ANY trip, regardless of the caller's membership. Storage RLS only lets a
// member read a trip's photos, so the owner-tooling reaches the blobs through
// the service-role key here instead — which bypasses RLS. Gated by the same
// management password as the admin_* RPCs so this isn't an open signing oracle.
//
// Secrets live in Vercel env (never committed / never shipped to the client):
//   SUPABASE_SERVICE_ROLE_KEY — service-role key (server-only; bypasses RLS)
//   ADMIN_DB_PASSWORD         — management password (defaults to the placeholder)

import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "beer-photos";
const EXPIRY_SECONDS = 120;
const MAX_PATHS = 100;

export async function POST(req: Request): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Matches the placeholder baked into admin_check_password until that's hardened.
  const password = process.env.ADMIN_DB_PASSWORD || "password";

  if (!url || !serviceKey) {
    return new Response("photo signing not configured", { status: 503 });
  }

  let body: { password?: string; paths?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  if ((body.password ?? "") !== password) {
    return new Response("forbidden", { status: 403 });
  }

  const paths = Array.isArray(body.paths)
    ? body.paths.filter((p): p is string => typeof p === "string" && p.length > 0).slice(0, MAX_PATHS)
    : [];
  if (paths.length === 0) {
    return Response.json({ urls: {} });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.storage.from(BUCKET).createSignedUrls(paths, EXPIRY_SECONDS);
  if (error) {
    return new Response(error.message, { status: 500 });
  }

  // Map each requested path to its signed URL (null if that one failed).
  const urls: Record<string, string | null> = {};
  for (const row of data ?? []) {
    if (row.path) urls[row.path] = row.signedUrl ?? null;
  }
  return Response.json({ urls });
}
