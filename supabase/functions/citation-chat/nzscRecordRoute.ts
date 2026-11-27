import { nzscJudgmentUrl, parseNzscCover } from "../_shared/citationPure/nzscDecision.ts";
import { hasPdfHeader, readBoundedBody } from "../_shared/pdfExtractionProtocol.ts";
import { extractPdfPagesBounded } from "../_shared/pdfExtractionBoundary.ts";

/** One official PDF, first page only. Unread or truncated covers never verify. */
export async function acquireNzscDecision(input: string, deps: {
  fetch?: typeof fetch;
  extract?: typeof extractPdfPagesBounded;
} = {}) {
  const url = nzscJudgmentUrl(input);
  if (!url) return null;
  const controller = new AbortController();
  const deadlineMs = 8_000;
  const deadlineAt = Date.now() + deadlineMs;
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const response = await (deps.fetch ?? fetch)(url, { redirect: "error", signal: controller.signal });
    if (!response.ok || response.redirected || (response.url && response.url !== url) ||
        !/^application\/pdf(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    const bytes = await readBoundedBody(response.body, 2_000_000, controller.signal);
    if (!hasPdfHeader(bytes)) return null;
    const document = await (deps.extract ?? extractPdfPagesBounded)(bytes, {
      maxPages: 1, maxChars: 9_000, deadlineMs, deadlineAt, signal: controller.signal,
    });
    const [cover] = document.pages;
    if (controller.signal.aborted || Date.now() >= deadlineAt ||
        !cover || cover.page !== 1 || cover.status !== "read" || cover.truncated) return null;
    return parseNzscCover(input, url, document.text.slice(cover.start, cover.end));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
