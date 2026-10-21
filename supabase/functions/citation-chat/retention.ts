import { citationRecoveryResult, recoveryObject, type CitationRecoveryResult } from "../_shared/citationRecovery.ts";

/** Trusted handler boundary only. The lookup's additive snippet is not retained;
 * every other key/value still passes the unchanged strict recovery validator.
 * Do not use this projection on stored envelopes or untrusted provider payloads. */
export function retainCitationChatResult(body: unknown): CitationRecoveryResult | null {
  if (!recoveryObject(body) || !recoveryObject(body.foreignLookup) ||
      !["book", "book_chapter"].includes(String(body.foreignLookup.kind))) return citationRecoveryResult(body);
  const foreign = body.foreignLookup;
  if (!Array.isArray(foreign.sources)) return null;
  const sources = [];
  for (const source of foreign.sources) {
    if (!recoveryObject(source) ||
        Object.keys(source).some(key => !["url", "title", "tier", "snippet"].includes(key)) ||
        ("snippet" in source && typeof source.snippet !== "string")) return null;
    sources.push({ url: source.url, ...( "title" in source ? { title: source.title } : {}), tier: source.tier });
  }
  return citationRecoveryResult({ ...body, foreignLookup: { ...foreign, sources } });
}