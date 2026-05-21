// Research Core v1 — Deliverable 6.1: Canonical Citation Builder.
//
// Deterministic. Reuses _shared/citationResolver.ts for statute/caselaw.
// No LLM call anywhere. Missing fields stay missing.

import {
  resolveCitation,
  type DeclaredType,
  type ResolveResult,
} from "../../_shared/citationResolver.ts";
import type {
  CitationQuality,
  LedgerSource,
  LedgerSourceCitation,
  ShortFormInputs,
} from "./types.ts";
import {
  cleanCitationText,
  isUninformativeLabel,
  normalizeSourceType,
  isBareReporter,
  extractDocketFromText,
  extractPartiesFromText,
  extractYearFromText,
  extractFullDateFromText,
  isPipeArtifact,
  parsePipeArtifact,
} from "./citationCleanup.ts";

// Hosts known to host primary legal materials (mirrors ledger.ts).
const PRIMARY_HOSTS = [
  "nevo.co.il",
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
  "takdin.co.il",
  "lite.takdin.co.il",
  "psakdin.co.il",
  "din.org.il",
  "reshumot.gov.il",
  "fs.knesset.gov.il",
  "main.knesset.gov.il",
  "knesset.gov.il",
  "justice.gov.il",
];

// Approved Israeli legal-academic hosts (scholarly passthrough).
const APPROVED_SCHOLARLY_HOSTS = [
  "mishpatim.huji.ac.il",
  "iyunim.huji.ac.il",
  "law.huji.ac.il",
  "law.tau.ac.il",
  "law.haifa.ac.il",
  "law.biu.ac.il",
  "idi.org.il",
  "tau.ac.il",
  "huji.ac.il",
  "haifa.ac.il",
  "biu.ac.il",
];

const STATUTE_TYPES = new Set([
  "legislation",
  "statute",
  "regulation",
  "basic_law",
  "primary_legislation",
  "secondary_legislation",
]);
const CASELAW_TYPES = new Set([
  "caselaw",
  "case_law_database",
  "case_law_published",
  "published_caselaw",
]);

