/**
 * Versioned LOCAL persistence for foreign-source classification records.
 * One storage key per account (anonymous separate); records keyed by a
 * stable item key. Old, foreign-version or malformed data is ignored
 * safely. No server schema: classification is a client-side preference.
 */
import { safeStorage } from "@/lib/safeStorage";
import {
  CLASSIFICATION_VERSION,
  detectClassification,
  markGenerated,
  planGeneration,
  reconcileRecord,
  sanitizeOverrides,
  type ClassificationRecord,
  type GenerationPlan,
} from "@/lib/foreignClassification";

const PREFIX = "relex.foreignClassification.v1::";
const MAX_RECORDS = 500;

export const storageKeyFor = (accountId: string | null | undefined) => `${PREFIX}${accountId || "anon"}`;

type Listener = (accountId: string, itemKey: string) => void;
const listeners = new Set<Listener>();
export function subscribeClassification(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
const emit = (accountId: string | null | undefined, itemKey: string) => listeners.forEach((l) => l(accountId || "anon", itemKey));

function reviveRecord(itemKey: string, raw: unknown): ClassificationRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== CLASSIFICATION_VERSION || r.itemKey !== itemKey || typeof r.inputFingerprint !== "string") return null;
  return {
    version: CLASSIFICATION_VERSION,
    itemKey,
    inputFingerprint: r.inputFingerprint,
    // Detection is derived; callers recompute it from the current input.
    detected: { ...detectClassification(""), inputFingerprint: r.inputFingerprint },
    overrides: sanitizeOverrides(r.overrides),
    needsReview: r.needsReview === true,
    generatedWith: typeof r.generatedWith === "string" ? r.generatedWith : null,
    // Records from the first Stage C build lack generatedInput: treat as unknown (stale).
    generatedInput: typeof r.generatedInput === "string" ? r.generatedInput : null,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
  };
}

export function loadAll(accountId: string | null | undefined): Record<string, ClassificationRecord> {
  let parsed: unknown;
  try {
    const raw = safeStorage.getItem(storageKeyFor(accountId));
    if (!raw) return {};
    parsed = JSON.parse(raw);
  } catch { return {}; }
  if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== CLASSIFICATION_VERSION) return {};
  const recs = (parsed as { records?: unknown }).records;
  if (!recs || typeof recs !== "object") return {};
  const out: Record<string, ClassificationRecord> = {};
  for (const [k, v] of Object.entries(recs as Record<string, unknown>)) { const r = reviveRecord(k, v); if (r) out[k] = r; }
  return out;
}

export const loadRecord = (accountId: string | null | undefined, itemKey: string) => loadAll(accountId)[itemKey];

function writeAll(accountId: string | null | undefined, all: Record<string, ClassificationRecord>) {
  const entries = Object.entries(all).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_RECORDS);
  try {
    safeStorage.setItem(storageKeyFor(accountId), JSON.stringify({ version: CLASSIFICATION_VERSION, records: Object.fromEntries(entries) }));
  } catch { /* blocked storage: in-memory only */ }
}

export function saveRecord(accountId: string | null | undefined, rec: ClassificationRecord): void {
  const all = loadAll(accountId);
  all[rec.itemKey] = rec;
  writeAll(accountId, all);
}

/** Generation plan for an explicit action on this item (null → existing behaviour). */
export function planForItem(accountId: string | null | undefined, itemKey: string, input: string): GenerationPlan | null {
  const rec = loadRecord(accountId, itemKey);
  return planGeneration(rec ? reconcileRecord(rec, itemKey, input) : undefined, input);
}

/** Record provenance after a SUCCESSFUL explicit generation that used `plan`. */
export function recordGeneration(accountId: string | null | undefined, plan: GenerationPlan): void {
  const rec = loadRecord(accountId, plan.itemKey);
  if (!rec) return;
  saveRecord(accountId, markGenerated(rec, plan));
  emit(accountId, plan.itemKey);
}

/** Remove records whose key starts with `prefix` (e.g. a cleared chat). */
export function clearItemsWithPrefix(accountId: string | null | undefined, prefix: string): void {
  const all = loadAll(accountId);
  let changed = false;
  for (const k of Object.keys(all)) if (k.startsWith(prefix)) { delete all[k]; changed = true; }
  if (changed) writeAll(accountId, all);
}
