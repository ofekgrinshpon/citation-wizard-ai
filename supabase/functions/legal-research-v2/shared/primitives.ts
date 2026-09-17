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
} from "../vendor/officialFetch.ts";

export { classifyJudgmentUrl } from "../vendor/judgmentUrlEligibility.ts";

// ── Document extraction ────────────────────────────────────────────────────
export { extractPdfPagesBounded } from "../vendor/largePdfChunkedExtract.ts";
export { extractDocumentText } from "../vendor/attachments.ts";

// ── Israeli legal identity normalization ───────────────────────────────────
export {
  assessPrimaryDocumentDocket,
  canonicalDocketIdsOf,
  candidateMatchesDocket,
  detectDockets,
  detectDocketsInDocumentBody,
  normalizeDocketText,
  normalizedDocketId,
  type DocketRef,
  type PrimaryDocketAssessment,
} from "../vendor/docketDetection.ts";

export {
  buildSectionVariants,
  detectStatuteSections,
  normalizeSectionMarker,
  type StatuteSectionRef,
} from "../vendor/statuteSectionDetection.ts";

// ── Hebrew lexical normalization for corpus retrieval ──────────────────────
export { buildHebrewFtsQuery, stripHebrewPrefix } from "../vendor/hebrewFts.ts";

// ── Structured drafter output validation (pure, citation-markup guard) ─────
export {
  validateStructuredDraft,
  type StructuredBlock,
  type StructuredDraft,
} from "../vendor/structuredValidation.ts";

// ── Minimal title hygiene ──────────────────────────────────────────────────
export {
  isBareInstitutionTitle,
  looksLikeFilename,
  recoverDocket,
  recoverStatuteName,
} from "../vendor/displayTitleHygiene.ts";

// ── Hebrew citation formatting rule 1.10 ───────────────────────────────────
export { normalizeHebrewNumberRanges } from "../../_shared/hebrewNumberRange.ts";

// ── Structural client type (no runtime dependency) ─────────────────────────
export type { SupabaseClient } from "../vendor/supabaseClientType.ts";

/** sha256 hex of a string — used for evidence-store content identity. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Decode the common named/numeric HTML entities. */
export function decodeHtmlEntities(input: string): string {
  return (input ?? "")
    .replace(/&#(\d+);/g, (_m, d) => {
      const code = Number(d);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : _m;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : _m;
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Strip HTML to readable text. Deliberately dumb and dependency-free. */
export function htmlToText(html: string): string {
  const out = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return decodeHtmlEntities(out);
}
