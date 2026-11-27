import { confirmIescRecord, findExactRecord, searchUrl } from "../_shared/citationPure/iescDecision.ts";
import { chargePageFetch, chargeSearch, type CitationBudget } from "../_shared/citationPure/freeformInterpret.ts";
import { readBoundedBody } from "../_shared/pdfExtractionProtocol.ts";

export async function lookupIesc(input: string, budget: CitationBudget, fetchImpl: typeof fetch) {
  const start = searchUrl(input);
  if (!start || !chargeSearch(budget)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  const html = async (url: string, max: number) => {
    const r = await fetchImpl(url, { redirect: "error", signal: ctrl.signal, headers: { Accept: "text/html" } });
    if (!r.ok || r.redirected || (r.url && r.url !== url) || !/^text\/html(?:;|$)/i.test(r.headers.get("content-type") ?? "")) {
      void r.body?.cancel().catch(() => {});
      return "";
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(r.body, max, ctrl.signal));
  };
  try {
    const row = findExactRecord(input, await html(start, 800_000));
    if (!row || ctrl.signal.aborted || !chargePageFetch(budget)) return null;
    const document = await html(row.url, 400_000);
    return ctrl.signal.aborted ? null : confirmIescRecord(row, document);
  } catch { return null; }
  finally { clearTimeout(timer); }
}