const LEGISLATION_DETECT_RE =
  /^(חוק|פקודת|פקודה|תקנות|צו|כללי|הוראות|חוק[\s-]יסוד|ס['׳]\s+|סעיף\s+[\dא-ת]+\s+ל)/;

const GENERIC_PARTIES =
  /^(מדינת ישראל|פלוני|פלונית|אלמוני|אלמונית|היועץ המשפטי לממשלה|היועמ["״]ש)\b/;

function hostOf(url?: string): string {
  if (!url) return "";
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

function isApprovedHost(host: string, list: string[]): boolean {
  if (!host) return false;
  for (const h of list) if (host === h || host.endsWith("." + h)) return true;
  return false;
}

function declaredFor(sourceType: string): "statute" | "caselaw" | "none" {
  const t = (sourceType || "").toLowerCase().trim();
  if (STATUTE_TYPES.has(t)) return "statute";
  if (CASELAW_TYPES.has(t)) return "caselaw";
  return "none";
}

// Extract law name from a canonical statute citation or title.
// Mirrors src/lib/citationUtils.ts#extractLawNameFromInput (Deno-side port).
function extractLawName(text: string): string | undefined {
  if (!text) return undefined;
  const cleaned = text.trim().replace(/^ס['׳]\s+[\dא-ת()./\\–-]+\s+ל/, "")
    .replace(/^סעיף\s+[\dא-ת()./\\–-]+\s+ל/, "")
    .trim();
  const head = cleaned.split(/[.\n]/)[0] || cleaned;
  // Stop at the first opening parenthesis that introduces a year/issue suffix.
  const m = head.match(
    /(חוק[\s-]יסוד[^.\n]*?|חוק[^.\n]*?|פקודת[^.\n]*?|פקודה[^.\n]*?|תקנות[^.\n]*?|צו[^.\n]*?|כללי[^.\n]*?)(?:,\s*ה?תש[א-ת]["״][א-ת]?(?:-\d{4})?|$)/,
  );
  const name = (m ? m[1] : head.split(",")[0]).trim();
  return name || undefined;
}

// Mirrors BatchFootnoteBuilder.extractShortSourceLabel (Deno-side port).
function extractShortLabel(text: string): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/\*\*/g, "").replace(/##/g, "").trim();
  // caselaw: <party A> נ' <party B>
  const m = cleaned.match(
    /([^,\n()]+?)\s+נ['׳]\s+([^,\n()]+?)(?=\s*,|\s*\(|$)/,
  );
  if (m) {
    const a = m[1].trim().replace(/^.*?\d+\/\d+\s+/, "").trim();
    const b = m[2].trim();
    const pick = GENERIC_PARTIES.test(b)
      ? (GENERIC_PARTIES.test(a) ? b : a)
      : b;
    return pick ? `עניין ${pick}` : undefined;
  }
  const hebrewLaw = cleaned.match(
    /(חוק[\s-]יסוד[^,\n]*|חוק[^,\n]*|פקודת[^,\n]*|תקנות[^,\n]*|צו[^,\n]*)/,
  );
  if (hebrewLaw) return hebrewLaw[1].trim();
  const first = cleaned.split(/[.,\n]/)[0]?.trim();
  return first || undefined;
}

function extractSection(pinpoint?: string): string | undefined {
  if (!pinpoint) return undefined;
  const m = pinpoint.match(/(?:סעיף|ס['׳])\s*([\dא-ת()./\-–]+)/);
  return m ? m[1] : undefined;
}

function buildShortFormInputs(
  ls: LedgerSource,
  canonical: string,
  engineSourceType?: string,
): ShortFormInputs {
  const probe = canonical || ls.citation || ls.title || "";
  const isLegislationByType =
    engineSourceType === "primary_legislation" ||
    engineSourceType === "basic_law" ||
    engineSourceType === "secondary_legislation";
  const is_legislation =
    isLegislationByType || LEGISLATION_DETECT_RE.test((probe || "").trim());

  const law_name = is_legislation
    ? extractLawName(canonical || ls.title || ls.citation)
    : undefined;
  const short_label = is_legislation
    ? law_name
    : extractShortLabel(canonical || ls.title || ls.citation);
  const default_section = extractSection(ls.pinpoint);

  return {
    is_legislation,
    law_name,
    short_label,
    default_section,
    default_pinpoint: ls.pinpoint,
  };
}

function passthroughCitation(ls: LedgerSource): { text: string; quality: CitationQuality; errors: string[] } {
  const errors: string[] = [];
  let text = (ls.citation || "").trim();
  if (!text) {
    const titleBit = (ls.title || "").trim();
    if (titleBit) text = titleBit;
  }
  if (text && ls.origin === "approved_web" && ls.url) {
    const h = hostOf(ls.url);
    if (h && !text.includes(h)) text = `${text} (${h})`;
  }
  if (!text) {
    return { text: "", quality: "failed", errors: ["passthrough_empty"] };
  }
  errors.push("passthrough_no_canonical_template");
  return { text, quality: "partial", errors };
}

function offDomainError(ls: LedgerSource): string | null {
  if (ls.origin !== "approved_web") return null;
  const h = hostOf(ls.url);
  if (!h) return null;
  if (isApprovedHost(h, PRIMARY_HOSTS)) return null;
  if (isApprovedHost(h, APPROVED_SCHOLARLY_HOSTS)) return null;
  return `off_domain:${h}`;
}

export interface BuildCitationHints {
  /** Used by enrichment retries; passed straight to citationResolver. */
  party1?: string;
  party2?: string;
  fullDate?: string;
  year?: string;
  caseNumber?: string;
}

export function buildCitationForSource(
  ls: LedgerSource,
  hints: BuildCitationHints = {},
): LedgerSourceCitation {
  // Normalize source_type up front so declaredFor and the final footnote
  // see a canonical value (no `supreme_court_il` / `israeli_law` leaks).
  const normalizedType = normalizeSourceType(ls.source_type);
  const declared = declaredFor(normalizedType);
  const errors: string[] = [];
  let canonical = "";
  let quality: CitationQuality = "failed";
  let placeholders: string[] = [];
  let engineSourceType: string | undefined;
  let engine_used: "resolver" | "passthrough" | "none" = "none";

  // Gather case-meta hints from the LedgerSource fields themselves (title,
  // citation, snippet, pinpoint) so the resolver can fill in docket / parties
  // / date even when the citation string is bare. No LLM, no external lookup.
  const haystack = `${ls.title || ""}\n${ls.citation || ""}\n${ls.snippet || ""}`;
  const docketFromText = extractDocketFromText(haystack);
  const partiesFromText = extractPartiesFromText(haystack);
  const yearFromText = extractYearFromText(haystack);
  const fullDateFromText = extractFullDateFromText(haystack);

  const resolverHints = {
    titleHint: ls.title,
    caseNumberHint: hints.caseNumber ?? docketFromText?.docket,
    party1Hint: hints.party1 ?? partiesFromText?.party1,
    party2Hint: hints.party2 ?? partiesFromText?.party2,
    fullDateHint: hints.fullDate ?? fullDateFromText,
    yearHint: hints.year ?? yearFromText,
  };

  if (declared !== "none") {
    engine_used = "resolver";
    const res: ResolveResult = resolveCitation(
      ls.citation || ls.title || "",
      declared as DeclaredType,
      resolverHints,
    );
    if (res.resolved) {
      engineSourceType = res.sourceType;
      canonical = res.canonical;
      placeholders = res.placeholders ?? [];
      if (placeholders.length > 0) {
        quality = "partial";
        for (const f of placeholders) errors.push(`placeholder:${f}`);
      } else {
        quality = "ok";
      }
    } else {
      quality = "failed";
      errors.push(`engine:${res.reason}`);
      for (const f of res.missingFields) errors.push(`missing:${f}`);
      // Salvage attempt: if a partial citation existed, fall back to passthrough
      // so the QA pass can decide what to do (will mark quality=partial).
      const pt = passthroughCitation(ls);
      if (pt.text && pt.quality !== "failed") {
        canonical = pt.text;
        quality = "partial";
        engine_used = "passthrough";
        for (const e of pt.errors) errors.push(e);
      }
    }
  } else {
    engine_used = "passthrough";
    const pt = passthroughCitation(ls);
    canonical = pt.text;
    quality = pt.quality;
    for (const e of pt.errors) errors.push(e);
  }

  const off = offDomainError(ls);
  if (off) errors.push(off);

  // Sanity: uninformative source_type / label (e.g. "[DOC] nevo.co.il", empty source_type).
  const emptySourceType = !(normalizedType && normalizedType.trim());
  const uninformativeTitle = isUninformativeLabel(ls.title);
  if (emptySourceType) errors.push("empty_source_type");
  if (uninformativeTitle) errors.push("uninformative_label");
  if ((emptySourceType || uninformativeTitle) && quality === "ok") {
    quality = "partial";
  }

  // Deterministic cleanup of the canonical text (idempotent, no LLM).
  if (canonical) canonical = cleanCitationText(canonical);

  // ─── Bare-reporter gate (Rule 18) ──────────────────────────────────────
  // A caselaw footnote that is only `פ"ד מט(4) 221` (no docket, no parties)
  // is unacceptable as a final citation. Mark needs_review so the quality
  // pass drops it. Enrichment may rewrite this via enrichBareReporterCitation
  // after gathering hints from the LedgerSource / partyLookup.
  if (declared === "caselaw" && isBareReporter(canonical)) {
    quality = "needs_review";
    if (!errors.includes("failed_bare_reporter")) {
      errors.push("failed_bare_reporter");
    }
  }

  // ─── Journal-article pipe-artifact gate ────────────────────────────────
  // Composite labels like `כותרת | מחבר (כרך)` must not appear as-is in a
  // final citation. Try to parse; if we can't, mark partial + journal_pipe.
  if (canonical && isPipeArtifact(canonical) && declared === "none") {
    const parsed = parsePipeArtifact(canonical);
    if (parsed.ok && parsed.title && parsed.author) {
      const volPart = parsed.volume ? ` ${parsed.volume}` : "";
      const yearPart = parsed.year ? ` (${parsed.year})` : "";
      canonical = `${parsed.author} "${parsed.title}"${volPart}${yearPart}.`;
      canonical = cleanCitationText(canonical);
      if (quality === "ok") quality = "partial";
      errors.push("journal_pipe_parsed");
    } else {
      // Strip pipe to a single space so output isn't visually broken,
      // but flag so the quality pass marks it as partial / needs_review.
      canonical = canonical.replace(/\s\|\s/g, " — ");
      canonical = cleanCitationText(canonical);
      quality = "needs_review";
      if (!errors.includes("journal_pipe_unresolved")) {
        errors.push("journal_pipe_unresolved");
      }
    }
  }

  const short_form_inputs = buildShortFormInputs(ls, canonical, engineSourceType);

  return {
    ls_id: ls.ls_id,
    source_type: normalizedType || ls.source_type,
    declared_type: declared,
    canonical_citation: canonical,
    citation_quality: quality,
    citation_errors: errors,
    placeholders,
    engine_used,
    short_form_inputs,
  };
}

export function buildCitationsForLedger(
  ledgerEntries: { sources: LedgerSource[] }[],
): Map<string, LedgerSourceCitation> {
  const out = new Map<string, LedgerSourceCitation>();
  for (const e of ledgerEntries) {
    for (const s of e.sources) {
      out.set(s.ls_id, buildCitationForSource(s));
    }
  }
  return out;
}

/**
 * Re-build a citation for a LedgerSource using freshly recovered party-name
 * / date hints (e.g. from `_shared/partyLookup.ts`). Returns the new
 * `LedgerSourceCitation`. Caller swaps it into the citations map.
 */
export function enrichBareReporterCitation(
  ls: LedgerSource,
  hints: BuildCitationHints,
): LedgerSourceCitation {
  return buildCitationForSource(ls, hints);
}

