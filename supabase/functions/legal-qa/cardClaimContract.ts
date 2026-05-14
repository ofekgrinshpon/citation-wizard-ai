/**
 * Card→Claim Citation Contract (Phase 6).
 *
 * Introduces an explicit contract where the drafter cites SOURCE-CARD IDs
 * (`[cite:S3]` / `[cite:S1,S3]`) instead of free-form citation strings, and
 * final footnotes are built DETERMINISTICALLY from sourcePack metadata.
 *
 * Architecture:
 *   - Stable IDs `S1, S2, ...` assigned in display order to every source card.
 *   - `deriveCanonicalCitation` REUSES the existing ReLex citation engine
 *     (`_shared/citationResolver`, `_shared/articleCitationValidator`,
 *     `_shared/chapterCitationRouter`, `_shared/citationEngine`).
 *     The ONLY new formatter here is a tiny last-resort minimal stringifier
 *     that runs solely when the engine cannot resolve at all.
 *   - `parseMarkers` extracts `[cite:S#]` markers from the drafter body.
 *   - `buildFootnotes` walks markers in body order, emits one footnote per
 *     first occurrence, anchored by the marker itself.
 *
 * Backward compatibility:
 *   - When NO markers are found the caller falls back to the legacy AI-footnote
 *     pipeline. This module never removes that path.
 *   - Existing post-process validators (Rule 8.3 cleanup, legislation year
 *     completeness, Rule 37, anchor enforcement, filter pipeline) run on the
 *     deterministic output unchanged.
 */

import {
  CITATION_RULES,
} from "../_shared/citationEngine.ts";
import {
  resolveCitation,
  type ResolveResult,
} from "../_shared/citationResolver.ts";
import { validateArticleCitation } from "../_shared/articleCitationValidator.ts";
import {
  classifyChapterFootnoteWithReason,
  type FootnoteSourceType,
} from "../_shared/chapterCitationRouter.ts";
import { scoreCitationQuality } from "./citationQualityScorer.ts";
import type { CitationQuality } from "./contracts.ts";

// ─── Public types ────────────────────────────────────────────────────

/** A source card as understood by this module. Mirrors the SourceCard shape
 *  used in legal-qa/index.ts but typed minimally so the contract can run in
 *  isolation in tests. */
export interface ContractSourceCard {
  /** Numeric internal ID (from SourceCard.id). */
  id: number;
  /** Stable Card-Claim ID, e.g. "S3". Assigned by `assignContractIds`. */
  contractId?: string;
  citation: string;
  source_type: string;
  url?: string;
  provenance: "local" | "perplexity" | "perplexity_completion" | "document";
  excerpt?: string;
  case_number?: string;
  /** Phase 6.6 — structured fields plumbed in from SourceCard so the engine
   *  can fill the rule template instead of reusing the seed string. */
  docket_prefix?: string;
  procedure_category?: string;
  court?: string;
  decision_date?: string;
  /** Set by `attachCanonicalCitations`; the deterministic citation string. */
  canonicalCitation?: string;
  /** Telemetry: which formatter produced canonicalCitation. */
  canonicalFormatter?: CanonicalFormatter;
  /** Telemetry: required engine fields not satisfied for this card's type. */
  canonicalMissingFields?: string[];
  /** Telemetry: when engine attempted but failed; the resolver reason. */
  canonicalResolverReason?: string;
  /** Phase 6.6 — quality of the FINAL canonicalCitation (not the raw seed). */
  citationQuality?: CitationQuality;
  /** Phase 6.6 — true when canonicalCitation contains [חסר: ...] markers. */
  canonicalHasPlaceholders?: boolean;
}

export type CanonicalFormatter =
  | "reused_existing_strong"
  | "engine_resolved"
  | "engine_template_filled_with_placeholders"
  | "engine_unresolved_then_fallback"
  | "fallback_minimal"
  | "fallback_weak_title_refused";

export interface ParsedMarker {
  /** Raw marker text, e.g. `[cite:S1,S3]`. */
  raw: string;
  /** Source IDs referenced (pre-validation). */
  sourceIds: string[];
  /** Source IDs that exist in the pack. */
  validSourceIds: string[];
  /** Source IDs referenced but not in the pack. */
  invalidSourceIds: string[];
  /** Character offset in the body where the marker starts. */
  position: number;
  /** ~120 chars of body text immediately before the marker, sentence-trimmed. */
  surroundingClaim: string;
}

export interface ParseMarkersResult {
  markers: ParsedMarker[];
  /** Distinct valid source IDs seen across all markers (in first-seen order). */
  uniqueValidSourceIds: string[];
  /** Distinct invalid source IDs (in first-seen order). */
  invalidSourceIds: string[];
}

