import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type LedgerEventType =
  | "consume"
  | "refund"
  | "topup"
  | "renewal"
  | "admin_adjustment"
  | "referral_bonus"
  | "signup_bonus";

export interface LedgerRow {
  id: string;
  request_id: string;
  event_type: LedgerEventType;
  amount: number;
  included_delta: number;
  topup_delta: number;
  balance_after_included: number;
  balance_after_topup: number;
  reason: string | null;
  created_at: string;
}

export function useCreditLedger(limit = 25) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scopeRef = useRef<{ userId: string | null; seq: number }>({ userId: null, seq: 0 });

  const fetch = useCallback(async () => {
    const seq = ++scopeRef.current.seq;
    scopeRef.current.userId = userId;
    if (authLoading) return;
    if (!userId) {
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let data: unknown = null;
    let qErr: unknown = null;
    try {
      const res = await supabase
        .from("credit_ledger")
        .select(
          "id, request_id, event_type, amount, included_delta, topup_delta, balance_after_included, balance_after_topup, reason, created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      data = res.data;
      qErr = res.error;
    } catch (e) {
      qErr = e;
    }
    if (scopeRef.current.seq !== seq || scopeRef.current.userId !== userId) return;
    if (qErr || !Array.isArray(data)) {
      setRows([]);
      setError("LEDGER_LOAD_FAILED");
    } else {
      setRows(data as LedgerRow[]);
    }
    setLoading(false);
  }, [userId, authLoading, limit]);

  useEffect(() => {
    setRows([]);
    setError(null);
    setLoading(true);
    fetch();
  }, [fetch]);

  return { rows, loading, error, refresh: fetch };
}
