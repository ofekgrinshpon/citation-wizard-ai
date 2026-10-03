/** Fixed-fixture diagnostics, reachable only after the existing smoke auth gate. */
import { extractPdfPagesBounded } from "./pdfExtractionBoundary.ts";
declare const Deno: { env: { get(key: string): string | undefined } };

const FIXTURE_TEXT = "ReLex PDF boundary check";
/** Small valid ASCII PDF. No uploads, private data, external URLs or model calls. */
export function pdfBoundaryFixture(): Uint8Array {
  const stream = `BT /F1 12 Tf 72 700 Td (${FIXTURE_TEXT}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

type Check = { check: string; ok: boolean; http_status?: number; error?: string };
export async function runPdfBoundaryCheck(deps: {
  extract?: typeof extractPdfPagesBounded;
  fetch?: typeof fetch;
  env?: (key: string) => string | undefined;
} = {}): Promise<{ ok: boolean; check_version: 1; checks: Check[] }> {
  const extract = deps.extract ?? extractPdfPagesBounded;
  const fetchOnce = deps.fetch ?? fetch;
  const base = (deps.env ?? ((key) => Deno.env.get(key)))("SUPABASE_URL");
  const checks: Check[] = [];
  if (!base) return { ok: false, check_version: 1, checks: [{ check: "configuration", ok: false, error: "backend_not_configured" }] };
  const deadlineAt = Date.now() + 30_000;
  const url = new URL("/functions/v1/research-pdf-extract", base);
  const fixture = pdfBoundaryFixture();
  const bounds = { maxPages: 1, maxChars: 1_000, deadlineMs: 12_000, deadlineAt };
  const safeError = (error: unknown) => error instanceof Error && /^pdf_boundary_[a-z0-9_]+$/.test(error.message)
    ? error.message : "boundary_check_failed";

  // Negative authentication probes carry no real credential. The real positive
  // call below uses the production client with its runtime-bound service key.
  for (const mode of ["unauthenticated", "invalid_auth"] as const) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(0, Math.min(5_000, deadlineAt - Date.now())));
    try {
      const response = await fetchOnce(url, { method: "POST", signal: controller.signal,
        headers: mode === "invalid_auth" ? { Authorization: "Bearer invalid-synthetic-token" } : {},
      });
      void response.body?.cancel().catch(() => {});
      const ok = response.status === 401 || response.status === 403;
      checks.push({ check: mode, ok, http_status: response.status });
      if (!ok) return { ok: false, check_version: 1, checks };
    } catch (error) {
      checks.push({ check: mode, ok: false, error: safeError(error) });
      return { ok: false, check_version: 1, checks };
    } finally { clearTimeout(timeout); controller.abort(); }
  }
  try {
    const result = await extract(fixture, bounds);
    const ok = result.text === FIXTURE_TEXT && result.total_pages === 1 && result.pages_extracted === 1 &&
      result.pages[0]?.page === 1 && result.pages[0]?.status === "read" && result.stopped_reason === "document_end";
    checks.push({ check: "authenticated_real_pdf", ok });
    if (!ok) return { ok: false, check_version: 1, checks };
  } catch (error) {
    checks.push({ check: "authenticated_real_pdf", ok: false, error: safeError(error) });
    return { ok: false, check_version: 1, checks };
  }
  // Valid PDF header with malformed content must reach the remote parser; a
  // mere client-side magic-header rejection would not test the hosted boundary.
  try {
    await extract(new TextEncoder().encode("%PDF-1.7\ninvalid objects\n%%EOF"), bounds);
    checks.push({ check: "malformed_pdf_rejected", ok: false, error: "unexpected_success" });
    return { ok: false, check_version: 1, checks };
  } catch (error) {
    const message = safeError(error);
    const ok = message === "pdf_boundary_worker_http_422";
    checks.push({ check: "malformed_pdf_rejected", ok, ...(ok ? {} : { error: message }) });
    if (!ok) return { ok: false, check_version: 1, checks };
  }
  // A second real call proves this SAME parent invocation survived the parser
  // failure. No database write, research row, provider invocation or pin change.
  try {
    const result = await extract(pdfBoundaryFixture(), bounds);
    const ok = result.text === FIXTURE_TEXT && result.total_pages === 1;
    checks.push({ check: "caller_survives_parser_failure", ok });
  } catch (error) {
    checks.push({ check: "caller_survives_parser_failure", ok: false, error: safeError(error) });
  }
  return { ok: checks.every((check) => check.ok), check_version: 1, checks };
}
