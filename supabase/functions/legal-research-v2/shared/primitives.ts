/**
 * legal-research-v2 — the ONLY place where V2 touches pre-existing code.
 *
 * Every re-export below is a low-level primitive that passes the clean-sheet
 * test: "if V1 had never existed, would V2 still need this?". None of them
 * carries V1 orchestration (no pools, ranking, roles, modes, rescue stages);
 * the import boundary test (`src/test/legalResearchV2Boundary.test.ts`)
 * enforces that transitively.
 */

// ── HTTP profiles / egress / block-page signatures ─────────────────────────
export {
  hostOf,
  isOfficialHost,
  looksLikeBlockPage,
  officialFetch,
} from "../../legal-research-v1/lib/officialFetch.ts";

export { classifyJudgmentUrl } from "../../legal-research-v1/lib/judgmentUrlEligibility.ts";

// ── Document extraction ────────────────────────────────────────────────────
export { extractPdfPagesBounded } from "../../legal-research-v1/lib/largePdfChunkedExtract.ts";
export { extractDocumentText } from "../../legal-research-v1/lib/attachments.ts";

// ── Israeli legal identity normalization ───────────────────────────────────
export {
  candidateMatchesDocket,
  detectDockets,
  normalizeDocketText,
  type DocketRef,
} from "../../legal-research-v1/stages/docketDetection.ts";

export {
  buildSectionVariants,
  detectStatuteSections,
  normalizeSectionMarker,
  type StatuteSectionRef,
} from "../../legal-research-v1/stages/statuteSectionDetection.ts";

// ── Hebrew lexical normalization for corpus retrieval ──────────────────────
export { buildHebrewFtsQuery, stripHebrewPrefix } from "../../legal-research-v1/stages/hebrewFts.ts";

// ── Structured drafter output validation (pure, citation-markup guard) ─────
export {
  validateStructuredDraft,
  type StructuredBlock,
  type StructuredDraft,
} from "../../legal-research-v1/stages/structuredValidation.ts";

// ── Minimal title hygiene ──────────────────────────────────────────────────
export {
  isBareInstitutionTitle,
  looksLikeFilename,
  recoverDocket,
  recoverStatuteName,
} from "../../legal-research-v1/stages/displayTitleHygiene.ts";

// ── Hebrew citation formatting rule 1.10 ───────────────────────────────────
export { normalizeHebrewNumberRanges } from "../../_shared/hebrewNumberRange.ts";

// ── Structural client type (no runtime dependency) ─────────────────────────
export type { SupabaseClient } from "../../legal-research-v1/lib/supabaseClientType.ts";

/** sha256 hex of a string — used for evidence-store content identity. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Strip HTML to readable text. Deliberately dumb and dependency-free. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
