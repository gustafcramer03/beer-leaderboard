"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "./SessionProvider";
import { uploadAvatar } from "@/lib/api";

type Mode = "new" | "returning";

export function AuthGate() {
  const { signUp, signIn, refreshProfile } = useSession();
  const [mode, setMode] = useState<Mode>("new");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After a successful sign-up we show a one-time reminder of the login details.
  const [saved, setSaved] = useState<{ name: string; code: string } | null>(null);

  // Optional profile photo chosen during sign-up (selfie or library pick).
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const canSubmit = name.trim().length > 0 && code.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "new") {
        await signUp(name, code);
        // Avatar is optional — never block account creation if it fails.
        if (photo) {
          try {
            await uploadAvatar(photo);
          } catch (e) {
            console.error("avatar upload failed", e);
          }
        }
        setSaved({ name: name.trim(), code });
      } else {
        await signIn(name, code);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // One-time confirmation so people actually record their recovery code.
  if (saved) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8">
        <div className="text-6xl">🔑</div>
        <h1 className="text-2xl font-black">Save your login</h1>
        <p className="max-w-xs text-center text-sm text-neutral-500">
          Write these down. You&apos;ll need them to get back into your account on another phone,
          or if you reinstall or clear your browser.
        </p>
        <div className="w-full max-w-xs rounded-2xl border border-amber-300 bg-amber-50 p-4 text-center dark:bg-amber-900/30">
          <div className="text-xs uppercase tracking-wide text-amber-700">Name</div>
          <div className="mb-3 text-lg font-bold">{saved.name}</div>
          <div className="text-xs uppercase tracking-wide text-amber-700">Recovery code</div>
          <div className="font-mono text-lg font-bold">{saved.code}</div>
        </div>
        <button
          onClick={() => refreshProfile()}
          className="rounded-full bg-amber-500 px-8 py-3 font-semibold text-white"
        >
          I&apos;ve saved it — continue
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8">
      <div className="text-6xl">🍺</div>
      <h1 className="text-2xl font-black">Beer League</h1>

      <div className="flex rounded-full bg-neutral-200 p-1 text-sm dark:bg-neutral-800">
        <button
          onClick={() => { setMode("new"); setError(null); }}
          className={`rounded-full px-4 py-1.5 font-medium ${mode === "new" ? "bg-white shadow dark:bg-neutral-700" : "text-neutral-500"}`}
        >
          New player
        </button>
        <button
          onClick={() => { setMode("returning"); setError(null); }}
          className={`rounded-full px-4 py-1.5 font-medium ${mode === "returning" ? "bg-white shadow dark:bg-neutral-700" : "text-neutral-500"}`}
        >
          I have an account
        </button>
      </div>

      <p className="max-w-xs text-center text-sm text-neutral-500">
        {mode === "new"
          ? "Pick a name for the leaderboard and a recovery code so you can log back in later."
          : "Enter the name and recovery code you chose when you started."}
      </p>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder="Your name"
        autoCapitalize="words"
        className="w-full max-w-xs rounded-xl border border-neutral-300 px-4 py-3 text-center text-lg dark:bg-neutral-800"
      />
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        type="text"
        autoCapitalize="none"
        autoCorrect="off"
        placeholder="Recovery code"
        className="w-full max-w-xs rounded-xl border border-neutral-300 px-4 py-3 text-center text-lg dark:bg-neutral-800"
      />
      {mode === "new" && (
        <p className="-mt-3 text-xs text-neutral-400">Any code you&apos;ll remember — short is fine.</p>
      )}

      {mode === "new" && (
        <div className="flex flex-col items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-neutral-300 bg-neutral-100 text-2xl dark:border-neutral-600 dark:bg-neutral-800"
            aria-label="Add a profile photo"
          >
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              "📷"
            )}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-xs font-medium text-amber-600"
          >
            {photo ? "Change photo" : "Add a profile photo (optional)"}
          </button>
          {photo && (
            <button
              type="button"
              onClick={() => setPhoto(null)}
              className="text-xs text-neutral-400"
            >
              Remove
            </button>
          )}
          <p className="max-w-xs text-center text-[11px] text-neutral-400">
            Take a selfie or pick one from your camera roll. Skip it and you&apos;ll get the Lorax. 🟠
          </p>
        </div>
      )}

      <button
        onClick={submit}
        disabled={!canSubmit}
        className="rounded-full bg-amber-500 px-8 py-3 font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Please wait…" : mode === "new" ? "Create account" : "Log in"}
      </button>
      {error && <p className="max-w-xs text-center text-sm text-red-600">{error}</p>}
    </div>
  );
}
