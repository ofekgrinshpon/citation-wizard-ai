import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Account profile (name + read-only email) for the current user only.
 * Responses that arrive after a user switch are discarded.
 */
export function useAccountProfile() {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const scopeRef = useRef<{ userId: string | null; seq: number }>({ userId: null, seq: 0 });
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    const seq = ++scopeRef.current.seq;
    scopeRef.current.userId = userId;
    if (authLoading) return;
    if (!userId) {
      setFullName(""); setEmail(""); setError(null); setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let data: { full_name: string | null; email: string | null } | null = null;
    let qErr: unknown = null;
    try {
      const res = await supabase.from("profiles").select("full_name, email").eq("id", userId).single();
      data = res.data as typeof data;
      qErr = res.error;
    } catch (e) { qErr = e; }
    if (scopeRef.current.seq !== seq || scopeRef.current.userId !== userId) return;
    if (qErr || !data) {
      setError("PROFILE_LOAD_FAILED");
    } else {
      setFullName(data.full_name || "");
      setEmail(data.email || user?.email || "");
    }
    setLoading(false);
  }, [userId, authLoading, user?.email]);

  useEffect(() => {
    setFullName(""); setEmail(""); setError(null); setSaveState("idle"); setLoading(true);
    savingRef.current = false;
    load();
  }, [load]);

  /** Saves the name. Success only when exactly the current user's row was updated. */
  const save = useCallback(async (): Promise<boolean> => {
    if (!userId || savingRef.current) return false;
    savingRef.current = true;
    setSaveState("saving");
    const forUser = userId;
    let ok = false;
    try {
      const res = await supabase.from("profiles").update({ full_name: fullName }).eq("id", forUser).select("id");
      const rows = (res.data ?? []) as { id: string }[];
      ok = !res.error && rows.length === 1 && rows[0].id === forUser;
    } catch { ok = false; }
    if (scopeRef.current.userId !== forUser) return false;
    savingRef.current = false;
    setSaveState(ok ? "saved" : "error");
    return ok;
  }, [userId, fullName]);

  const onNameChange = (v: string) => {
    setFullName(v);
    if (saveState === "saved") setSaveState("idle");
  };

  return { fullName, setFullName: onNameChange, email, loading, error, reload: load, save, saveState };
}
