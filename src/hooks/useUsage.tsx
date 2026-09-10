import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PLANS, type PlanId, isPaidPlan, isFixedTerm } from "@/lib/plans";

/**
 * Semantic, server-authoritative usage status.
 *
 * Deliberately exposes NO raw unit balances — only ratios, states and server
 * timestamps. Client clock changes cannot unlock usage: every timestamp and
 * every eligibility decision comes from the database.
 */

export type UsageLevel = "low" | "medium" | "high" | "near_limit" | "blocked";

export interface UsageStatus {
  plan: PlanId;
  isAdmin: boolean;
  isPaid: boolean;
  isExpired: boolean;
  /** Server `now()` at the moment the status was read. */
  serverNow: string | null;
  /** Local performance offset so countdowns stay server-anchored. */
  windowResetAt: string | null;
  windowLevel: UsageLevel;
  windowRatio: number;
  periodLevel: UsageLevel;
  periodRatio: number;
  planStartedAt: string | null;
  planEndsAt: string | null;
  hasExtraUsage: boolean;
  canPurchaseTopup: boolean;
}

export function usageLevel(ratio: number): UsageLevel {
  if (ratio >= 1) return "blocked";
  if (ratio >= 0.85) return "near_limit";
  if (ratio >= 0.7) return "high";
  if (ratio >= 0.35) return "medium";
  return "low";
}

export const WINDOW_LEVEL_LABEL: Record<UsageLevel, string> = {
  low: "שימוש נמוך",
  medium: "שימוש בינוני",
  high: "שימוש גבוה",
  near_limit: "מתקרבים למגבלה",
  blocked: "הגעת למגבלת השימוש הנוכחית",
};

export const PERIOD_LEVEL_LABEL: Record<UsageLevel, string> = {
  low: "נותרה מכסה רבה",
  medium: "נוצל חלק מהמכסה",
  high: "נוצל חלק ניכר מהמכסה",
  near_limit: "מתקרבים למכסת התוכנית",
  blocked: "מכסת התוכנית נוצלה במלואה",
};

/** Server-anchored countdown text, e.g. "2:41 שעות". */
export function formatCountdown(targetIso: string | null, nowMs: number): string | null {
  if (!targetIso) return null;
  const diff = new Date(targetIso).getTime() - nowMs;
  if (diff <= 0) return null;
  const totalMinutes = Math.ceil(diff / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} דקות`;
  return `${hours}:${String(minutes).padStart(2, "0")} שעות`;
}

export function formatDaysLeft(targetIso: string | null, nowMs: number): number | null {
  if (!targetIso) return null;
  const diff = new Date(targetIso).getTime() - nowMs;
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86400000);
}

export function useUsage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<UsageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  /** server_now − client Date.now(), applied to every countdown. */
  const skewRef = useRef(0);
  const [tick, setTick] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (!user) {
      setStatus(null);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.rpc("get_usage_status");
    const r = (data ?? {}) as Record<string, unknown>;
    if (!error && r.ok) {
      const serverNow = (r.server_now as string) ?? null;
      if (serverNow) skewRef.current = new Date(serverNow).getTime() - Date.now();
      const windowRatio = Number(r.window_used_ratio ?? 0);
      const periodRatio = Number(r.period_used_ratio ?? 0);
      setStatus({
        plan: (r.plan as PlanId) ?? "trial",
        isAdmin: Boolean(r.is_admin),
        isPaid: Boolean(r.is_paid),
        isExpired: Boolean(r.is_expired),
        serverNow,
        windowResetAt: (r.window_reset_at as string) ?? null,
        windowRatio,
        windowLevel: usageLevel(windowRatio),
        periodRatio,
        periodLevel: usageLevel(periodRatio),
        planStartedAt: (r.plan_started_at as string) ?? null,
        planEndsAt: (r.plan_ends_at as string) ?? null,
        hasExtraUsage: Boolean(r.has_extra_usage),
        canPurchaseTopup: Boolean(r.can_purchase_topup),
      });
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Countdown ticker — display only; eligibility is always decided server-side.
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const serverNowMs = tick + skewRef.current;
  const plan = status?.plan ?? "trial";
  const planMeta = PLANS[plan] ?? PLANS.trial;

  return {
    status,
    loading,
    refresh,
    planMeta,
    serverNowMs,
    isTrial: plan === "trial",
    isPaid: isPaidPlan(plan),
    isFixedTerm: isFixedTerm(plan),
    windowCountdown: formatCountdown(status?.windowResetAt ?? null, serverNowMs),
    planDaysLeft: formatDaysLeft(status?.planEndsAt ?? null, serverNowMs),
  };
}