export interface ContractFootnote {
  number: number;
  citation: string;
  source_type: string;
  url?: string;
  source: ContractSourceCard["provenance"];
  source_id: string;
  /** True when canonicalCitation contains `[חסר: ...]` placeholders. */
  has_missing_markers: boolean;
}

export interface BuildFootnotesResult {
  /** Updated body with `[cite:S#]` markers replaced by superscripts. */
  body: string;
  /** Final deterministic footnote list. */
  footnotes: ContractFootnote[];
  /** Per-card formatter usage tally. */
  formatterUsage: FormatterUsageCounts;
  /** Per-source missing-required-field telemetry. */
  missingMetadata: Array<{ source_id: string; missing_fields: string[] }>;
  /** Map of source_id → number of times referenced in body. */
  sourceIdUsage: Record<string, number>;
  /** Resolver failures — engine was attempted but returned unresolved. */
  resolverFailures: Array<{
    source_id: string;
    source_type: string;
    reason: string;
    missing_fields: string[];
  }>;
}

export interface FormatterUsageCounts {
  reused_existing_strong: number;
  engine_resolved: number;
  engine_template_filled_with_placeholders: number;
  engine_unresolved_then_fallback: number;
  fallback_minimal: number;
  fallback_weak_title_refused: number;
}

export interface CitationAssemblyTelemetry {
  total: number;
  source_type_normalized: number;
  engine_first_attempted: number;
  seed_reuse_rejected: number;
  template_filled: number;
  placeholder_inserted: number;
  missing_fields_counts: Record<string, number>;
  reused_existing_strong: number;
  fallback_used: number;
  examples: Array<{
    source_id: string;
    source_type: string;
    formatter: CanonicalFormatter;
    canonical: string;
    missing_fields: string[];
  }>;
}

export interface CardClaimContractTelemetry {
  used: boolean;
  legacy_fallback: boolean;
  reason?:
    | "no_cite_markers_found"
    | "all_invalid_ids"
    | "drafter_wiring_pending"
    | "mode_off"
    | null;
  markers_found: number;
  unique_source_ids_used: number;
  invalid_source_ids: string[];
  claims_with_sources: number;
  generated_footnotes: number;
  missing_metadata: Array<{ source_id: string; missing_fields: string[] }>;
  source_id_usage: Record<string, number>;
  formatter_usage: FormatterUsageCounts;
  citation_assembly?: CitationAssemblyTelemetry;
  resolver_failures: Array<{
    source_id: string;
    source_type: string;
    reason: string;
    missing_fields: string[];
  }>;
}

export const EMPTY_TELEMETRY: CardClaimContractTelemetry = {
  used: false,
  legacy_fallback: false,
  reason: null,
  markers_found: 0,
  unique_source_ids_used: 0,
  invalid_source_ids: [],
  claims_with_sources: 0,
  generated_footnotes: 0,
  missing_metadata: [],
  source_id_usage: {},
  formatter_usage: {
    reused_existing_strong: 0,
    engine_resolved: 0,
    engine_template_filled_with_placeholders: 0,
    engine_unresolved_then_fallback: 0,
    fallback_minimal: 0,
    fallback_weak_title_refused: 0,
  },
  resolver_failures: [],
};

// ─── Stable ID assignment ────────────────────────────────────────────

/** Assign stable `S1, S2, ...` IDs in pack display order. Mutates cards. */
export function assignContractIds(cards: ContractSourceCard[]): void {
  cards.forEach((c, i) => {
    c.contractId = `S${i + 1}`;
  });
}

// ─── Canonical citation derivation (engine-first) ────────────────────
//
// Phase 6.6: the upstream `card.citation` is treated as a HINT for structured
// extraction, not as the final canonical citation. For caselaw and statute
// types we always run the engine path first; only when the engine fails AND
// the seed scores `strong` quality do we reuse it. Missing required fields
// are template-filled with `[חסר: …]` placeholders.

/** Source-type normalization: Hebrew display labels → engine routing key. */
function normalizeSourceTypeKey(raw: string): string {
  const t = (raw || "").trim().toLowerCase();
  // Hebrew display labels used throughout index.ts
  if (t === "פסיקה") return "caselaw";
  if (t === "חקיקה ישראלית") return "primary_legislation";
  if (t === "מחקר כנסת / חקיקה" || t === "מחקר כנסת" || t === "חקיקה / מחקר כנסת") {
    return "knesset_research";
  }
  if (t === "מאמר אקדמי") return "journal_article";
  if (t === "פרוטוקול" || t === "פרוטוקולים") return "protocol";
  return t;
}

