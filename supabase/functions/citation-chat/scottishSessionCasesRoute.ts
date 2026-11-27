import { readSessionCasesIndex, sessionCasesSearchUrl, SCLR_HTML_LIMIT, type SessionCasesResult } from "../_shared/citationPure/scottishSessionCases.ts";
import { readBoundedBody } from "../_shared/pdfExtractionProtocol.ts";
import { chargePageFetch, type CitationBudget } from "../_shared/citationPure/freeformInterpret.ts";

/** Separate official-index lookup. Never increases the main citation retrieval cap.
 * Only called for requests that explicitly name Session Cases. */
export async function lookupSessionCases(id: string, budget: CitationBudget, fetcher: typeof fetch = fetch): Promise<SessionCasesResult> {
  const url = sessionCasesSearchUrl(id);
  if (!url || !chargePageFetch(budget)) return { state: "unverified" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(url, { redirect: "error", signal: controller.signal });
    if (!response.ok || response.redirected || (response.url && response.url !== url.href) ||
      !/^text\/html(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
      void response.body?.cancel().catch(() => {});
      return { state: "unverified" };
    }
    const bytes = await readBoundedBody(response.body, SCLR_HTML_LIMIT, controller.signal);
    return controller.signal.aborted ? { state: "unverified" } : readSessionCasesIndex(new TextDecoder("utf-8",{fatal:true}).decode(bytes), id);
  } catch {
    return { state: "unverified" };
  } finally {
    clearTimeout(timer);
  }
}
