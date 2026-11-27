import { parseSingapore, singaporeEvidence } from "../_shared/citationPure/singaporeDecision.ts";
import { chargePageFetch, type CitationBudget } from "../_shared/citationPure/freeformInterpret.ts";
import { readBoundedBody } from "../_shared/pdfExtractionProtocol.ts";

const MAX_BYTES = 2_500_000;

export async function lookupSingapore(input: string, budget: CitationBudget, fetchImpl: typeof fetch) {
  const id = parseSingapore(input);
  if (!id || !chargePageFetch(budget)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const r = await fetchImpl(id.url, { redirect: "error", signal: ctrl.signal, headers: { Accept: "text/html" } });
    const length = r.headers.get("content-length");
    if (!r.ok || r.redirected || (r.url && r.url !== id.url) ||
        !/^text\/html(?:;|$)/i.test(r.headers.get("content-type") ?? "") ||
        (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))) {
      void r.body?.cancel().catch(() => {});
      return null;
    }
    const data = await readBoundedBody(r.body, MAX_BYTES, ctrl.signal);
    return ctrl.signal.aborted ? null : singaporeEvidence(input, id.url, new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch { return null; }
  finally { clearTimeout(timer); }
}
