import { useCallback, useEffect, useRef, useState } from "react";
import { CITATION_TRIAL_CHANGED, fetchCitationTrialStatus, isCitationTrialConfigured, type CitationSourceQuota } from "@/lib/citationTrialQuota";

export function useCitationSourceQuota(accountId: string | undefined) {
  const [state, setState] = useState<{ accountId: string; quota: CitationSourceQuota | undefined; error: boolean; referralSourcesEnabled: boolean; referralsGranted: number | null; referralPending: boolean }>();
  const activeAccount = useRef(accountId);
  activeAccount.current = accountId;
  const version = useRef(0);
  const refresh = useCallback(async () => {
    if (!isCitationTrialConfigured || !accountId) return;
    const id = ++version.current;
    try {
      const status = await fetchCitationTrialStatus();
      if (id === version.current && activeAccount.current === accountId) setState({
        accountId, quota: status.enabled && status.limited ? { remaining: status.remaining ?? 0, limit: status.limit, ...(status.referralPending ? { referralPending: true } : {}) } : undefined, error: false,
        referralSourcesEnabled: status.referralSourcesEnabled, referralsGranted: status.referralsGranted, referralPending: status.referralPending,
      });
    } catch {
      if (id === version.current && activeAccount.current === accountId) setState({
        accountId, quota: { remaining: 0, limit: 0, loading: true }, error: true, referralSourcesEnabled: false, referralsGranted: null, referralPending: false,
      });
    }
  }, [accountId]);
  useEffect(() => {
    if (!accountId || !isCitationTrialConfigured) return;
    void refresh();
    const refreshOnChange = () => void refresh();
    window.addEventListener(CITATION_TRIAL_CHANGED, refreshOnChange);
    window.addEventListener("focus", refreshOnChange);
    return () => {
      ++version.current;
      window.removeEventListener(CITATION_TRIAL_CHANGED, refreshOnChange);
      window.removeEventListener("focus", refreshOnChange);
    };
  }, [accountId, refresh]);
  const active = isCitationTrialConfigured && accountId;
  const sourceQuota = !active ? undefined : state?.accountId === accountId ? state.quota : { remaining: 0, limit: 0, loading: true };
  return {
    sourceQuota,
    quotaError: !!(active && state?.accountId === accountId && state.error),
    referralSourcesEnabled: !!(active && state?.accountId === accountId && state.referralSourcesEnabled),
    referralPending: !!(active && state?.accountId === accountId && state.referralPending),
    sourceReferralsGranted: active && state?.accountId === accountId ? state.referralsGranted : null,
    refreshQuota: refresh,
  };
}
