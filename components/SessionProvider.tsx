"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type Profile = { id: string; display_name: string; avatar_path: string | null };

type Ctx = {
  ready: boolean;
  session: Session | null;
  userId: string | null;
  profile: Profile | null;
  configError: boolean;
  signUp: (name: string, code: string) => Promise<void>;
  signIn: (name: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const SessionCtx = createContext<Ctx | null>(null);

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

// A login handle is derived from the chosen name: lower-cased, letters/digits only.
// Two people with the same handle collide (good enough for a friends' game — the
// second is told the name is taken). The synthetic email never receives mail;
// it's just the credential Supabase stores alongside the recovery code (password).
export function handleFromName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function emailFor(name: string): string {
  return `${handleFromName(name)}@beerleague.app`;
}

// Players may choose any recovery code, however short. Supabase enforces a
// 6-char password floor, so we deterministically pad the code before sending it.
// The transform is identical on sign-up and sign-in, so login still matches.
function padCode(code: string): string {
  return `${code}·beerleague`;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [configError, setConfigError] = useState(false);

  const loadProfile = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_path")
      .eq("id", uid)
      .maybeSingle();
    setProfile(data ?? null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user.id) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        setConfigError(true);
        setReady(true);
        return;
      }
      const { data } = await supabase.auth.getSession();
      let s = data.session;
      // Legacy anonymous sessions have no recovery code, so retire them and make
      // the user create a proper name + code account.
      if (s?.user?.is_anonymous) {
        await supabase.auth.signOut();
        s = null;
      }
      if (!active) return;
      setSession(s);
      if (s?.user.id) await loadProfile(s.user.id);
      setReady(true);
    })();

    // Only track the session here; profile loads are triggered explicitly
    // (initial mount, signIn, or the post-signup "continue") so the signup
    // reminder screen isn't skipped by a SIGNED_IN event.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setProfile(null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signUp = useCallback(
    async (name: string, code: string) => {
      const handle = handleFromName(name);
      if (handle.length < 2) throw new Error("Please use a name with at least 2 letters or numbers.");
      if (code.length < 1) throw new Error("Please enter a recovery code.");

      const { data, error } = await supabase.auth.signUp({
        email: emailFor(name),
        password: padCode(code),
      });
      if (error) {
        if (/already registered|already exists|User already/i.test(error.message)) {
          throw new Error("That name is taken. Pick another — or if it's you, tap “I already have an account”.");
        }
        throw error;
      }
      const uid = data.user?.id;
      if (!uid) throw new Error("Sign-up failed — please try again.");

      const { error: pErr } = await supabase
        .from("profiles")
        .upsert({ id: uid, display_name: name.trim() });
      if (pErr) throw pErr;

      // Set the session but leave context profile null so the AuthGate can show
      // the "save your recovery code" reminder; refreshProfile() flips us in.
      setSession(data.session);
    },
    [],
  );

  const signIn = useCallback(
    async (name: string, code: string) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailFor(name),
        password: padCode(code),
      });
      if (error) {
        throw new Error("Name or recovery code doesn't match. Check the spelling and try again.");
      }
      setSession(data.session);
      // keep the display name fresh (and self-heal a missing profile row)
      await supabase.from("profiles").upsert({ id: data.user.id, display_name: name.trim() });
      await loadProfile(data.user.id);
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  return (
    <SessionCtx.Provider
      value={{
        ready,
        session,
        userId: session?.user.id ?? null,
        profile,
        configError,
        signUp,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </SessionCtx.Provider>
  );
}
