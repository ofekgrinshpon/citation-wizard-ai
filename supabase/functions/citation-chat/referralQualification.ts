/** A referral reward requires an actual usable citation, not just HTTP/ledger success.
 * Free-form model replies use conservative positive shapes. Typed paths pass their
 * existing authoritative completeness decisions after request/result binding.
 */
export function cleanSingleCitation(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 10 || text.length > 1500 || /[\r\n\u0000-\u001f\u007f-\u009f]/u.test(text) ||
      /⚠|\[\s*(?:חסר|missing)|\?\s*\.?$|^\s*\d+[.)]\s|^(?:לא\s|אין\s|נמצא(?:ו)?\s|מצאתי\s|הקלט\s|נדרש(?:ת)?\s|נא\s|בחרו?\s|sorry\b|no\s)/iu.test(text)) return null;
  // Presentation markers have no bearing on completeness.
  return text.replace(/\*\*|##|\^\^/g, "");
}

const HEBREW_CASE = /^[א-ת]{1,5}["״'׳]?[א-ת]{0,5}\s*(?:\([^()\d]{1,60}\)\s*)?\d[\d-]*\/\d{2,4}\s+[^\d,]{2,180}?\s+נ['׳]\s+[^,]{2,180}?\s*(?:,\s*)?.{0,210}$/u;
const CASE_LOCATION = /(?:פ["״]ד\s+[א-ת]+(?:\(\d+\))?\s+\d+\b.+\((?:18|19|20)\d{2}\)|\((?:[^()]*(?:נבו|תקדין|פדאור|פסקדין|אר["״]ש|דינים)[^()]*?)?\d{1,2}[./]\d{1,2}[./](?:18|19|20)\d{2}\))/u;
const HEBREW_LAW = /^(?:סעיף\s+[^,]{1,45}\s+(?:ל|ב))?(?:חוק(?:[-־ ]יסוד)?[:\s]|תקנות\s|פקודת\s|צו\s)[א-ת][^\n]{5,180}(?:[-־]\s*(?:18|19|20)\d{2}|\b(?:18|19|20)\d{2}\b)\s*\.?$/u;
const FOREIGN_CASE = /^[^,]{2,140}\s+v\.?\s+[^,]{2,140},\s*\d+\s+(?:U\.\s*S\.|S\.\s*Ct\.|F\.(?:\s*(?:2d|3d|4th)|\s*Supp\.(?:\s*(?:2d|3d))?)|L\.\s*Ed\.)\s+\d+[^\n]*\((?:[^()]*)\b(?:18|19|20)\d{2}\)\.?$/iu;

/** No general natural-language success guess. Additional forms may be added
 * only with a dedicated, positively validated citation shape. */
export function completeLegacyReferralCitation(content: unknown): boolean {
  const text = cleanSingleCitation(content);
  if (!text) return false;
  return (HEBREW_CASE.test(text) && CASE_LOCATION.test(text)) || HEBREW_LAW.test(text) || FOREIGN_CASE.test(text);
}

/** Verified-store entries are curated and may span more than the positive
 * free-text allowlist. They still may not be blank, a prompt or a menu. */
export function usableVerifiedReferralCitation(content: unknown): content is string {
  const text = cleanSingleCitation(content);
  return !!text && /[\p{L}]/u.test(text) && /\d/.test(text) && /(?:\.|\))$/.test(text) &&
    !/\b(?:choose|which one|not found|could not)\b|חסרים פרטים|נמצאו מספר|לא אומת/u.test(text);
}

export function parseReferralVerifiedSourceBody(body: Record<string, unknown>): { sourceId: string; requestId: string } | null {
  const proposed = body.referralVerifiedSource;
  if (body.citationRequestVersion !== 3 ||
      Object.keys(body).some(key => !["citationRequestVersion", "requestId", "referralVerifiedSource", "telemetryRequestId", "telemetryBatchId", "projectId"].includes(key)) ||
      !proposed || typeof proposed !== "object" || Array.isArray(proposed) || Object.keys(proposed).length !== 1) return null;
  const sourceId = (proposed as Record<string, unknown>).sourceId;
  const id = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (typeof body.requestId !== "string" || !id.test(body.requestId) || typeof sourceId !== "string" || !id.test(sourceId)) return null;
  return { sourceId: sourceId.toLowerCase(), requestId: body.requestId.toLowerCase() };
}

/** Injectable boundary: source retrieval occurs before any debit, and only the
 * server-supplied, complete record is delivered. SQL owns all grant idempotency. */
export async function deliverVerifiedReferralCitation(args: {
  fetchSource: () => PromiseLike<{ data: { full_citation: unknown; source_type: unknown } | null; error: unknown }>;
  debit: () => PromiseLike<{ data: { ok?: boolean; error?: string } | null; error: unknown }>;
  confirm: () => Promise<boolean>;
}): Promise<
  { ok: true; content: string; sourceType: string | null; referralBonusGranted: boolean } |
  { ok: false; code: string; status: number }
> {
  try {
    const { data: source, error: readError } = await args.fetchSource();
    if (readError) return { ok: false, code: "REQUEST_OUTCOME_UNKNOWN", status: 503 };
    if (!source || !usableVerifiedReferralCitation(source.full_citation))
      return { ok: false, code: "REFERRAL_VERIFIED_SOURCE_UNAVAILABLE", status: 404 };
    const { data: debit, error: debitError } = await args.debit();
    if (debitError || debit?.ok !== true) {
      if (!debitError && debit?.error === "TRIAL_EXHAUSTED") return { ok: false, code: debit.error, status: 402 };
      if (!debitError && (debit?.error === "REQUEST_FINGERPRINT_MISMATCH" || debit?.error === "REQUEST_ID_ALREADY_USED"))
        return { ok: false, code: debit.error, status: 409 };
      return { ok: false, code: "REQUEST_OUTCOME_UNKNOWN", status: 503 };
    }
    const referralBonusGranted = await args.confirm().catch(() => false);
    return { ok: true, content: source.full_citation,
      sourceType: typeof source.source_type === "string" ? source.source_type : null, referralBonusGranted };
  } catch { return { ok: false, code: "REQUEST_OUTCOME_UNKNOWN", status: 503 }; }
}