/** Map a (normalized) source_type to the chapter-citation router family. */
function mapToFootnoteType(card: ContractSourceCard): FootnoteSourceType {
  const t = normalizeSourceTypeKey(card.source_type);
  if (t === "caselaw" || t === "case_law" ||
      t === "supreme_court" || t === "district_court" ||
      t === "labor_court" || t === "family_court" ||
      t === "case_law_database" || t === "case_law_published") {
    return "caselaw";
  }
  if (t === "israeli_law" || t === "primary_legislation" ||
      t === "basic_law" || t === "secondary_legislation" ||
      t === "regulation" || t === "regulations" ||
      t === "ordinance" || t === "legislation" ||
      t === "legislation_primary" || t === "legislation_secondary") {
    return "statute";
  }
  if (t === "journal_article" || t === "article") return "journal_article";
  if (t === "academic_book" || t === "book") return "book";
  if (t === "book_chapter") return "book_chapter";
  if (t === "knesset_research" || t === "report" || t === "protocol") return "report";
  if (t === "external_web" || t === "web_source" || t === "web" || t === "document") return "web_source";
  return "unknown";
}

/** Engine source-type key for `validateCitation`/`getRequiredFields`. */
function mapToEngineKey(card: ContractSourceCard): string | null {
  const t = normalizeSourceTypeKey(card.source_type);
  if (t === "caselaw" || t === "case_law" || t === "case_law_database" ||
      t === "supreme_court" || t === "district_court" ||
      t === "labor_court" || t === "family_court") return "case_law_database";
  if (t === "case_law_published") return "case_law_published";
  if (t === "basic_law") return "basic_law";
  if (t === "secondary_legislation" || t === "regulation" || t === "regulations" ||
      t === "ordinance") return "secondary_legislation";
  if (t === "primary_legislation" || t === "israeli_law" || t === "legislation" ||
      t === "legislation_primary") return "primary_legislation";
  if (t === "journal_article" || t === "article") {
    return "academic_article" in CITATION_RULES ? "academic_article" : "journal_article";
  }
  return null;
}

// ── Procedure-category → caseType / court name dictionaries ──────────
//
// `meta.procedure_type` on local DB rows is mixed: a small number of rows
// hold a true docket prefix (`בג"ץ`, `ע"א`, …) and the rest hold a broad
// subject category (`משפחה`, `שלום`, `מחוזי`, `עבודה`, …). We use the
// category as a LAST-RESORT caseType inference and as a court-name fill-in
// for the parens block when database/fullDate are missing.
const CATEGORY_TO_CASE_TYPE: Record<string, string> = {
  "משפחה": "תמ״ש",
  "עבודה": "סע״ש",
  "עבודה ארצי": "ע״ע",
  "פלילי": "ת״פ",
  "אזרחי": "ת״א",
  "מנהלי": "עת״מ",
  "תעבורה": "ת״ת",
};
const CATEGORY_TO_COURT: Record<string, string> = {
  "משפחה": "בית המשפט לענייני משפחה",
  "שלום": "בית משפט השלום",
  "מחוזי": "בית המשפט המחוזי",
  "עליון": "בית המשפט העליון",
  "עבודה": "בית הדין האזורי לעבודה",
  "עבודה ארצי": "בית הדין הארצי לעבודה",
  "תעבורה": "בית משפט לתעבורה",
};

function inferCaseTypeFromCategory(cat?: string): string | undefined {
  if (!cat) return undefined;
  return CATEGORY_TO_CASE_TYPE[cat.trim()];
}
function inferCourtFromCategory(cat?: string): string | undefined {
  if (!cat) return undefined;
  return CATEGORY_TO_COURT[cat.trim()];
}

// Generic "court name appears in seed" extractor (e.g. "(בית המשפט לענייני משפחה)").
function extractCourtFromText(text?: string): string | undefined {
  if (!text) return undefined;
  const m = text.match(/(בית\s+המשפט[^,)]{2,40}|בית\s+הדין[^,)]{2,40}|בית\s+משפט[^,)]{2,40})/);
  return m ? m[1].trim() : undefined;
}

