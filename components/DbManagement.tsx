"use client";

// Owner-only DB management: browse every trip in the database with its photo
// count and storage footprint, drill into a trip's members, and delete a trip
// or a single member to free space. Gated by a password (placeholder: the page
// passes it to the server on every call too). Footer shows total storage used
// as a percentage of the Supabase free-tier allowance.

import { useCallback, useEffect, useState } from "react";
import type { AdminTrip, AdminMember, AdminStorageSummary } from "@/lib/types";
import {
  adminListTrips,
  adminTripMembers,
  adminStorageSummary,
  adminDeleteTrip,
  adminDeleteMember,
} from "@/lib/api";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function DbManagement({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function tryUnlock() {
    setChecking(true);
    setAuthError(null);
    try {
      // A lightweight call validates the password server-side.
      await adminStorageSummary(password);
      setUnlocked(true);
    } catch {
      setAuthError("Wrong password.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-50 dark:bg-neutral-900">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
        <h2 className="text-lg font-bold">🗄️ DB Management</h2>
        <button
          onClick={onClose}
          className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-medium dark:bg-neutral-700"
        >
          Close
        </button>
      </header>

      {!unlocked ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="text-6xl">🔒</div>
          <p className="max-w-xs text-sm text-neutral-500">
            This area lets you delete trips and members. Enter the password to continue.
          </p>
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
            placeholder="Password"
            className="w-full max-w-xs rounded-xl border border-neutral-300 px-4 py-3 text-center dark:bg-neutral-800"
          />
          {authError && <p className="text-sm text-red-600">{authError}</p>}
          <button
            onClick={tryUnlock}
            disabled={checking || !password}
            className="w-full max-w-xs rounded-full bg-amber-500 py-3 font-semibold text-white disabled:opacity-40"
          >
            {checking ? "Checking…" : "Unlock"}
          </button>
        </div>
      ) : (
        <Dashboard password={password} />
      )}
    </div>
  );
}

function Dashboard({ password }: { password: string }) {
  const [trips, setTrips] = useState<AdminTrip[] | null>(null);
  const [summary, setSummary] = useState<AdminStorageSummary | null>(null);
  const [selected, setSelected] = useState<AdminTrip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, s] = await Promise.all([
        adminListTrips(password),
        adminStorageSummary(password),
      ]);
      setTrips(t);
      setSummary(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    }
  }, [password]);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteTrip(trip: AdminTrip) {
    if (
      !window.confirm(
        `Delete "${trip.name}" entirely? This removes ${trip.member_count} member(s), ` +
          `${trip.beer_count} beer(s) and ${trip.photo_count} photo(s). This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      await adminDeleteTrip(password, trip.id);
      setSelected(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex-1 p-4">
          <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-600">
            {error}
          </p>
          <button onClick={load} className="mx-auto mt-4 block rounded-full border px-4 py-2 text-sm">
            Retry
          </button>
        </div>
        {summary && <StorageFooter summary={summary} />}
      </div>
    );
  }

  if (!trips || !summary) {
    return <p className="flex-1 p-8 text-center text-neutral-500">Loading…</p>;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4">
        {selected ? (
          <TripDetail
            password={password}
            trip={selected}
            onBack={() => setSelected(null)}
            onDeleteTrip={() => deleteTrip(selected)}
            onChanged={load}
            busy={busy}
          />
        ) : (
          <>
            <p className="mb-3 text-sm text-neutral-500">
              {trips.length} trip{trips.length === 1 ? "" : "s"} in the database. Tap one to manage
              its members or delete it.
            </p>
            <ul className="flex flex-col gap-2">
              {trips.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setSelected(t)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white p-4 text-left shadow-sm dark:bg-neutral-800"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-bold">{t.name}</div>
                      <div className="text-xs text-neutral-500">
                        {t.member_count} member{t.member_count === 1 ? "" : "s"} · {t.beer_count} beer
                        {t.beer_count === 1 ? "" : "s"} · {t.photo_count} photo
                        {t.photo_count === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-right">
                      <span className="text-sm font-semibold">{fmtBytes(t.storage_bytes)}</span>
                      <span className="text-neutral-300">›</span>
                    </div>
                  </button>
                </li>
              ))}
              {trips.length === 0 && (
                <li className="rounded-2xl bg-neutral-100 p-6 text-center text-sm text-neutral-500 dark:bg-neutral-800">
                  No trips in the database.
                </li>
              )}
            </ul>
          </>
        )}
      </div>
      <StorageFooter summary={summary} />
    </div>
  );
}

function TripDetail({
  password,
  trip,
  onBack,
  onDeleteTrip,
  onChanged,
  busy,
}: {
  password: string;
  trip: AdminTrip;
  onBack: () => void;
  onDeleteTrip: () => void;
  onChanged: () => Promise<void>;
  busy: boolean;
}) {
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const loadMembers = useCallback(async () => {
    setError(null);
    try {
      setMembers(await adminTripMembers(password, trip.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load members.");
    }
  }, [password, trip.id]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  async function removeMember(m: AdminMember) {
    if (
      !window.confirm(
        `Remove ${m.display_name} from "${trip.name}"? This deletes their ${m.beer_count} beer(s) ` +
          `and ${m.photo_count} photo(s) in this trip.`,
      )
    )
      return;
    setWorking(true);
    try {
      await adminDeleteMember(password, trip.id, m.user_id);
      await loadMembers();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button onClick={onBack} className="self-start text-sm text-neutral-400">
        ← All trips
      </button>

      <div className="rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-800">
        <h3 className="text-lg font-bold">{trip.name}</h3>
        <p className="text-xs text-neutral-500">
          {trip.start_date} → {trip.end_date} · code {trip.invite_code}
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {trip.photo_count} photo{trip.photo_count === 1 ? "" : "s"} ·{" "}
          {fmtBytes(trip.storage_bytes)}
        </p>
      </div>

      {error && (
        <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-center text-sm text-red-600">
          {error}
        </p>
      )}

      <h4 className="mt-1 text-sm font-semibold text-neutral-500">Members</h4>
      <ul className="flex flex-col gap-2">
        {members?.map((m) => (
          <li
            key={m.user_id}
            className="flex items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-sm dark:bg-neutral-800"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">
                {m.display_name}
                {m.is_admin && <span className="ml-1 text-xs text-amber-600">(admin)</span>}
              </div>
              <div className="text-xs text-neutral-500">
                {m.beer_count} beer{m.beer_count === 1 ? "" : "s"} · {m.photo_count} photo
                {m.photo_count === 1 ? "" : "s"} · {fmtBytes(m.storage_bytes)}
              </div>
            </div>
            {m.is_admin ? (
              <span className="text-xs text-neutral-400">trip owner</span>
            ) : (
              <button
                onClick={() => removeMember(m)}
                disabled={working || busy}
                className="shrink-0 rounded-full bg-red-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                Remove
              </button>
            )}
          </li>
        ))}
        {members && members.length === 0 && (
          <li className="rounded-2xl bg-neutral-100 p-4 text-center text-sm text-neutral-500 dark:bg-neutral-800">
            No members.
          </li>
        )}
        {!members && <li className="p-4 text-center text-sm text-neutral-500">Loading…</li>}
      </ul>

      <button
        onClick={onDeleteTrip}
        disabled={busy || working}
        className="mt-4 rounded-full bg-red-600 py-3 font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Deleting…" : "🗑️ Delete this trip entirely"}
      </button>
    </div>
  );
}

function StorageFooter({ summary }: { summary: AdminStorageSummary }) {
  const pct = Math.min(summary.used_pct, 100);
  const danger = summary.used_pct >= 80;
  return (
    <div className="border-t border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
      <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
        <span>
          Storage used · {summary.total_photos} photo{summary.total_photos === 1 ? "" : "s"}
        </span>
        <span className="font-semibold">
          {fmtBytes(summary.total_bytes)} / {fmtBytes(summary.limit_bytes)}
        </span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div
          className={`h-full rounded-full transition-all ${danger ? "bg-red-500" : "bg-amber-500"}`}
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
      <p className="mt-1 text-center text-xs text-neutral-400">
        {summary.used_pct}% of the free-tier 1&nbsp;GB allowance used
      </p>
    </div>
  );
}
