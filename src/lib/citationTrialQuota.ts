import { supabase } from "@/integrations/supabase/client";

export const CITATION_TRIAL_LIMIT = 5;
export const TRIAL_SOURCE_LIMIT = "TRIAL_EXHAUSTED";
export const CITATION_TRIAL_CHANGED = "relex:citation-trial-changed";
export const isCitationTrialConfigured = import.meta.env.VITE_CITATION_SOURCE_TRIAL !== "false";

export type CitationSourceQuota = { remaining: number; loading?: boolean };
type TrialQuotaRpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
type TrialStatus = { ok: boolean; enabled: boolean; limited: boolean; remaining: number | null };
const rpc = (name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as TrialQuotaRpc).call(supabase, name, args);

export function parseTrialStatus(value: unknown): TrialStatus | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  if (r.ok !== true || typeof r.enabled !== "boolean" || typeof r.limited !== "boolean") return null;
  if (!r.enabled && r.limited) return null;
  if (r.limited && (typeof r.remaining !== "number" || !Number.isInteger(r.remaining) ||
      r.remaining < 0 || r.remaining > CITATION_TRIAL_LIMIT)) return null;
  return { ok: true, enabled: r.enabled, limited: r.limited, remaining: r.limited ? r.remaining as number : null };
}

export async function fetchCitationTrialStatus(): Promise<TrialStatus> {
  const { data, error } = await rpc("get_citation_trial_status");
  const status = !error && parseTrialStatus(data);
  if (!status) throw new Error("TRIAL_QUOTA_UNAVAILABLE");
  return status;
}

export class CitationTrialQuotaError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export const trialQuotaReachedMessage = "ניצלת את מכסת האזכורים בחינם. לעוד פרטים על מסלולי האזכורים, אפשר לעבור לעמוד החשבון.";
export const trialQuotaUnavailableMessage = "לא הצלחנו לאמת את מכסת האזכורים. נסו לרענן לפני עיבוד מקור חדש.";

export function refreshCitationSourceQuota() {
  if (isCitationTrialConfigured && typeof window !== "undefined") window.dispatchEvent(new Event(CITATION_TRIAL_CHANGED));
}

/**
 * Before delivering a genuinely new deterministic/cache output, account for it
 * without an engine call. Caller supplies one stable id for this attempt.
 * Never called for viewing, copying or exporting an existing result.
 */
export async function accountForLocalCitation(
  requestId: string,
  rawInput: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  if (!isCitationTrialConfigured) return;
  const ensureCurrent = () => {
    if (!isCurrent()) throw new CitationTrialQuotaError("CITATION_RETRY_STALE", "הקלט או החשבון השתנו.");
  };
  ensureCurrent();
  const { data: auth } = await supabase.auth.getSession();
  const accountId = auth.session?.user.id;
  if (!accountId) throw new CitationTrialQuotaError("CITATION_RETRY_STALE", "יש להתחבר כדי לעבד מקור חדש.");
  ensureCurrent();
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawInput.normalize("NFC").trim()));
  const fingerprint = Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, "0")).join("");
  ensureCurrent();
  let result: unknown;
  const applyLocalDebit = async () => {
    const { data, error } = await rpc("consume_local_citation_trial", { _request_id: requestId, _fingerprint: fingerprint, _expected_user: accountId });
    if (error) throw error;
    return data;
  };
  try {
    try { result = await applyLocalDebit(); } catch {
      ensureCurrent();
      result = await applyLocalDebit();
    }
  } catch {
    ensureCurrent();
    throw new CitationTrialQuotaError("TRIAL_LOCAL_OUTCOME_UNKNOWN",
      "לא התקבל אישור לעדכון המכסה. בדקו את המכסה לפני ניסיון נוסף.");
  } finally {
    refreshCitationSourceQuota();
  }
  ensureCurrent();
  const debit = (result ?? {}) as Record<string, unknown>;
  if (debit.ok === true && (debit.limited === false || (debit.limited === true &&
      Number.isInteger(debit.remaining) && Number(debit.remaining) >= 0 && Number(debit.remaining) < CITATION_TRIAL_LIMIT))) return;
  if (debit.error === "CITATION_RETRY_STALE") throw new CitationTrialQuotaError("CITATION_RETRY_STALE", "הקלט או החשבון השתנו.");
  if (debit.error === TRIAL_SOURCE_LIMIT) {
    throw new CitationTrialQuotaError(TRIAL_SOURCE_LIMIT, trialQuotaReachedMessage);
  }
  throw new CitationTrialQuotaError("TRIAL_QUOTA_UNAVAILABLE", trialQuotaUnavailableMessage);
}