/** Hebrew label for a missing required field (used in [חסר: ...] markers). */
function fieldLabelHebrew(field: string): string {
  const k = field.toLowerCase();
  if (k === "casetype") return "סוג ההליך";
  if (k === "casenumber") return "מספר התיק";
  if (k === "party1") return "שם צד א'";
  if (k === "party2") return "שם צד ב'";
  if (k === "fulldate") return "תאריך";
  if (k === "lawname") return "שם החוק";
  if (k === "regulationname") return "שם התקנות";
  if (k === "hebrewyear" || k === "gregorianyear" || k === "year") return "שנה";
  if (k === "collection") return "קובץ פרסום";
  if (k === "firstpage") return "מספר/עמוד";
  if (k === "series") return "סדרה";
  if (k === "volume") return "כרך";
  if (k === "authors" || k === "author") return "מחבר";
  if (k === "articletitle" || k === "title") return "כותרת";
  if (k === "journal") return "כתב עת";
  if (k === "booktitle") return "שם הספר";
  if (k.includes("page")) return "עמוד";
  if (k.includes("date")) return "תאריך";
  if (k.includes("name")) return "שם";
  return field;
}

/** Compose `[חסר: <label>]` token. */
function placeholderFor(field: string): string {
  return `[חסר: ${fieldLabelHebrew(field)}]`;
}

function isAllPlaceholders(text: string): boolean {
  const stripped = text.replace(/\[חסר:[^\]]+\]/g, "").trim();
  return stripped.length < 8;
}

function hasPlaceholderMarker(text?: string): boolean {
  return /\[חסר:[^\]]+\]/.test(text || "");
}

/** Title-strength gate for web/unknown/report sources. Refuses generic
 *  English/short titles like "Law", "Document", "Untitled". */
function isWeakTitle(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.length < 8) return true;
  // Generic English placeholder titles seen in production.
  if (/^(law|document|untitled|page|article|file|pdf)$/i.test(t)) return true;
  // Just a URL with no title.
  if (/^https?:\/\//.test(t) && !/[א-ת]/.test(t)) return false; // url-only is acceptable for web
  // Almost no Hebrew letters and short → weak.
  const heb = (t.match(/[א-ת]/g) || []).length;
  if (heb < 4 && t.length < 30) return true;
  return false;
}

// ── Caselaw resolution ────────────────────────────────────────────────
function tryEngineCaselaw(card: ContractSourceCard, seed: string): ResolveResult {
  // Build the strongest hints we can: prefer prefixed docket when known.
  const prefixedCaseNumber = card.docket_prefix && card.case_number
    ? `${card.docket_prefix} ${card.case_number}`
    : card.case_number;
  return resolveCitation(seed || card.case_number || "", "caselaw", {
    caseNumberHint: prefixedCaseNumber,
    titleHint: seed,
    decisionDateHint: card.decision_date,
  });
}

function fillCaselawTemplate(
  card: ContractSourceCard,
  partial: Record<string, string>,
  missing: string[],
): { text: string; missing: string[] } {
  const filled: Record<string, string> = { ...partial };

  // caseType: try inference from procedure_category, then docket_prefix.
  if (!filled.caseType) {
    const inferred = inferCaseTypeFromCategory(card.procedure_category) ??
      (card.docket_prefix && card.docket_prefix.length <= 6 ? card.docket_prefix : undefined);
    if (inferred) filled.caseType = inferred;
  }
  // caseNumber: pull from card if extractor missed.
  if (!filled.caseNumber && card.case_number) filled.caseNumber = card.case_number;

  // Court / database substitute. Prefer extracted court from text/category.
  const courtName = card.court ??
    extractCourtFromText(card.citation) ??
    extractCourtFromText(card.excerpt) ??
    inferCourtFromCategory(card.procedure_category);

  // Decide the parens block.
  //   - If we have fullDate AND a database name, use canonical Rule-19 form.
  //   - Else if we have a court name, render "({court}, [חסר: תאריך])" style.
  //   - Else fall back to "([חסר: תאריך])".
  let template: string;
  const hasDb = Boolean(filled.database?.trim());
  const hasDate = Boolean(filled.fullDate?.trim());
  const partiesCollapsed = (!filled.party1?.trim() && !filled.party2?.trim());

  // Template body before parens
  let header: string;
  if (partiesCollapsed) {
    header = `${filled.caseType ?? placeholderFor("caseType")} ${filled.caseNumber ?? placeholderFor("caseNumber")} [חסר: שמות הצדדים]`;
  } else {
    const p1 = filled.party1?.trim() || placeholderFor("party1");
    const p2 = filled.party2?.trim() || placeholderFor("party2");
    header = `${filled.caseType ?? placeholderFor("caseType")} ${filled.caseNumber ?? placeholderFor("caseNumber")} ${p1} נ' ${p2}`;
  }

  let parens: string;
  if (hasDb && hasDate) {
    parens = `(פורסם ב${filled.database}, ${filled.fullDate})`;
  } else if (courtName && !hasDate) {
    parens = `(${courtName}, ${placeholderFor("fullDate")})`;
  } else if (courtName && hasDate) {
    parens = `(${courtName}, ${filled.fullDate})`;
  } else if (hasDate) {
    parens = `(${filled.fullDate})`;
  } else {
    parens = `(${placeholderFor("fullDate")})`;
  }

  template = `${header} ${parens}.`;

  // Recompute missing list from what's still placeholder-tagged.
  const stillMissing = new Set<string>(missing);
  if (filled.caseType) stillMissing.delete("caseType");
  if (filled.caseNumber) stillMissing.delete("caseNumber");
  if (partiesCollapsed) {
    stillMissing.add("party1");
    stillMissing.add("party2");
  }
  if (!hasDate) stillMissing.add("fullDate");

  return { text: template, missing: Array.from(stillMissing) };
}

