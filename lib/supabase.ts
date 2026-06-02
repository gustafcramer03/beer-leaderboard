"use client";

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // Surfaced clearly in the browser console if env vars are missing.
  console.warn(
    "Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local",
  );
}

// Fall back to a syntactically-valid placeholder so the client never throws at
// import/build time when env vars are absent. The UI detects the missing config
// (see SessionProvider) and shows a setup screen instead of making real calls.
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  anon || "placeholder-anon-key",
  {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "beer-leaderboard-auth",
  },
});

export const PHOTO_BUCKET = "beer-photos";
