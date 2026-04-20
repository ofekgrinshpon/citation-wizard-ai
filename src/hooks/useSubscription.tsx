// Backwards-compatible shim over the new credit system.
// Existing callers continue to work; new code should use useCredits directly.
import { useCallback } from "react";
import { useCredits } from "@/hooks/useCredits";
import { CREDIT_COSTS } from "@/lib/creditCosts";

export function useSubscription() {
  const credits = useCredits();

  const incrementCount = useCallback(
    async (amount = CREDIT_COSTS.citation) => {
      if (credits.isAdmin) return;
      await credits.consume(amount, "legacy:incrementCount");
    },
    [credits],
  );

  const isLimitReached = !credits.isAdmin && credits.totalCreditsAvailable <= 0;
  const remaining = credits.isAdmin
    ? Number.POSITIVE_INFINITY
    : credits.totalCreditsAvailable;

  return {
    isSubscribed: credits.isPaidPlan || credits.isAdmin,
    citationCount: Math.max(0, credits.includedCreditsTotal - credits.includedCreditsRemaining),
    isLimitReached,
    remaining,
    limit: credits.includedCreditsTotal,
    loading: credits.loading,
    incrementCount,
    refresh: credits.refresh,
  };
}
