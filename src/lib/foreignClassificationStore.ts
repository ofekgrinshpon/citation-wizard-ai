/**
 * Versioned LOCAL persistence for foreign-source classification records.
 * One storage key per account (anonymous separate); records keyed by item.
 * Old, foreign-version or malformed data is ignored safely, never thrown.
 * No server schema: classification is a client-side preference.
 */
import { safeStorage } from "@/lib/safeStorage";
import {
  CLASSIFICATION_VERSION,
  detectClassification,
  sanitizeOverrides,
  type ClassificationRecord,
} from "@/lib/foreignClassification";

const PREFIX = "relex.foreignClassification.v1::";
const MAX_RECORDS = 500;

export const storageKeyFor = (accountId: string | null | undefined) => `${PREFIX}${accountId || "anon"}`;

interface Envelope { version: number; records: Record<string, ClassificationRecord> }

function reviveRecord(itemKey: string, raw: unknown): ClassificationRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== CLASSIFICATION_VERSION || r.itemKey !== itemKey) return null;
  if (typeof r.inputFingerprint !== "string") return null;
  const det = r.detected as Record<string, unknown> | undefined;
  // Detected data is derived; rebuild only if shape is sane, otherwise drop record.
  if (!det || det.version !== CLASSIFICATION_VERSION || typeof det.inputFingerprint !== "string") return null;
  return {
    version: CLASSIFICATION_VERSION,
    itemKey,
    inputFingerprint: r.inputFingerprint,
    detected: { ...detectClassification(""), ...(det as object) } as ClassificationRecord["detected"],
    overrides: sanitizeOverrides(r.overrides),
    needsReview: r.needsReview === true,
    generatedWith: typeof r.generatedWith === "string" ? r.generatedWith : null,
    outputFingerprint: typeof r.outputFingerprint === "string" ? r.outputFingerprint : null,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
  };
}

export function loadAll(accountId: string | null | undefined): Record<string, ClassificationRecord> {
  let parsed: unknown;
  try {
    const raw = safeStorage.getItem(storageKeyFor(accountId));
    if (!raw) return {};
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || (parsed as Envelope).version !== CLASSIFICATION_VERSION) return {};
  const recs = (parsed as Envelope).records;
  if (!recs || typeof recs !== "object") return {};
  const out: Record<string, ClassificationRecord> = {};
  for (const [k, v] of Object.entries(recs)) {
    const r = reviveRecord(k, v);
    if (r) out[k] = r;
  }
  return out;
}

export function loadRecord(accountId: string | null | undefined, itemKey: string): ClassificationRecord | undefined {
  return loadAll(accountId)[itemKey];
}

export function saveRecord(accountId: string | null | undefined, rec: ClassificationRecord): void {
  const all = loadAll(accountId);
  all[rec.itemKey] = rec;
  const entries = Object.entries(all).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_RECORDS);
  try {
    safeStorage.setItem(storageKeyFor(accountId), JSON.stringify({ version: CLASSIFICATION_VERSION, records: Object.fromEntries(entries) }));
  } catch {
    /* quota / blocked storage: classification stays in memory only */
  }
}
