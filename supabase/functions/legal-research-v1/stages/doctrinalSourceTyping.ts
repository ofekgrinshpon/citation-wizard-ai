/**
 * substance_based_doctrinal_sufficiency_v1 — narrow doctrinal source typing
 * and eligibility.
 *
 * Two jobs, both deterministic and both read-only over the drafter input pack:
 *
 *  1. `remapDoctrinalSourceTypes` — sources that reach the drafter typed
 *     `other` (or with an empty type) but that carry genuinely acquired
 *     substantive text and pass source-integrity are re-typed into one of the
 *     doctrinal buckets, so downstream sufficiency/claim-match can see them.
 *     Nothing else is re-typed: primary law, judgments and already-typed
 *     scholarship keep their type. An unknown `other` source with no acquired
 *     body stays `other` and therefore stays non-citable.
 *
 *  2. `assessDoctrinalEligibility` — the single predicate that decides whether
 *     a secondary/doctrinal source may support a limited doctrinal statement.
 *     Perplexity-only, snippet-only, abstract-only, metadata-only, listing,
 *     block/exception and integrity-failing sources are always ineligible.
 *
 * This stage never relaxes judgment identity, docket validation, cache rules
 * or primary-law integrity. It cannot make a source citable for a court
 * holding — only for doctrinal/scholarly/background statements.
 */

import type { DrafterInputSource } from "./drafter.ts";

export const DOCTRINAL_SOURCE_TYPES = [
  "legal_article",
  "book_or_chapter",
  "doctrinal_commentary",
  "institutional_report",
  "scholarship",
] as const;
export type DoctrinalSourceType = typeof DOCTRINAL_SOURCE_TYPES[number];

/** Types that already describe doctrinal material (pre-existing vocabulary). */
export const EXISTING_DOCTRINAL_TYPES = new Set([
  "journal_article",
  "article",
  "scholarship",
  "academic",
  "working_paper",
  "faculty_pdf",
  "book",
  "commentary",
  "chapter",
  "book_chapter",
  "report",
  "government_report",
  ...DOCTRINAL_SOURCE_TYPES,
]);

/** Minimum acquired substantive text before a source counts as "body acquired". */
const MIN_BODY_CHARS = 500;
/** Minimum text before an *already typed* doctrinal source may be cited. */
const MIN_CITABLE_TEXT_CHARS = 400;

export interface DoctrinalRemap {
  ref: string;
  original_type: string;
  mapped_type: DoctrinalSourceType;
  evidence: string[];
}

export interface DoctrinalEligibility {
  ref: string;
  eligible: boolean;
  reason: string;
  source_type: string;
  remapped: boolean;
  body_chars: number;
}

export interface DoctrinalTypingReport {
  applied: boolean;
  remapped: DoctrinalRemap[];
  eligibility: DoctrinalEligibility[];
  eligible_refs: string[];
  ineligible_reason_counts: Record<string, number>;
}

// ── provenance / content signals (substance, not fixed phrases) ────────────

const ACADEMIC_HOST_RE =
  /(ac\.il|edu|jstor|heinonline|nevo\.co\.il\/Article|repository|journals?|hebrewu|tau\.ac|huji|biu\.ac|colman|idc\.ac|law\.[a-z]+\.ac)/i;
const INSTITUTIONAL_HOST_RE =
  /(gov\.il|knesset\.gov\.il|mevaker\.gov\.il|idi\.org\.il|btl\.gov\.il|boi\.org\.il|oecd|un\.org)/i;
