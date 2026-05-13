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
  getRequiredFields,
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
  /** Set by `attachCanonicalCitations`; the deterministic citation string. */
  canonicalCitation?: string;
  /** Telemetry: which formatter produced canonicalCitation. */
  canonicalFormatter?: CanonicalFormatter;
  /** Telemetry: required engine fields not satisfied for this card's type. */
  canonicalMissingFields?: string[];
  /** Telemetry: when engine attempted but failed; the resolver reason. */
  canonicalResolverReason?: string;
}

export type CanonicalFormatter =
  | "reused_existing"
  | "engine_resolved"
  | "engine_unresolved_then_fallback"
  | "fallback_minimal";

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
  reused_existing: number;
  engine_resolved: number;
  engine_unresolved_then_fallback: number;
  fallback_minimal: number;
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
    reused_existing: 0,
    engine_resolved: 0,
    engine_unresolved_then_fallback: 0,
    fallback_minimal: 0,
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

/**
 * Map a card's `source_type` (legacy 12-value enum used in index.ts) to the
 * `routeChapterFootnote`-style `FootnoteSourceType` so we can pick the right
 * engine path. Returns "unknown" when no confident mapping exists.
 */
function mapToFootnoteType(card: ContractSourceCard): FootnoteSourceType {
  const t = (card.source_type || "").toLowerCase();
  if (t === "caselaw" || t === "פסיקה" || t === "case_law" ||
      t === "supreme_court" || t === "district_court" || t === "labor_court") {
    return "caselaw";
  }
  if (t === "israeli_law" || t === "חקיקה ישראלית" ||
      t === "primary_legislation" || t === "basic_law" ||
      t === "secondary_legislation" || t === "regulation" || t === "regulations" ||
      t === "ordinance" || t === "legislation" || t === "legislation_primary" ||
      t === "legislation_secondary") {
    return "statute";
  }
  if (t === "journal_article" || t === "מאמר אקדמי" || t === "article") {
    return "journal_article";
  }
  if (t === "academic_book" || t === "book") return "book";
  if (t === "book_chapter") return "book_chapter";
  if (t === "knesset_research" || t === "report" || t === "protocol") return "report";
  if (t === "external_web" || t === "web_source" || t === "document") return "web_source";
  return "unknown";
}

/** Engine source-type key for `validateCitation`/`getRequiredFields`. */
function mapToEngineKey(card: ContractSourceCard): string | null {
  const t = (card.source_type || "").toLowerCase();
  if (t === "caselaw" || t === "case_law" || t === "supreme_court" ||
      t === "district_court" || t === "labor_court") return "case_law_database";
  if (t === "basic_law") return "basic_law";
  if (t === "secondary_legislation" || t === "regulation" || t === "regulations" ||
      t === "ordinance") return "secondary_legislation";
  if (t === "primary_legislation" || t === "israeli_law" || t === "legislation" ||
      t === "legislation_primary") return "primary_legislation";
  if (t === "journal_article" || t === "article") return "academic_article" in CITATION_RULES
    ? "academic_article" : "journal_article";
  return null;
}

/**
 * Derive canonicalCitation for a single card.
 *
 * Strict precedence:
 *   1. Reuse the upstream-resolved `card.citation` when it exists and looks
 *      non-trivial (length ≥ 12 and not just placeholders).
 *   2. Engine path, routed by `source_type` via `mapToFootnoteType`:
 *        - statute / caselaw         → resolveCitation(...)
 *        - journal_article           → validateArticleCitation(...)
 *        - book / report / web etc.  → minimal cleanup (passthrough)
 *      If the engine returns a usable string, use it.
 *   3. Last-resort minimal fallback in this file (`buildMinimalFallback`).
 *      Required-but-missing engine fields are tagged `[חסר: <field>]`.
 *
 * Mutates the card with `canonicalCitation`, `canonicalFormatter`,
 * `canonicalMissingFields`, and `canonicalResolverReason`.
 */
