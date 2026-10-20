import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyOverride,
  computeEffective,
  isOutputStale,
  keepAfterInputChange,
  reconcileRecord,
  resetOverrides,
  supportFor,
  type ClassificationOverrides,
  type ClassificationRecord,
} from "@/lib/foreignClassification";
import { loadRecord, saveRecord } from "@/lib/foreignClassificationStore";

/**
 * Local, deterministic classification state for one item. Every action is
 * synchronous and offline: no invoke/fetch/provider call is ever made.
 */
export function useForeignClassification(args: { accountId: string | null | undefined; itemKey: string; input: string; output: string | null }) {
  const { accountId, itemKey, input, output } = args;
  const [rec, setRec] = useState<ClassificationRecord>(() => reconcileRecord(loadRecord(accountId, itemKey), itemKey, input, output));

  // Account/item switch or input/output change: re-read the isolated store.
  useEffect(() => {
    const next = reconcileRecord(loadRecord(accountId, itemKey), itemKey, input, output);
    setRec(next);
    saveRecord(accountId, next);
  }, [accountId, itemKey, input, output]);

  const commit = useCallback((f: (r: ClassificationRecord) => ClassificationRecord) => {
    setRec((prev) => {
      const next = f(prev);
      saveRecord(accountId, next);
      return next;
    });
  }, [accountId]);

  const effective = useMemo(() => computeEffective(rec.detected, rec.overrides), [rec]);
  return {
    record: rec,
    effective,
    support: supportFor(effective),
    stale: isOutputStale(rec),
    setOverride: (patch: ClassificationOverrides) => commit((r) => applyOverride(r, patch)),
    keep: () => commit((r) => keepAfterInputChange(r)),
    reset: () => commit((r) => resetOverrides(r)),
  };
}
