import { useCallback, useEffect, useState } from "react";
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
  const { user } = useAuth();
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("credit_ledger")
      .select(
        "id, request_id, event_type, amount, included_delta, topup_delta, balance_after_included, balance_after_topup, reason, created_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!error && data) setRows(data as unknown as LedgerRow[]);
    setLoading(false);
  }, [user, limit]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { rows, loading, refresh: fetch };
}
