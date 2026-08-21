import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { withTimeout, supabaseWithTimeout } from "@/lib/queryTimeout";
import { getAuthRedirectOrigin } from "@/lib/publicUrl";
import { LEGAL_VERSION } from "@/content/legal/version";
import type { User, Session } from "@supabase/supabase-js";

const ROLE_TIMEOUT_MS = 6000;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  isAdminResolved: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string, referralCode?: string, acceptedLegal?: boolean) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminResolved, setIsAdminResolved] = useState(false);
  const hasHydratedSession = useRef(false);

  const resolveAdmin = async (nextUser: User | null) => {
    if (!nextUser) {
      setIsAdmin(false);
      setIsAdminResolved(true);
      return;
    }

    setIsAdminResolved(false);
    try {
      const { data, error } = await supabaseWithTimeout(
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", nextUser.id)
          .eq("role", "admin")
          .maybeSingle(),
        ROLE_TIMEOUT_MS,
        "admin role lookup",
      );

      setIsAdmin(!error && !!data);
    } catch (err) {
      console.error("[ReLex] resolveAdmin failed/timeout:", err);
      // Fail-safe: treat as non-admin so user isn't stuck
      setIsAdmin(false);
    } finally {
      setIsAdminResolved(true);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const syncAuthState = (nextSession: Session | null, setReady = false) => {
      if (!isMounted) return;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      // Fire-and-forget: don't block auth hydration on admin resolution
      resolveAdmin(nextSession?.user ?? null);

      if (setReady || hasHydratedSession.current) {
        setLoading(false);
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncAuthState(nextSession);
    });

    // Hard timeout on getSession itself — if backend is saturated, don't hang forever
    const sessionPromise = supabase.auth.getSession();
    withTimeout(sessionPromise, 10000, "getSession")
      .then(({ data: { session: currentSession } }) => {
        hasHydratedSession.current = true;
        void syncAuthState(currentSession, true);
      })
      .catch((err) => {
        console.error("[ReLex] getSession failed/timeout:", err);
        hasHydratedSession.current = true;
        if (isMounted) {
          setLoading(false);
          setIsAdminResolved(true);
        }
      });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error && data.session) {
      setSession(data.session);
      setUser(data.session.user);
      setLoading(false);
      void resolveAdmin(data.session.user);
    }
    return { error: error as Error | null };
  };

  const signUp = async (
    email: string,
    password: string,
    fullName?: string,
    referralCode?: string,
    acceptedLegal?: boolean,
  ) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          ...(referralCode ? { referral_code: referralCode } : {}),
          // Evidentiary record of the consent checkbox ticked at signup.
          ...(acceptedLegal
            ? { legal_version: LEGAL_VERSION, legal_accepted_at: new Date().toISOString() }
            : {}),
        },
        emailRedirectTo: `${getAuthRedirectOrigin()}/auth-redirect`,
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, isAdmin, isAdminResolved, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
