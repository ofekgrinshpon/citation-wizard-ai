import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PLANS, type PlanId, isPaidPlan } from "@/lib/plans";

export interface ConsumeResult {
  ok: boolean;
  error?: string;
  requestId: string;
  remainingIncluded: number;
  remainingTopup: number;
  required?: number;
}

export interface RefundResult {
  ok: boolean;
  remainingIncluded: number;
  remainingTopup: number;
}

interface ProfileRow {
  plan: PlanId;
  included_credits_remaining: number;
  included_credits_total: number;
  topup_credits_remaining: number;
  billing_period_started_at: string | null;
  billing_period_ends_at: string | null;
  credits_reset_mode: string;
  referral_code: string | null;
  referred_by_user_id: string | null;
}

export function useCredits() {
  const { user, isAdmin } = useAuth();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "plan, included_credits_remaining, included_credits_total, topup_credits_remaining, billing_period_started_at, billing_period_ends_at, credits_reset_mode, referral_code, referred_by_user_id",
      )
      .eq("id", user.id)
      .single();
    if (!error && data) setProfile(data as unknown as ProfileRow);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const plan: PlanId = isAdmin ? "admin" : ((profile?.plan as PlanId) ?? "trial");
  const planMeta = PLANS[plan] ?? PLANS.trial;
  const includedCreditsRemaining = profile?.included_credits_remaining ?? 0;
  const includedCreditsTotal = profile?.included_credits_total ?? planMeta.includedUnits;
  const topupCreditsRemaining = profile?.topup_credits_remaining ?? 0;
  const totalCreditsAvailable = isAdmin
    ? Number.POSITIVE_INFINITY
    : includedCreditsRemaining + topupCreditsRemaining;
  const billingPeriodEndsAt = profile?.billing_period_ends_at ?? null;
  const creditsResetMode = (profile?.credits_reset_mode ?? planMeta.resetMode) as PlanMeta["resetMode"];
  const referralCode = profile?.referral_code ?? null;
  const referredByUserId = profile?.referred_by_user_id ?? null;

  const hasEnough = useCallback(
    (amount: number) => isAdmin || totalCreditsAvailable >= amount,
    [isAdmin, totalCreditsAvailable],
  );

  /** Charge `amount` credits. Returns ok=false on insufficient/error; caller should show dialog. */
  const consume = useCallback(
    async (amount: number, reason: string, requestId?: string): Promise<ConsumeResult> => {
      const id = requestId ?? crypto.randomUUID();
      if (!user) {
        return { ok: false, error: "NOT_AUTHENTICATED", requestId: id, remainingIncluded: 0, remainingTopup: 0 };
      }
      const { data, error } = await supabase.rpc("consume_credits", {
        _amount: amount,
        _reason: reason,
        _request_id: id,
      });
      if (error) {
        return { ok: false, error: error.message, requestId: id, remainingIncluded: includedCreditsRemaining, remainingTopup: topupCreditsRemaining };
      }
      const r = (data ?? {}) as Record<string, unknown>;
      await refresh();
      return {
        ok: Boolean(r.ok),
        error: r.error as string | undefined,
        required: r.required as number | undefined,
        requestId: id,
        remainingIncluded: (r.remaining_included as number) ?? includedCreditsRemaining,
        remainingTopup: (r.remaining_topup as number) ?? topupCreditsRemaining,
      };
    },
    [user, refresh, includedCreditsRemaining, topupCreditsRemaining],
  );

  /** Refund a previously consumed request id. Idempotent on server. */
  const refund = useCallback(
    async (requestId: string, reason: string): Promise<RefundResult> => {
      const { data, error } = await supabase.rpc("refund_credits", {
        _request_id: requestId,
        _reason: reason,
      });
      if (error) {
        return { ok: false, remainingIncluded: includedCreditsRemaining, remainingTopup: topupCreditsRemaining };
      }
      const r = (data ?? {}) as Record<string, unknown>;
      await refresh();
      return {
        ok: Boolean(r.ok),
        remainingIncluded: (r.remaining_included as number) ?? includedCreditsRemaining,
        remainingTopup: (r.remaining_topup as number) ?? topupCreditsRemaining,
      };
    },
    [refresh, includedCreditsRemaining, topupCreditsRemaining],
  );

  return {
    plan,
    planMeta,
    isPaidPlan: isPaidPlan(plan),
    isAdmin,
    canTopup: planMeta.allowsTopup,
    includedCreditsRemaining,
    includedCreditsTotal,
    topupCreditsRemaining,
    totalCreditsAvailable,
    billingPeriodEndsAt,
    creditsResetMode,
    referralCode,
    referredByUserId,
    loading,
    hasEnough,
    consume,
    refund,
    refresh,
  };
}

type PlanMeta = (typeof PLANS)[PlanId];
