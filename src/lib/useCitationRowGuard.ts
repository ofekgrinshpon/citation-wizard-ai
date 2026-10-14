import { useEffect, useMemo, useRef } from "react";

/** Synchronous per-row locks and revision checks; never persists request data. */
export function useCitationRowGuard(scope: string | null) {
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const mounted = useRef(true);
  const revisions = useRef(new Map<string, number>());
  const epoch = useRef(0);
  const jobs = useRef(new Map<string, symbol>());
  useEffect(() => {
    mounted.current = true;
    const activeJobs = jobs.current;
    return () => { mounted.current = false; activeJobs.clear(); };
  }, []);

  return useMemo(() => ({
    invalidate(key?: string) {
      if (key === undefined) { jobs.current.clear(); epoch.current++; }
      else { jobs.current.delete(key); revisions.current.set(key, (revisions.current.get(key) ?? 0) + 1); }
    },
    bind(key: string, action: () => void) {
      const revision = revisions.current.get(key) ?? 0;
      const boundEpoch = epoch.current;
      const boundScope = scopeRef.current;
      return () => {
        if (mounted.current && scopeRef.current === boundScope && epoch.current === boundEpoch &&
          (revisions.current.get(key) ?? 0) === revision) action();
      };
    },
    begin(key: string) {
      if (jobs.current.has(key)) return null;
      const token = Symbol(key);
      const startedScope = scopeRef.current;
      jobs.current.set(key, token);
      const isCurrent = () => mounted.current && scopeRef.current === startedScope && jobs.current.get(key) === token;
      return {
        isCurrent,
        finish() { if (jobs.current.get(key) === token) jobs.current.delete(key); },
      };
    },
  }), []);
}
