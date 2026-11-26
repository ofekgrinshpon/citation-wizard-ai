import { useCallback, useEffect, useRef, useState } from "react";
import { unexpiredSettledCitationPasses } from "@/lib/citationPassHeader";
import { CITATION_TRIAL_CHANGED } from "@/lib/citationTrialQuota";
import { citationCheckoutReady, citationPassStatus, type CitationPassStatus } from "@/lib/citationPassClient";

export function useCitationCheckoutReady(accountId?: string) {
  const [state, setState] = useState<{ accountId: string | undefined; ready: boolean }>();
  useEffect(() => {
    let active = true;
    void citationCheckoutReady().then(ready => { if (active) setState({ accountId, ready }); }).catch(() => { if (active) setState({ accountId, ready: false }); });
    return () => { active = false; };
  }, [accountId]);
  return state?.accountId === accountId && state?.ready === true;
}

export function useCitationPasses(userId: string | undefined) {
  const [state, setState] = useState<{ userId: string; passes: CitationPassStatus[]; error: boolean }>();
  const [loading, setLoading] = useState(false);
  const scope = useRef({ userId, seq: 0 });
  scope.current.userId = userId;
  const refresh = useCallback(async () => {
    const seq = ++scope.current.seq;
    if (!userId) { setState(undefined); setLoading(false); return; }
    setLoading(true);
    try {
      const passes = await citationPassStatus();
      if (scope.current.userId === userId && scope.current.seq === seq) setState({ userId, passes, error: false });
    } catch {
      if (scope.current.userId === userId && scope.current.seq === seq) setState({ userId, passes: [], error: true });
    } finally {
      if (scope.current.userId === userId && scope.current.seq === seq) setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener(CITATION_TRIAL_CHANGED, onFocus);
    return () => { ++scope.current.seq; window.removeEventListener("focus", onFocus); window.removeEventListener(CITATION_TRIAL_CHANGED, onFocus); };
  }, [refresh]);
  const scoped = state?.userId === userId ? state : undefined;
  useEffect(() => {
    if (!scoped?.passes.some(p => p.status === "pending")) return;
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [scoped, refresh]);
  // Refresh derived labels/counts locally at the next expiry, even if the
  // user never leaves this tab. The same account-scoped response is reused.
  const [, tick] = useState(0);
  const nextExpiry = Math.min(...unexpiredSettledCitationPasses(scoped?.passes ?? []).map(p => Date.parse(p.expiresAt!)));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const remaining = nextExpiry - Date.now();
      if (remaining <= 0) { tick(n => n + 1); return; }
      // A calendar-month pass can outlast the browser's largest timer delay.
      timer = setTimeout(arm, Math.min(remaining, 2_147_483_647));
    };
    arm();
    return () => clearTimeout(timer);
  }, [nextExpiry]);
  return { passes: scoped?.passes ?? [], error: scoped?.error ?? false, resolved: !!scoped, loading, refresh };
}