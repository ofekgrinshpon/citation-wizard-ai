import { readScottishIdentity, scottishJudgmentUrl, parseScottishCitation, advanceScottishParagraphs } from "../_shared/citationPure/scottishDecision.ts";
import { readBoundedBody, hasPdfHeader } from "../_shared/pdfExtractionProtocol.ts";
import { extractPdfPagesBounded } from "../_shared/pdfExtractionBoundary.ts";

/** Single exact-neutral acquisition. Candidate discovery and planner wiring are separate. */
export async function acquireScottishRecord(raw: string, candidate: string, deps: {
  fetch?: typeof fetch;
  extract?: typeof extractPdfPagesBounded;
} = {}) {
  const url = scottishJudgmentUrl(candidate);
  const target = parseScottishCitation(raw);
  if (!url || !target) return null;
  const controller = new AbortController();
  const deadlineMs = 8_000;
  const deadlineAt = Date.now() + deadlineMs;
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const response = await (deps.fetch ?? fetch)(url, { redirect: "error", signal: controller.signal });
    if (controller.signal.aborted || response.redirected || !response.ok ||
        (response.url && response.url !== url.href) ||
        !/^application\/pdf(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    const bytes = await readBoundedBody(response.body, 2_000_000, controller.signal);
    if (!hasPdfHeader(bytes)) return null;
    const run = deps.extract ?? extractPdfPagesBounded;
    // One header window for neutral numbers; at most 48 consecutive pages for
    // locators. The same downloaded bytes and deadline bind every window.
    const options = { maxPages: target.paragraph ? 16 : 1,
      maxChars: target.paragraph ? 65_000 : 9_000, deadlineMs, deadlineAt, signal: controller.signal };
    const first = await run(bytes, options);
    const expired = () => controller.signal.aborted || Date.now() >= deadlineAt;
    if (expired() || !first.pages.length || first.pages[0].page !== 1 ||
        first.pages[0].status !== "read" || first.pages[0].truncated) return null;
    const pageOne = first.text.slice(first.pages[0].start, first.pages[0].end);
    const record = readScottishIdentity(url, target.id, pageOne);
    if (!record) return null;
    if (!target.paragraph || target.lastParagraph === null) return record;
    let previous = 0;
    let expectedPage = 1;
    let chunk = first;
    for (let windows = 1; windows <= 3; windows++) {
      if (expired() || chunk.total_pages !== first.total_pages || !chunk.pages.length ||
        !["page_cap_reached", "document_end"].includes(chunk.stopped_reason)) return null;
      for (const page of chunk.pages) {
        if (page.page !== expectedPage++ || page.status !== "read" || page.truncated) return null;
        previous = advanceScottishParagraphs(chunk.text.slice(page.start, page.end), previous, target.lastParagraph);
        if (previous >= target.lastParagraph) return { ...record, paragraph: target.paragraph };
      }
      if (windows === 3 || chunk.stopped_reason === "document_end" || expectedPage > chunk.total_pages) return null;
      chunk = await run(bytes, { ...options, startPage: expectedPage });
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