const BOOK_SIGNAL_RE = /(ספר|כרך|מהדורה|הוצאת|פרק\s|בתוך:|עורכ)/;
const ARTICLE_SIGNAL_RE = /(מאמר|כתב עת|רבעון|עיוני משפט|משפטים|הפרקליט|משפט וממשל|עלי משפט)/;
const REPORT_SIGNAL_RE = /(דו"ח|דוח|דין וחשבון|ועדת|מבקר המדינה|נייר עמדה|מחקר מדיניות|מרכז המחקר)/;
const COMMENTARY_SIGNAL_RE = /(פירוש|פרשנות|הערה|סקירה|ניתוח|בעקבות|מאת)/;

const BLOCK_PAGE_RE = /(access denied|forbidden|captcha|שגיאה|exception|request blocked|are you a robot)/i;

function textOf(s: DrafterInputSource): string {
  return `${s.title ?? ""} ${s.snippet ?? ""}`;
}

function bodyChars(s: DrafterInputSource): number {
  const explicit = Number(s.available_text_length ?? 0);
  const topical = String(s.topical_text ?? "").length;
  const snippet = String(s.snippet ?? "").length;
  return Math.max(explicit, topical, snippet);
}

/**
 * True when the source's substantive text was genuinely acquired by us — a
 * stored corpus document or an acquired body — rather than assembled from a
 * search result, an abstract or a snippet.
 */
export function hasAcquiredSubstantiveText(s: DrafterInputSource): boolean {
  // doctrinal_secondary_body_acquisition_v1 — a body we fetched and extracted
  // ourselves counts even when the candidate was first surfaced by Perplexity;
  // the discovery channel is not the evidence, the acquired text is.
  if (s.body_acquired === true) return true;
  if (String(s.origin) === "perplexity") return false;
  const chars = bodyChars(s);
  if (chars < MIN_BODY_CHARS) return false;
  // Corpus documents (local_db) and user uploads carry real stored text.
  return String(s.origin) === "local_db" || String(s.origin) === "user_upload";
}


function integrityOk(s: DrafterInputSource): boolean {
  const usability = String(s.text_usability || "unknown");
  const tier = String(s.authority_tier || "unknown");
  if (String(s.citable_as || "") === "not_citable") return false;
  if (usability === "metadata_only" || usability === "listing_page") return false;
  if (tier === "index_or_listing" || tier === "non_authority") return false;
  if (BLOCK_PAGE_RE.test(textOf(s))) return false;
  return true;
}

function inferDoctrinalType(s: DrafterInputSource): { type: DoctrinalSourceType; evidence: string[] } | null {
  const url = String(s.url ?? "");
  const hay = textOf(s);
  const evidence: string[] = [];

  if (REPORT_SIGNAL_RE.test(hay)) evidence.push("report_signal");
  if (BOOK_SIGNAL_RE.test(hay)) evidence.push("book_signal");
  if (ARTICLE_SIGNAL_RE.test(hay)) evidence.push("article_signal");
  if (COMMENTARY_SIGNAL_RE.test(hay)) evidence.push("commentary_signal");
  if (ACADEMIC_HOST_RE.test(url)) evidence.push("academic_host");
  if (INSTITUTIONAL_HOST_RE.test(url)) evidence.push("institutional_host");

  if (evidence.includes("report_signal") || evidence.includes("institutional_host")) {
    return { type: "institutional_report", evidence };
  }
  if (evidence.includes("book_signal")) return { type: "book_or_chapter", evidence };
  if (evidence.includes("article_signal")) return { type: "legal_article", evidence };
  if (evidence.includes("academic_host")) return { type: "scholarship", evidence };
  if (evidence.includes("commentary_signal")) return { type: "doctrinal_commentary", evidence };
  return null;
}

/**
 * Mutates `sources` in place: `other`-typed sources with acquired substantive
 * text and passing integrity get a doctrinal type. Everything else is left
 * exactly as it was.
 */
export function remapDoctrinalSourceTypes(sources: DrafterInputSource[]): DoctrinalRemap[] {
  const out: DoctrinalRemap[] = [];
  for (const s of sources) {
    const t = String(s.source_type ?? "").toLowerCase();
    if (t && t !== "other" && t !== "unknown" && t !== "web") continue;
    if (!hasAcquiredSubstantiveText(s)) continue;
    if (!integrityOk(s)) continue;
    const inferred = inferDoctrinalType(s);
    if (!inferred) continue;
    out.push({
      ref: s.ref,
      original_type: t || "(empty)",
      mapped_type: inferred.type,
      evidence: inferred.evidence,
    });
    s.source_type = inferred.type;
    s.doctrinal_type_remapped = true;
  }
  return out;
}

/** True when the (possibly remapped) type is a doctrinal/secondary type. */
export function isDoctrinalType(sourceType: string | null | undefined): boolean {
  return EXISTING_DOCTRINAL_TYPES.has(String(sourceType ?? "").toLowerCase());
}

/**
 * The single eligibility predicate for "may this secondary/doctrinal source
 * support a limited doctrinal statement?".
 */
export function assessDoctrinalEligibility(s: DrafterInputSource): DoctrinalEligibility {
  const base = {
    ref: s.ref,
    source_type: String(s.source_type ?? ""),
    remapped: s.doctrinal_type_remapped === true,
    body_chars: bodyChars(s),
  };
  const no = (reason: string): DoctrinalEligibility => ({ ...base, eligible: false, reason });

  if (!isDoctrinalType(s.source_type)) return no("not_doctrinal_type");
  // Perplexity-only material stays ineligible; a source whose substantive body
  // we actually acquired is judged on that body, not on where it surfaced.
  if (String(s.origin) === "perplexity" && s.body_acquired !== true) {
    return no("perplexity_only");
  }
  if (!integrityOk(s)) return no("integrity_failed_or_metadata_only");
  if (!hasAcquiredSubstantiveText(s) && base.body_chars < MIN_CITABLE_TEXT_CHARS) {
    return no("no_acquired_body_text");
  }
  const verdict = String(s.verifier_verdict ?? s.best_support ?? "");
  if (verdict !== "direct" && verdict !== "partial") return no("verifier_not_direct_or_partial");
  return { ...base, eligible: true, reason: "eligible_doctrinal_secondary" };
}

export function buildDoctrinalTypingReport(
  sources: DrafterInputSource[],
  remapped: DoctrinalRemap[],
): DoctrinalTypingReport {
  const eligibility = sources.map(assessDoctrinalEligibility);
  const counts: Record<string, number> = {};
  for (const e of eligibility) {
    if (e.eligible) continue;
    counts[e.reason] = (counts[e.reason] ?? 0) + 1;
  }
  return {
    applied: true,
    remapped,
    eligibility,
    eligible_refs: eligibility.filter((e) => e.eligible).map((e) => e.ref),
    ineligible_reason_counts: counts,
  };
}