// ── Statute resolution ───────────────────────────────────────────────
function fillStatuteTemplate(
  card: ContractSourceCard,
  engineKey: string,
  partial: Record<string, string>,
  missing: string[],
): { text: string; missing: string[] } {
  const ruleSet = CITATION_RULES[engineKey];
  if (!ruleSet) {
    return { text: card.citation || placeholderFor("title"), missing };
  }
  const filled: Record<string, string> = { ...partial };
  for (const f of missing) {
    if (!filled[f]?.trim()) filled[f] = placeholderFor(f);
  }
  // Engine emit (interpolate template with missing placeholders).
  let out = ruleSet.template.replace(/\{(\w+)\}/g, (_m, k) => filled[k] ?? "");
  // If collection (ס"ח/ק"ת) is present but firstPage isn't, append explicit
  // "[חסר: עמוד]" so reviewers see the gap. The base template would have
  // emitted the page placeholder already, but for Rule 2.5 we want a clear
  // marker even when the engine considers firstPage optional.
  const hasColl = Boolean(filled.collection?.trim());
  const hasPage = Boolean(filled.firstPage?.trim()) ||
    /\[חסר: (?:עמוד|מספר\/עמוד)\]/.test(out);
  if (hasColl && !hasPage) {
    out = out.replace(/\.?\s*$/, "") + ` ${placeholderFor("firstPage")}.`;
  }
  // Tidy whitespace and stray punctuation.
  out = out.replace(/[ \t]+/g, " ")
    .replace(/,\s*,/g, ",")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\.{2,}/g, ".")
    .trim();
  return { text: out, missing };
}

// ── Article resolution (delegates to existing validator) ─────────────
function tryArticle(card: ContractSourceCard, seed: string): string | null {
  const seedText = seed || card.excerpt || "";
  const out = validateArticleCitation(seedText, seedText);
  return out && out.trim().length >= 12 ? out.trim() : null;
}

