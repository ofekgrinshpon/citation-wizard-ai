import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyOverride,
  computeEffective,
  isOutputStale,
  keepAfterInputChange,
  planGeneration,
  reconcileRecord,
  resetOverrides,
  supportFor,
  type ClassificationOverrides,
  type ClassificationRecord,
} from "@/lib/foreignClassification";
import { loadRecord, saveRecord, subscribeClassification } from "@/lib/foreignClassificationStore";

/**
 * Local, deterministic classification state for one item. Every action is
 * synchronous and offline: no invoke/fetch/provider call is ever made.
 */
export function useForeignClassification(args: { accountId: string | null | undefined; itemKey: string; input: string }) {
  const { accountId, itemKey, input } = args;
  const [rec, setRec] = useState<ClassificationRecord>(() => reconcileRecord(loadRecord(accountId, itemKey), itemKey, input));

  useEffect(() => {
    const next = reconcileRecord(loadRecord(accountId, itemKey), itemKey, input);
    setRec(next);
    saveRecord(accountId, next);
  }, [accountId, itemKey, input]);

  // A host's explicit generation recorded provenance: re-read.
  useEffect(() => subscribeClassification((acct, key) => {
    if (acct === (accountId || "anon") && key === itemKey) setRec(reconcileRecord(loadRecord(accountId, itemKey), itemKey, input));
  }), [accountId, itemKey, input]);

  const commit = useCallback((f: (r: ClassificationRecord) => ClassificationRecord) => {
    setRec((prev) => { const next = f(prev); saveRecord(accountId, next); return next; });
  }, [accountId]);

  const effective = useMemo(() => computeEffective(rec.detected, rec.overrides), [rec]);
  return {
    record: rec,
    effective,
    support: supportFor(effective),
    stale: isOutputStale(rec),
    plan: planGeneration(rec, input),
    setOverride: (patch: ClassificationOverrides) => commit((r) => applyOverride(r, patch)),
    keep: () => commit((r) => keepAfterInputChange(r)),
    reset: () => commit((r) => resetOverrides(r)),
  };
}
