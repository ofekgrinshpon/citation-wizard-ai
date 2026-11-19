import { supabase } from "@/integrations/supabase/client";
import {
  CitationTrialQuotaError, refreshCitationSourceQuota, TRIAL_SOURCE_LIMIT,
  trialQuotaReachedMessage,
} from "@/lib/citationTrialQuota";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns null only if this canonical-ID operation did not charge and legacy local delivery is safe. */
export async function accountForReferralVerifiedSource(
  requestId: string,
  sourceId: string,
  accountId: string,
  isCurrent: () => boolean,
): Promise<string | null> {
  const ensureCurrent = () => {
    if (!isCurrent()) throw new CitationTrialQuotaError("CITATION_RETRY_STALE", "הקלט או החשבון השתנו.");
  };
  ensureCurrent();
  if (!UUID.test(sourceId)) return null;
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== accountId || !data.session.access_token) {
    throw new CitationTrialQuotaError("CITATION_RETRY_STALE", "הקלט או החשבון השתנו.");
  }
  ensureCurrent();
  try {
    const result = await supabase.functions.invoke("citation-chat", {
      // Bind the request to the session checked above, even if auth changes during dispatch.
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      body: { citationRequestVersion: 3, referralVerifiedSource: { sourceId }, requestId },
    });
    ensureCurrent();
    if (result.error) {
      const ctx = (result.error as { context?: Response }).context;
      const payload = await ctx?.clone().json().catch(() => null);
      ensureCurrent();
      if (ctx?.status === 404 && payload?.error === "REFERRAL_VERIFIED_SOURCE_UNAVAILABLE") return null;
      if (ctx?.status === 402 && payload?.error === TRIAL_SOURCE_LIMIT) {
        throw new CitationTrialQuotaError(TRIAL_SOURCE_LIMIT, trialQuotaReachedMessage);
      }
    } else if (result.data?.requestId === requestId && typeof result.data.content === "string" && result.data.content.trim()) {
      return result.data.content;
    }
  } catch (error) {
    if (error instanceof CitationTrialQuotaError) throw error;
    ensureCurrent();
  } finally {
    refreshCitationSourceQuota();
  }
  throw new CitationTrialQuotaError("REQUEST_OUTCOME_UNKNOWN",
    "לא התקבל אישור לעדכון המכסה. בדקו את המכסה לפני ניסיון נוסף.");
}
