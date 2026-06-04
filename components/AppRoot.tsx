"use client";

import { useEffect, useState } from "react";
import type { Holiday } from "@/lib/types";
import { useSession } from "./SessionProvider";
import { AuthGate } from "./AuthGate";
import { HolidayPicker } from "./HolidayPicker";
import { HolidayHub } from "./HolidayHub";

const LAST_HOLIDAY_KEY = "beer-last-holiday";

export function AppRoot() {
  const { ready, profile, configError } = useSession();
  const [holiday, setHoliday] = useState<Holiday | null>(null);

  // Remember the last opened holiday id so reopening the app jumps back in.
  useEffect(() => {
    if (holiday) localStorage.setItem(LAST_HOLIDAY_KEY, holiday.id);
  }, [holiday]);

  if (configError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-5xl">🔧</div>
        <h1 className="text-xl font-bold">Setup needed</h1>
        <p className="max-w-sm text-sm text-neutral-500">
          Supabase isn&apos;t connected yet. Add your project URL and anon key to{" "}
          <code>.env.local</code>, then reload.
        </p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="animate-bounce text-5xl" role="img" aria-label="loading">
          🍺
        </span>
      </div>
    );
  }

  if (!profile) return <AuthGate />;

  if (holiday) {
    return <HolidayHub holiday={holiday} onLeave={() => setHoliday(null)} />;
  }

  return <HolidayPicker onPick={setHoliday} />;
}