export function deriveCanonicalCitation(card: ContractSourceCard): void {
  const seed = (card.citation || "").trim();
  // Step 1 — reuse if upstream produced something substantive.
  if (seed && seed.length >= 12 && !isAllPlaceholders(seed)) {
    card.canonicalCitation = seed;
    card.canonicalFormatter = "reused_existing";
    card.canonicalMissingFields = engineMissingFields(card, seed);
    return;
  }

  // Step 2 — route by type into the shared engine.
  const ft = mapToFootnoteType(card);
  let engineOut: string | null = null;
  let engineReason: string | undefined;

  if (ft === "statute" || ft === "caselaw") {
    const declared = ft === "statute" ? "statute" : "caselaw";
    const seedText = seed || card.case_number || "";
    if (seedText) {
      const r: ResolveResult = resolveCitation(seedText, declared, {
        caseNumberHint: card.case_number,
        titleHint: extractTitleFromExcerpt(card),
      });
      if (r.resolved) {
        engineOut = r.canonical;
      } else {
        engineReason = r.reason;
        card.canonicalResolverReason = r.reason;
      }
    }
  } else if (ft === "journal_article") {
    const seedText = seed || card.excerpt || "";
    const out = validateArticleCitation(seedText, seedText);
    if (out && out.trim().length >= 12) engineOut = out.trim();
  } else if (ft === "book" || ft === "book_chapter" || ft === "report") {
    const seedText = seed || card.excerpt || "";
    if (seedText.trim()) {
      // Light passthrough: trim + ensure year placeholder if absent.
      const hasYear = /\\((?:19|20)\\d{2}\\)|הת[שׁש][א-ת]*["״]/.test(seedText);
      engineOut = hasYear ? seedText.trim() : `${seedText.trim()} [חסר: שנה]`;
    }
  } else if (ft === "web_source") {
    const seedText = seed || card.excerpt || "";
    if (seedText.trim()) engineOut = seedText.trim();
  }

  if (engineOut && engineOut.length >= 12) {
    card.canonicalCitation = engineOut;
    card.canonicalFormatter = engineReason
      ? "engine_unresolved_then_fallback"
      : "engine_resolved";
    card.canonicalMissingFields = engineMissingFields(card, engineOut);
    return;
  }

  // Step 3 — last-resort minimal fallback.
  const { text, missing } = buildMinimalFallback(card);
  card.canonicalCitation = text;
  card.canonicalFormatter = engineReason
    ? "engine_unresolved_then_fallback"
    : "fallback_minimal";
  card.canonicalMissingFields = missing;
}

function isAllPlaceholders(text: string): boolean {
  const stripped = text.replace(/\[חסר:[^\]]+\]/g, "").trim();
  return stripped.length < 8;
}

function extractTitleFromExcerpt(card: ContractSourceCard): string | undefined {
  // The drafter doesn't see this — only the resolver. Use the excerpt's first
  // line as a title hint when no other signal is available.
  const ex = (card.excerpt || "").split("\n")[0]?.trim();
  return ex && ex.length > 4 ? ex.slice(0, 200) : undefined;
}

function engineMissingFields(card: ContractSourceCard, citation: string): string[] {
  const key = mapToEngineKey(card);
  if (!key || !CITATION_RULES[key]) return [];
  // We don't have extracted fields here, so we approximate by checking
  // whether the citation includes obvious year/page tokens. A more precise
  // check would re-extract — but the post-process validators already do that
  // and inject `[חסר: ...]` markers, so we keep this lightweight.
  const required = getRequiredFields(key);
  const missing: string[] = [];
  for (const f of required) {
    if (f.toLowerCase().includes("year") &&
        !/הת[שׁש]|התש"|\((?:19|20)\d{2}\)|–\s*(?:19|20)\d{2}/.test(citation)) {
      missing.push(f);
    }
  }
  // De-dup
  return [...new Set(missing)];
}

function buildMinimalFallback(
  card: ContractSourceCard,
): { text: string; missing: string[] } {
  const key = mapToEngineKey(card);
  const required = key ? getRequiredFields(key) : [];
  const parts: string[] = [];
  const seed = (card.citation || "").trim();
  if (seed) parts.push(seed);
  else if (card.excerpt) parts.push(card.excerpt.split("\n")[0].trim().slice(0, 160));
  if (card.url) parts.push(card.url);
  const text = parts.join(" — ").trim() || "[חסר: מקור]";
  // Tag missing required fields as placeholders (without inventing values).
  const missing = required.filter((f) => {
    if (f.toLowerCase().includes("year")) {
      return !/הת[שׁש]|\((?:19|20)\d{2}\)/.test(text);
    }
    return false;
  });
  let out = text;
  for (const f of missing) {
    const label = fieldLabelHebrew(f);
    if (!out.includes(`[חסר: ${label}]`)) out += ` [חסר: ${label}]`;
  }
  return { text: out, missing };
}

function fieldLabelHebrew(field: string): string {
  const k = field.toLowerCase();
  if (k.includes("year")) return "שנה";
  if (k.includes("page")) return "עמוד";
  if (k.includes("name") && k.includes("law")) return "שם החוק";
  if (k.includes("party")) return "שם בעל-דין";
  if (k.includes("date")) return "תאריך";
  if (k.includes("collection")) return "קובץ פרסום";
  return field;
}

/** Walk a pack (any number of group arrays) and attach canonicalCitation + IDs.
 *  Safe to call repeatedly — re-derives from current card state. */
export function attachCanonicalCitations(cards: ContractSourceCard[]): void {
  assignContractIds(cards);
  for (const c of cards) deriveCanonicalCitation(c);
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
    reused_existing: 0,
    engine_resolved: 0,
    engine_unresolved_then_fallback: 0,
    fallback_minimal: 0,
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