// ── Other / web / report / book ───────────────────────────────────────
function deriveOther(card: ContractSourceCard, seed: string, ft: FootnoteSourceType):
  { text: string; formatter: CanonicalFormatter; missing: string[] } {
  const seedText = (seed || card.excerpt?.split("\n")[0] || "").trim();
  const url = card.url?.trim();

  if (ft === "web_source" || ft === "unknown") {
    // Refuse weak/generic titles like "Law", "Document", "Untitled".
    if (isWeakTitle(seedText)) {
      const text = url ? `${placeholderFor("title")} — ${url}` : placeholderFor("title");
      return { text, formatter: "fallback_weak_title_refused", missing: ["title"] };
    }
    // Acceptable web title — keep + url.
    const text = url && !seedText.includes(url) ? `${seedText} — ${url}` : seedText;
    return { text, formatter: "fallback_minimal", missing: [] };
  }

  // book / book_chapter / report / protocol — keep seed if substantive,
  // append [חסר: שנה] when no year token.
  if (!seedText || isWeakTitle(seedText)) {
    const text = url ? `${placeholderFor("title")} — ${url}` : placeholderFor("title");
    return { text, formatter: "fallback_weak_title_refused", missing: ["title"] };
  }
  const hasYear = /\((?:19|20)\d{2}\)|הת[שׁש][א-ת]*["״]/.test(seedText);
  const text = hasYear ? seedText : `${seedText} ${placeholderFor("year")}`;
  const missing = hasYear ? [] : ["year"];
  return { text, formatter: "fallback_minimal", missing };
}

/**
 * Engine-first canonical derivation. Mutates the card.
 */
export function deriveCanonicalCitation(card: ContractSourceCard): void {
  const seed = (card.citation || "").trim();
  const ft = mapToFootnoteType(card);
  const engineKey = mapToEngineKey(card);
  let formatter: CanonicalFormatter = "fallback_minimal";
  let canonical = "";
  let missing: string[] = [];
  let resolverReason: string | undefined;

  // ── CASELAW ──────────────────────────────────────────────────────
  if (ft === "caselaw") {
    const r = tryEngineCaselaw(card, seed);
    if (r.resolved) {
      canonical = r.canonical;
      formatter = "engine_resolved";
    } else {
      resolverReason = r.reason;
      // We have at least a docket → template-fill with placeholders.
      const partial = r.partialFields ?? {};
      const missingList = r.missingFields ?? [];
      const haveDocket = Boolean(partial.caseNumber?.trim() || card.case_number?.trim());
      if (haveDocket || card.procedure_category) {
        const out = fillCaselawTemplate(card, partial, missingList);
        canonical = out.text;
        missing = out.missing;
        formatter = "engine_template_filled_with_placeholders";
      } else if (seed && seed.length >= 12) {
        // No docket recoverable. Reuse seed only if it scores `strong`.
        const q = scoreCitationQuality({ citation: seed, sourceType: card.source_type, caseNumber: card.case_number, url: card.url });
        if (q.quality === "strong") {
          canonical = seed;
          formatter = "reused_existing_strong";
        } else {
          // Build a marker-only minimum to make the gap visible.
          canonical = `${placeholderFor("caseType")} ${placeholderFor("caseNumber")} [חסר: שמות הצדדים] (${placeholderFor("fullDate")}).`;
          missing = ["caseType", "caseNumber", "party1", "party2", "fullDate"];
          formatter = "engine_unresolved_then_fallback";
        }
      } else {
        canonical = `${placeholderFor("caseType")} ${placeholderFor("caseNumber")} [חסר: שמות הצדדים] (${placeholderFor("fullDate")}).`;
        missing = ["caseType", "caseNumber", "party1", "party2", "fullDate"];
        formatter = "fallback_minimal";
      }
    }
  }
  // ── STATUTE ──────────────────────────────────────────────────────
  else if (ft === "statute" && engineKey) {
    const r = resolveCitation(seed || "", "statute", { titleHint: seed });
    if (r.resolved) {
      canonical = r.canonical;
      formatter = "engine_resolved";
      // Post-pass: collection without firstPage → append [חסר: מספר/עמוד].
      const hasColl = /ס["״]ח|ק["״]ת/.test(canonical);
      const hasPage = /(?:ס["״]ח|ק["״]ת)\s+\d+/.test(canonical);
      if (hasColl && !hasPage) {
        canonical = canonical.replace(/\.?\s*$/, "") + ` ${placeholderFor("firstPage")}.`;
        missing.push("firstPage");
        formatter = "engine_template_filled_with_placeholders";
      }
    } else {
      resolverReason = r.reason;
      const partial = r.partialFields ?? {};
      const missingList = r.missingFields ?? [];
      const out = fillStatuteTemplate(card, engineKey, partial, missingList);
      canonical = out.text;
      missing = out.missing;
      formatter = "engine_template_filled_with_placeholders";
    }
  }
  // ── ARTICLE ──────────────────────────────────────────────────────
  else if (ft === "journal_article") {
    const out = tryArticle(card, seed);
    if (out) {
      canonical = out;
      formatter = "engine_resolved";
    } else if (seed) {
      const q = scoreCitationQuality({ citation: seed, sourceType: card.source_type, url: card.url });
      if (q.quality === "strong") {
        canonical = seed;
        formatter = "reused_existing_strong";
      } else {
        // Minimum: seed + [חסר: שנה] if year missing.
        const hasYear = /\((?:19|20)\d{2}\)|הת[שׁש]/.test(seed);
        canonical = hasYear ? seed : `${seed} ${placeholderFor("year")}`;
        if (!hasYear) missing.push("year");
        formatter = "fallback_minimal";
      }
    } else {
      canonical = placeholderFor("title");
      missing.push("title");
      formatter = "fallback_minimal";
    }
  }
  // ── OTHER ────────────────────────────────────────────────────────
  else {
    const out = deriveOther(card, seed, ft);
    canonical = out.text;
    formatter = out.formatter;
    missing = out.missing;
  }

  card.canonicalCitation = canonical;
  card.canonicalFormatter = formatter;
  card.canonicalMissingFields = Array.from(new Set(missing));
  card.canonicalResolverReason = resolverReason;
  card.canonicalHasPlaceholders = hasPlaceholderMarker(canonical);

  // Final quality score on the rendered canonical (NOT the seed) so
  // downstream Rule 37 / classifier read the user-visible quality.
  const q = scoreCitationQuality({
    citation: canonical,
    sourceType: card.source_type,
    caseNumber: card.case_number,
    url: card.url,
  });
  card.citationQuality = q.quality;
}

/** Walk a pack (any number of group arrays) and attach canonicalCitation + IDs.
 *  Safe to call repeatedly — re-derives from current card state. */
export function attachCanonicalCitations(cards: ContractSourceCard[]): void {
  assignContractIds(cards);
  for (const c of cards) deriveCanonicalCitation(c);
}

/** Build the citation_assembly telemetry block from a derived card pack.
 *  Pure function — call after attachCanonicalCitations. */
export function buildCitationAssemblyTelemetry(
  cards: ContractSourceCard[],
): CitationAssemblyTelemetry {
  const tel: CitationAssemblyTelemetry = {
    total: cards.length,
    source_type_normalized: 0,
    engine_first_attempted: 0,
    seed_reuse_rejected: 0,
    template_filled: 0,
    placeholder_inserted: 0,
    missing_fields_counts: {},
    reused_existing_strong: 0,
    fallback_used: 0,
    examples: [],
  };
  for (const c of cards) {
    if (normalizeSourceTypeKey(c.source_type) !== c.source_type.toLowerCase()) {
      tel.source_type_normalized++;
    }
    const ft = mapToFootnoteType(c);
    if (ft === "caselaw" || ft === "statute" || ft === "journal_article") {
      tel.engine_first_attempted++;
    }
    if (c.canonicalFormatter === "engine_template_filled_with_placeholders") tel.template_filled++;
    if (c.canonicalHasPlaceholders) tel.placeholder_inserted++;
    if (c.canonicalFormatter === "reused_existing_strong") tel.reused_existing_strong++;
    if (c.canonicalFormatter === "fallback_minimal" ||
        c.canonicalFormatter === "fallback_weak_title_refused" ||
        c.canonicalFormatter === "engine_unresolved_then_fallback") {
      tel.fallback_used++;
    }
    // Track when the seed would have been reused under the OLD shortcut
    // but we rejected it because the engine ran first.
    if ((c.citation || "").trim().length >= 12 &&
        c.canonicalFormatter !== "reused_existing_strong" &&
        (ft === "caselaw" || ft === "statute")) {
      tel.seed_reuse_rejected++;
    }
    for (const f of c.canonicalMissingFields ?? []) {
      tel.missing_fields_counts[f] = (tel.missing_fields_counts[f] ?? 0) + 1;
    }
    if (tel.examples.length < 8 && (c.canonicalHasPlaceholders ||
        c.canonicalFormatter === "fallback_weak_title_refused")) {
      tel.examples.push({
        source_id: c.contractId ?? `id-${c.id}`,
        source_type: c.source_type,
        formatter: c.canonicalFormatter ?? "fallback_minimal",
        canonical: c.canonicalCitation ?? "",
        missing_fields: c.canonicalMissingFields ?? [],
      });
    }
  }
  return tel;
}


// ─── Marker parser ──────────────────────────────────────────────────

const MARKER_RE = /\[cite:\s*(S\d+(?:\s*,\s*S\d+)*)\s*\]/g;

export function parseMarkers(
  body: string,
  cards: ContractSourceCard[],
): ParseMarkersResult {
  const validIds = new Set(cards.map((c) => c.contractId).filter(Boolean) as string[]);
  const markers: ParsedMarker[] = [];
  const uniqueValid: string[] = [];
  const invalidSeen: string[] = [];
  const seenValid = new Set<string>();
  const seenInvalid = new Set<string>();

  let m: RegExpExecArray | null;
  const re = new RegExp(MARKER_RE.source, "g");
  while ((m = re.exec(body)) !== null) {
    const raw = m[0];
    const ids = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const id of ids) {
      if (validIds.has(id)) {
        valid.push(id);
        if (!seenValid.has(id)) { seenValid.add(id); uniqueValid.push(id); }
      } else {
        invalid.push(id);
        if (!seenInvalid.has(id)) { seenInvalid.add(id); invalidSeen.push(id); }
      }
    }
    markers.push({
      raw,
      sourceIds: ids,
      validSourceIds: valid,
      invalidSourceIds: invalid,
      position: m.index,
      surroundingClaim: extractSurroundingClaim(body, m.index),
    });
  }
  return {
    markers,
    uniqueValidSourceIds: uniqueValid,
    invalidSourceIds: invalidSeen,
  };
}

