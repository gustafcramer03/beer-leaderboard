"use client";

import { useEffect, useState, useCallback } from "react";
import type { Holiday } from "@/lib/types";
import { myHolidays, createHoliday, joinHoliday } from "@/lib/api";
import { useSession } from "./SessionProvider";
import { DbManagement } from "./DbManagement";
import { Loading } from "./Loading";

export function HolidayPicker({ onPick }: { onPick: (h: Holiday) => void }) {
  const { profile, signOut } = useSession();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "create" | "join">("list");
  const [showDbAdmin, setShowDbAdmin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHolidays(await myHolidays());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading label="Rounding up your trips…" />;

  return (
    <div className="flex flex-col gap-4 p-5">
      <h1 className="text-center text-2xl font-black">🍺 Your holidays</h1>

      {mode === "list" && (
        <>
          <ul className="flex flex-col gap-2">
            {holidays.map((h) => (
              <li key={h.id}>
                <button
                  onClick={() => onPick(h)}
                  className="w-full rounded-2xl bg-white p-4 text-left shadow dark:bg-neutral-800"
                >
                  <div className="font-bold">{h.name}</div>
                  <div className="text-xs text-neutral-500">
                    {h.start_date} → {h.end_date} · code {h.invite_code}
                  </div>
                </button>
              </li>
            ))}
            {holidays.length === 0 && (
              <li className="rounded-2xl bg-neutral-100 p-6 text-center text-sm text-neutral-500 dark:bg-neutral-800">
                No holidays yet. Create one or join with a code.
              </li>
            )}
          </ul>
          <div className="flex gap-3">
            <button
              onClick={() => setMode("create")}
              className="flex-1 rounded-full bg-amber-500 py-3 font-semibold text-white"
            >
              + Create
            </button>
            <button
              onClick={() => setMode("join")}
              className="flex-1 rounded-full border border-amber-400 py-3 font-semibold text-amber-600"
            >
              Join by code
            </button>
          </div>
        </>
      )}

      {mode === "create" && <CreateForm onDone={onPick} onBack={() => setMode("list")} />}
      {mode === "join" && <JoinForm onDone={onPick} onBack={() => setMode("list")} />}

      {mode === "list" && profile && (
        <p className="mt-2 text-center text-xs text-neutral-400">
          Signed in as <span className="font-medium">{profile.display_name}</span> ·{" "}
          <button onClick={() => signOut()} className="underline">
            Log out
          </button>
        </p>
      )}

      {mode === "list" && (
        <button
          onClick={() => setShowDbAdmin(true)}
          className="mx-auto text-xs text-neutral-400 underline"
        >
          🗄️ DB Management
        </button>
      )}

      {showDbAdmin && <DbManagement onClose={() => setShowDbAdmin(false)} />}
    </div>
  );
}

function CreateForm({ onDone, onBack }: { onDone: (h: Holiday) => void; onBack: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const detectedTz =
    (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";
  const [name, setName] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [darkDays, setDarkDays] = useState(2);
  const [timezone, setTimezone] = useState(detectedTz);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Common zones for the picker; always include the detected one.
  const tzOptions = Array.from(
    new Set([
      detectedTz,
      "Europe/London",
      "Europe/Stockholm",
      "Europe/Madrid",
      "Europe/Athens",
      "Atlantic/Canary",
      "America/New_York",
      "America/Los_Angeles",
      "Asia/Bangkok",
      "Asia/Dubai",
      "UTC",
    ]),
  );

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await createHoliday(name.trim(), start, end, darkDays, timezone));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Holiday name">
        <input className={inputCls} value={name} maxLength={80}
          onChange={(e) => setName(e.target.value)} placeholder="Mallorca 2026" />
      </Field>
      <div className="flex gap-3">
        <Field label="Start">
          <input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End">
          <input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field label="Dark days before the end (board hidden)">
        <input type="number" min={0} max={14} className={inputCls} value={darkDays}
          onChange={(e) => setDarkDays(parseInt(e.target.value || "0", 10))} />
      </Field>
      <p className="text-xs text-neutral-400">
        The leaderboard hides for the last {darkDays} day{darkDays === 1 ? "" : "s"} and is revealed on the final day.
      </p>
      <Field label="Holiday timezone (for the 7–11am morning bonus)">
        <select className={inputCls} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
          {tzOptions.map((tz) => (
            <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
          ))}
        </select>
      </Field>
      <p className="text-xs text-neutral-400">
        Beers logged 7:00–10:59 local time earn +1 bonus point. Defaulted to this device&apos;s timezone.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 rounded-full border py-3">Back</button>
        <button onClick={submit} disabled={busy || !name.trim()}
          className="flex-1 rounded-full bg-amber-500 py-3 font-semibold text-white disabled:opacity-40">
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}

function JoinForm({ onDone, onBack }: { onDone: (h: Holiday) => void; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await joinHoliday(code));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Invite code">
        <input className={`${inputCls} text-center text-2xl uppercase tracking-widest`}
          value={code} maxLength={6}
          onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" />
      </Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button onClick={onBack} className="flex-1 rounded-full border py-3">Back</button>
        <button onClick={submit} disabled={busy || !code.trim()}
          className="flex-1 rounded-full bg-amber-500 py-3 font-semibold text-white disabled:opacity-40">
          {busy ? "Joining…" : "Join"}
        </button>
      </div>
    </div>
  );
}

const inputCls = "w-full rounded-xl border border-neutral-300 px-4 py-3 dark:bg-neutral-800";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}