function extractSurroundingClaim(body: string, markerStart: number): string {
  const start = Math.max(0, markerStart - 120);
  const slice = body.slice(start, markerStart).trim();
  // Cut at last sentence boundary if any.
  const m = slice.match(/[.!?\n][^.!?\n]*$/);
  const cut = m ? slice.slice((m.index ?? 0) + 1).trim() : slice;
  return cut;
}

// ─── Deterministic footnote builder ─────────────────────────────────

const SUPER_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
function toSuper(n: number): string {
  return String(n).split("").map((d) => SUPER_DIGITS[Number(d)] ?? d).join("");
}

export function buildFootnotes(
  body: string,
  parse: ParseMarkersResult,
  cards: ContractSourceCard[],
): BuildFootnotesResult {
  const cardsById = new Map<string, ContractSourceCard>();
  for (const c of cards) if (c.contractId) cardsById.set(c.contractId, c);

  // Order of first occurrence drives footnote numbering.
  const firstOccurrence = new Map<string, number>(); // sourceId → fn number
  const footnotes: ContractFootnote[] = [];
  const formatterUsage: FormatterUsageCounts = {
    reused_existing_strong: 0,
    engine_resolved: 0,
    engine_template_filled_with_placeholders: 0,
    engine_unresolved_then_fallback: 0,
    fallback_minimal: 0,
    fallback_weak_title_refused: 0,
  };
  const missingMetadata: BuildFootnotesResult["missingMetadata"] = [];
  const sourceIdUsage: Record<string, number> = {};
  const resolverFailures: BuildFootnotesResult["resolverFailures"] = [];
  let nextNumber = 1;

  // Walk markers in body order. Replace each marker with the matching
  // superscript run.
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  for (const marker of parse.markers) {
    const supers: number[] = [];
    for (const id of marker.validSourceIds) {
      sourceIdUsage[id] = (sourceIdUsage[id] || 0) + 1;
      if (!firstOccurrence.has(id)) {
        const card = cardsById.get(id);
        if (!card) continue;
        // Ensure canonical exists. Keeps the contract robust if the caller
        // forgot to call attachCanonicalCitations beforehand.
        if (!card.canonicalCitation) deriveCanonicalCitation(card);
        const number = nextNumber++;
        firstOccurrence.set(id, number);
        const fn: ContractFootnote = {
          number,
          citation: card.canonicalCitation || "[חסר: מקור]",
          source_type: card.source_type,
          url: card.url,
          source: card.provenance,
          source_id: id,
          has_missing_markers: /\[חסר:/.test(card.canonicalCitation || ""),
        };
        footnotes.push(fn);
        if (card.canonicalFormatter) formatterUsage[card.canonicalFormatter]++;
        if (card.canonicalMissingFields && card.canonicalMissingFields.length > 0) {
          missingMetadata.push({
            source_id: id,
            missing_fields: card.canonicalMissingFields,
          });
        }
        if (card.canonicalResolverReason) {
          resolverFailures.push({
            source_id: id,
            source_type: card.source_type,
            reason: card.canonicalResolverReason,
            missing_fields: card.canonicalMissingFields ?? [],
          });
        }
      }
      supers.push(firstOccurrence.get(id)!);
    }
    const replacement = supers.length > 0
      ? supers.map(toSuper).join("\u2009") // thin space between adjacent supers
      : "";
    replacements.push({
      start: marker.position,
      end: marker.position + marker.raw.length,
      text: replacement,
    });
  }

  // Apply replacements right-to-left so offsets stay valid.
  let out = body;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }

  return {
    body: out,
    footnotes,
    formatterUsage,
    missingMetadata,
    sourceIdUsage,
    resolverFailures,
  };
}

// ─── Telemetry assembly ─────────────────────────────────────────────

export function buildTelemetry(input: {
  used: boolean;
  legacy_fallback: boolean;
  reason?: CardClaimContractTelemetry["reason"];
  parse?: ParseMarkersResult;
  build?: BuildFootnotesResult;
}): CardClaimContractTelemetry {
  const t = { ...EMPTY_TELEMETRY };
  t.used = input.used;
  t.legacy_fallback = input.legacy_fallback;
  t.reason = input.reason ?? null;
  if (input.parse) {
    t.markers_found = input.parse.markers.length;
    t.unique_source_ids_used = input.parse.uniqueValidSourceIds.length;
    t.invalid_source_ids = input.parse.invalidSourceIds;
    t.claims_with_sources = input.parse.markers.filter(
      (m) => m.validSourceIds.length > 0,
    ).length;
  }
  if (input.build) {
    t.generated_footnotes = input.build.footnotes.length;
    t.missing_metadata = input.build.missingMetadata;
    t.source_id_usage = input.build.sourceIdUsage;
    t.formatter_usage = input.build.formatterUsage;
    t.resolver_failures = input.build.resolverFailures;
  }
  return t;
}

// Re-exports for callers/tests.
export { classifyChapterFootnoteWithReason };
