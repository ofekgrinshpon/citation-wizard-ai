import { supabase } from "@/integrations/supabase/client";

export type VerifiedSourceCategory = "caselaw" | "legislation_primary" | "legislation_secondary" | "literature" | "other";
export type VerificationStatus = "verified" | "pending" | "invalid";

interface SourceClassificationInput {
  rawInput: string;
  fullCitation: string;
  sourceType?: string | null;
}

interface EnsureVerifiedSourceInput extends SourceClassificationInput {
  verifiedBy?: string | null;
  autoVerified?: boolean;
  yearPreferences?: { hasHebrewYear: boolean; hasGregorianYear: boolean };
}

interface VerifySourceResult {
  status: VerificationStatus;
  confidence: number;
  issues: string[];
  details: string;
}

export interface VerifiedSourceMatch {
  id: string;
  source_name: string;
  full_citation: string;
  source_type: string;
  year: string | null;
  volume: string | null;
  page: string | null;
  metadata: Record<string, unknown> | null;
  verification_status: VerificationStatus;
}

const LEGISLATION_PATTERNS = /^(חוק|פקודת|פקודה|תקנות|צו|כללי|הוראות|נוהל|תקנון|חוק[\s-]יסוד)/;
const CASELAW_PATTERNS = /^(בג"ץ|בג״ץ|ע"א|ע״א|ע"פ|ע״פ|רע"א|רע״א|דנ"א|דנ״א|ת"א|ת״א|ע"ע|ע״ע|עע"מ|עע״מ|בש"פ|בש״פ|ת"פ|ת״פ|תפ"ח|תפ״ח|עמ"ה|עמ״ה|בר"ם|בר״ם)/;
const SECONDARY_LEGISLATION = /^(תקנות|צו|כללי|הוראות|נוהל|תקנון)/;
const SECTION_TO_LAW = /^סעיף\s+[\dא-ת()./\\–-]+\s+ל/;
const SECTION_EXTRACT = /^סעיף\s+([\dא-ת()./\\–-]+)\s+ל/;
const CASE_NUMBER_PATTERN = /(?:בג"ץ|בג״ץ|ע"א|ע״א|ע"פ|ע״פ|רע"א|רע״א|דנ"א|דנ״א|ת"א|ת״א|ע"ע|ע״ע|עע"מ|עע״מ|בש"פ|בש״פ|ת"פ|ת״פ|תפ"ח|תפ״ח|עמ"ה|עמ״ה|בר"ם|בר״ם)\s+([0-9]+\/[0-9]+)/;

const LEGISLATION_SOURCE_TYPES = ["חוק יסוד", "חקיקה ראשית", "חקיקה משנית", "חקיקת משנה", "חקיקה", "basic_law", "primary_legislation", "secondary_legislation", "bill", "legislation_primary", "legislation_secondary"];
const CASELAW_SOURCE_TYPES = ["פסיקה", "פסיקה (מאגר)", "פסיקה (פד\"י)", "case_law_published", "case_law_database", "caselaw"];
const LITERATURE_SOURCE_TYPES = ["מאמר", "מאמר בכתב עת", "מאמר שפורסם בספר", "ספר", "article", "article_in_book", "book", "literature", "מקור מרשתת", "מקור לועזי"];

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeVerifiedSourceKey(text: string) {
  return normalizeWhitespace(text).toLowerCase();
}

function normalizeSearchableText(text: string) {
  return normalizeVerifiedSourceKey(text)
    .replace(/["״׳'.,()[\]{}:;!?/\\|–—-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strip section/pinpoint references from a query so that
 * "חוק העונשין ס׳34כב" → "חוק העונשין" for verified-source matching.
 */
function stripSectionReferences(text: string): string {
  return text
    // ס׳34כב / ס'34 / ס"34 patterns (section abbreviation + number)
    .replace(/ס[׳'״"]\s*\d+[א-ת]*/g, "")
    // סעיף 34כב / סעיפים 1-5
    .replace(/סעיפי?ם?\s+[\dא-ת()./\\–\-\s]+/g, "")
    // פסקה / פס' references
    .replace(/(?:פסקה|פס[׳'״"])\s*[\dא-ת()./\\–\-]+/g, "")
    // בעמ' / עמ' page references  
    .replace(/(?:בעמ[׳'״"]?|עמ[׳'״"]?|עמוד)\s*[\d\-–]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchTerms(text: string) {
  return Array.from(new Set(normalizeSearchableText(text).split(" ").filter((token) => token.length >= 2)));
}

function scoreVerifiedSourceMatch(query: string, source: Pick<VerifiedSourceMatch, "source_name" | "full_citation"> & { search_text?: string }) {
  // Strip section references so "חוק העונשין ס׳34כב" matches "חוק העונשין"
  const strippedQuery = stripSectionReferences(query);
  const normalizedQuery = normalizeSearchableText(strippedQuery);
  const normalizedSourceName = normalizeSearchableText(source.source_name);
  const normalizedDisplayCandidate = normalizeSearchableText(`${source.source_name} ${source.full_citation}`);
  const normalizedSearchCandidate = normalizeSearchableText(`${source.source_name} ${source.full_citation} ${source.search_text || ""}`);
  const words = tokenizeSearchTerms(strippedQuery);

  const matchesExactName = normalizedSourceName === normalizedQuery;
  const matchesAllWords = words.length > 1 && words.every((word) => normalizedSearchCandidate.includes(word));
  const matchesSingleWord = words.length === 1 && normalizedQuery.length >= 3 && normalizedDisplayCandidate.includes(normalizedQuery);

  if (!matchesExactName && !matchesAllWords && !matchesSingleWord) {
    return -1;
  }

  let score = 0;
  if (matchesExactName) score += 200;
  if (matchesAllWords) score += 100;
  if (matchesSingleWord) score += 40;
  if (normalizedSearchCandidate.includes(normalizedQuery)) score += 20;
  score += words.reduce((total, word) => total + (normalizedSearchCandidate.includes(word) ? 10 : 0), 0);

  return score;
}

export async function findVerifiedSourceMatch(query: string): Promise<VerifiedSourceMatch | null> {
  const strippedQuery = stripSectionReferences(query);
  const terms = tokenizeSearchTerms(strippedQuery);
  // Also extract case number patterns (e.g., "1514/01", "1514")
  const caseNumberParts = (query.match(/\d+(?:\/\d+)?/g) || []).filter(p => p.length >= 2);
  const allTerms = Array.from(new Set([...terms, ...caseNumberParts]))
    .map(t => t.replace(/["״׳'\\,()]/g, '')).filter(t => t.length >= 2);
  if (allTerms.length === 0) return null;

  const orConditions = allTerms
    .flatMap((term) => [
      `search_text.ilike.%${term}%`,
      `source_name.ilike.%${term}%`,
      `full_citation.ilike.%${term}%`,
    ])
    .join(",");

  const { data, error } = await supabase
    .from("verified_sources")
    .select("id, source_name, full_citation, source_type, year, volume, page, metadata, verification_status, search_text")
    .eq("verification_status", "verified")
    .or(orConditions)
    .limit(12);

  if (error || !data?.length) return null;

  const bestMatch = (data as (VerifiedSourceMatch & { search_text?: string })[])
    .map((candidate) => ({
      candidate,
      score: scoreVerifiedSourceMatch(query, candidate),
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)[0];

  return bestMatch?.candidate ?? null;
}

/**
 * Find a similar (but not exact) verified source match.
 * Returns a suggestion when at least half the search terms match but it's not a full match.
 */
export async function findSimilarVerifiedSource(query: string): Promise<VerifiedSourceMatch | null> {
  const terms = tokenizeSearchTerms(query);
  if (terms.length === 0) return null;

  const caseNumberParts = (query.match(/\d+(?:\/\d+)?/g) || []).filter(p => p.length >= 2);
  const allTerms = Array.from(new Set([...terms, ...caseNumberParts]))
    .map(t => t.replace(/["״׳'\\,()]/g, '')).filter(t => t.length >= 2);
  if (allTerms.length === 0) return null;

  const orConditions = allTerms
    .flatMap((term) => [
      `search_text.ilike.%${term}%`,
      `source_name.ilike.%${term}%`,
      `full_citation.ilike.%${term}%`,
    ])
    .join(",");

  const { data, error } = await supabase
    .from("verified_sources")
    .select("id, source_name, full_citation, source_type, year, volume, page, metadata, verification_status, search_text")
    .eq("verification_status", "verified")
    .or(orConditions)
    .limit(20);

  if (error || !data?.length) return null;

  // Score all candidates and find partial matches
  const scored = (data as (VerifiedSourceMatch & { search_text?: string })[])
    .map((candidate) => {
      const normalizedCandidate = normalizeSearchableText(`${candidate.source_name} ${candidate.full_citation} ${candidate.search_text || ""}`);
      const matchingTerms = allTerms.filter(term => normalizedCandidate.includes(term));
      const matchRatio = matchingTerms.length / allTerms.length;
      const fullScore = scoreVerifiedSourceMatch(query, candidate);
      return { candidate, matchRatio, matchingTerms: matchingTerms.length, fullScore };
    });

  // If there's already a full match (score >= 0), no need for suggestion
  const hasFullMatch = scored.some(s => s.fullScore >= 100);
  if (hasFullMatch) return null;

  // Find the best partial match: at least 40% of terms match and at least 1 matching term (for single-word queries)
  const minTerms = allTerms.length === 1 ? 1 : 2;
  const bestPartial = scored
    .filter(s => s.matchRatio >= 0.4 && s.matchingTerms >= minTerms)
    .sort((a, b) => b.matchingTerms - a.matchingTerms || b.matchRatio - a.matchRatio)[0];

  return bestPartial?.candidate ?? null;
}

function isShortCitation(text: string) {
  const cleaned = text.trim();
  return /^שם([.,\s]|$)/.test(cleaned) || /לעיל ה["״']?ש/.test(cleaned);
}

function classifySourceText(text: string): VerifiedSourceCategory {
  let trimmed = text.trim();
  if (SECTION_TO_LAW.test(trimmed)) {
    trimmed = trimmed.replace(SECTION_TO_LAW, "").trim();
  }

  if (CASELAW_PATTERNS.test(trimmed)) return "caselaw";
  if (LEGISLATION_PATTERNS.test(trimmed)) {
    return SECONDARY_LEGISLATION.test(trimmed) ? "legislation_secondary" : "legislation_primary";
  }

  return "literature";
}

export function classifyVerifiedSource(input: SourceClassificationInput): VerifiedSourceCategory {
  const sourceType = (input.sourceType || "").trim();

  if (sourceType === "other") return "other";
  if (CASELAW_SOURCE_TYPES.some((candidate) => sourceType.includes(candidate))) return "caselaw";
  if (LEGISLATION_SOURCE_TYPES.some((candidate) => sourceType.includes(candidate))) {
    const rawCategory = classifySourceText(input.rawInput);
    return rawCategory === "legislation_secondary" ? "legislation_secondary" : "legislation_primary";
  }
  if (LITERATURE_SOURCE_TYPES.some((candidate) => sourceType.includes(candidate))) return "literature";

  const rawCategory = classifySourceText(input.rawInput);
  if (rawCategory !== "literature") return rawCategory;
  return classifySourceText(input.fullCitation);
}

export function getVerifiedCategoryLabel(category: VerifiedSourceCategory) {
  switch (category) {
    case "caselaw":
      return "פסיקה";
    case "legislation_primary":
      return "חקיקה ראשית";
    case "legislation_secondary":
      return "חקיקת משנה";
    case "literature":
      return "ספרות ומאמרים";
    case "other":
      return "אחר";
    default:
      return "ספרות ומאמרים";
  }
}

export function getVerificationStatusLabel(status: VerificationStatus) {
  switch (status) {
    case "verified":
      return "מאומת";
    case "pending":
      return "ממתין לבדיקה";
    case "invalid":
      return "לא תקין";
  }
}

function extractYear(text: string) {
  const matches = [...text.matchAll(/\b((?:19|20)\d{2})\b/g)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

function extractCaseNumber(text: string) {
  return text.match(CASE_NUMBER_PATTERN)?.[1] ?? null;
}

function extractSection(text: string): string | null {
  const match = normalizeWhitespace(text).match(SECTION_EXTRACT);
  return match ? match[1].trim() : null;
}

function extractLawName(text: string) {
  const withoutSection = normalizeWhitespace(text).replace(SECTION_TO_LAW, "").trim();
  return withoutSection.split(",")[0]?.trim() ?? withoutSection;
}

/**
 * Extract publication source (ס"ח / ק"ת) and page number from a citation.
 */
function extractPublicationInfo(text: string): { pubSource: string | null; page: number | null } {
  const match = text.match(/(?:ס["״]ח|ק["״]ת)\s+(\d+)/);
  if (!match) return { pubSource: null, page: null };
  const pubMatch = text.match(/(ס["״]ח|ק["״]ת)/);
  return {
    pubSource: pubMatch ? pubMatch[1] : null,
    page: parseInt(match[1], 10),
  };
}

/**
 * Normalize a law citation for storage as a "Master Record".
 * KEEPS the publication source (ס"ח/ק"ת) and its initial page number.
 * Strips specific pinpoint page references (בעמ', עמ') that refer to
 * a location *within* the law, not the law's starting page.
 */
function normalizeLawCitationForStorage(fullCitation: string) {
  const raw = normalizeWhitespace(fullCitation);
  // Extract section prefix if present, to re-attach later
  const sectionMatch = raw.match(SECTION_EXTRACT);
  const sectionPrefix = sectionMatch ? `סעיף ${sectionMatch[1]} ל` : "";

  let normalized = raw.replace(SECTION_TO_LAW, "").trim();

  // Strip pinpoint page references (בעמ', עמ', at p.) — these are specific references
  normalized = normalized.replace(/,\s*(?:בעמ['״׳]?|עמ['״׳]?|עמוד|at|p\.|pp\.)\s*[\d\-–]+\.?$/iu, "");
  normalized = normalized.replace(/\s+\./g, ".");
  normalized = normalized.replace(/,+$/g, "").trim();

  if (!/[.]$/.test(normalized)) {
    normalized = `${normalized}.`;
  }

  // Re-attach section prefix for section-specific entries
  return sectionPrefix ? `${sectionPrefix}${normalized}` : normalized;
}

/**
 * Check if a citation is a fragment (e.g., just "ס"ח 69") rather than a complete legal entity.
 * A complete legal entity must have: Name + Year + Publication Source + Page.
 */
function isFragmentCitation(text: string, category: VerifiedSourceCategory): boolean {
  if (category !== "legislation_primary" && category !== "legislation_secondary") return false;
  const trimmed = normalizeWhitespace(text);
  // Fragment: just a publication ref without a law name
  if (/^(ס["״]ח|ק["״]ת)\s+\d+\.?$/.test(trimmed)) return true;
  // Fragment: just a page number
  if (/^\d+\.?$/.test(trimmed)) return true;
  // Must contain a law name (at least one Hebrew word that's not a pub ref)
  const withoutPubRef = trimmed.replace(/(ס["״]ח|ק["״]ת)\s+\d+/g, "").replace(/,/g, "").trim();
  const withoutYear = withoutPubRef.replace(/התש[^\s,]+[–-]\d{4}/g, "").replace(/\d{4}/g, "").trim();
  if (!withoutYear || withoutYear.length < 3) return true;
  return false;
}

function buildStorageShape(item: EnsureVerifiedSourceInput) {
  const category = classifyVerifiedSource(item);
  const isLaw = category === "legislation_primary" || category === "legislation_secondary";
  const isCase = category === "caselaw";
  const section = isLaw ? extractSection(item.fullCitation) : null;
  const storedCitation = isLaw ? normalizeLawCitationForStorage(item.fullCitation.trim()) : item.fullCitation.trim();

  // For caselaw: use the case number (e.g., "ע"פ 1514/01") as source_name
  let storedSourceName: string;
  if (isCase) {
    const caseNumberMatch = item.fullCitation.match(CASE_NUMBER_PATTERN);
    storedSourceName = caseNumberMatch ? caseNumberMatch[0].trim().slice(0, 100) : item.rawInput.substring(0, 100);
  } else if (isLaw) {
    storedSourceName = extractLawName(storedCitation).slice(0, 100);
  } else {
    // For literature: extract the title from quotes (e.g., "שם המאמר") or bold markers (**שם הספר**)
    const quotedTitle = item.fullCitation.match(/["״]([^"״]+)["״]/)?.[1]
      || item.fullCitation.match(/\*\*([^*]+)\*\*/)?.[1];
    storedSourceName = (quotedTitle || item.rawInput).substring(0, 100);
  }

  const year = extractYear(storedCitation) ?? extractYear(item.fullCitation) ?? null;
  const pubInfo = isLaw ? extractPublicationInfo(storedCitation) : { pubSource: null, page: null };

  return {
    category,
    storedCitation,
    storedSourceName,
    year,
    pubSource: pubInfo.pubSource,
    initialPage: pubInfo.page,
    section,
    isFragment: isLaw ? isFragmentCitation(item.rawInput, category) : false,
  };
}

async function verifySourceWithAI(
  rawInput: string,
  fullCitation: string,
  sourceType: string | null
): Promise<VerifySourceResult> {
  try {
    const { data, error } = await supabase.functions.invoke("verify-source", {
      body: { rawInput, fullCitation, sourceType },
    });

    if (error) {
      console.error("verify-source invoke error:", error);
      return { status: "pending", confidence: 0, issues: ["Verification service error"], details: "" };
    }

    return data as VerifySourceResult;
  } catch (e) {
    console.error("verify-source exception:", e);
    return { status: "pending", confidence: 0, issues: ["Verification unavailable"], details: "" };
  }
}

export async function ensureVerifiedSources(
  items: EnsureVerifiedSourceInput[],
  options?: { skipAIVerification?: boolean }
): Promise<{ added: number; invalid: number; skipped: number }> {
  const candidates = Array.from(
    new Map(
      items
        .filter((item) => item.fullCitation.trim() && !isShortCitation(item.fullCitation))
        .map((item) => {
          const storage = buildStorageShape(item);
          const dedupeKey = normalizeVerifiedSourceKey(
            storage.category === "caselaw"
              ? extractCaseNumber(storage.storedCitation) || `${storage.storedSourceName}|${storage.storedCitation}`
              : storage.category === "legislation_primary" || storage.category === "legislation_secondary"
                ? `${extractLawName(storage.storedCitation)}|${storage.year ?? ""}|${storage.pubSource ?? ""}|${storage.initialPage ?? ""}|${storage.section ?? "null"}`
                : `${storage.storedSourceName}|${storage.year ?? storage.storedCitation}`
          );
          return [dedupeKey, item] as const;
        })
    ).values()
  );

  if (candidates.length === 0) return { added: 0, invalid: 0, skipped: 0 };

  let added = 0;
  let invalid = 0;
  let skipped = 0;

  for (const item of candidates) {
    const storage = buildStorageShape(item);
    const isLaw = storage.category === "legislation_primary" || storage.category === "legislation_secondary";

    // ENTITY INTEGRITY: Never save a fragment as a verified source
    if (storage.isFragment) {
      console.log(`Skipping fragment citation: "${item.rawInput}" — not a complete legal entity`);
      skipped++;
      continue;
    }

    // For laws: check if a master record already exists
    if (isLaw) {
      const lawName = extractLawName(storage.storedCitation);
      const { data: existingMasters } = await supabase
        .from("verified_sources")
        .select("id, full_citation, page, source_name")
        .eq("source_type", storage.category)
        .ilike("source_name", lawName)
        .limit(10);

      if (existingMasters && existingMasters.length > 0) {
        // Find existing records that match this section (or no section for general law)
        const sectionSuffix = storage.section ? `|section:${storage.section.toLowerCase().trim()}` : "";
        const matchingRecords = existingMasters.filter((m) => {
          const mSection = extractSection(m.full_citation);
          const mSuffix = mSection ? `|section:${mSection.toLowerCase().trim()}` : "";
          return mSuffix === sectionSuffix;
        });

        if (matchingRecords.length > 0) {
          const existingRecord = matchingRecords[0];
          const existingPageInfo = extractPublicationInfo(existingRecord.full_citation);

          if (storage.initialPage !== null && existingPageInfo.page !== null) {
            if (storage.initialPage > existingPageInfo.page) {
              // New page is HIGHER than existing — this is a specific reference, skip
              console.log(`Skipping: page ${storage.initialPage} > master page ${existingPageInfo.page} for "${lawName}"`);
              skipped++;
              continue;
            } else if (storage.initialPage < existingPageInfo.page) {
              // New page is LOWER — this is the real initial page. OVERWRITE the old record.
              console.log(`Overwriting master record for "${lawName}": replacing page ${existingPageInfo.page} with ${storage.initialPage}`);
              const { error: updateError } = await supabase
                .from("verified_sources")
                .update({
                  full_citation: storage.storedCitation,
                  search_text: `${normalizeVerifiedSourceKey(storage.storedSourceName)} ${normalizeVerifiedSourceKey(storage.storedCitation)} ${storage.year ?? ""}`.trim(),
                })
                .eq("id", existingRecord.id);
              if (updateError) console.error("Update master record error:", updateError);
              else added++;
              continue;
            } else {
              // Same page — exact duplicate, skip
              skipped++;
              continue;
            }
          } else {
            // Master record exists but may have no page; update if we now have one
            if (storage.initialPage !== null && existingPageInfo.page === null) {
              console.log(`Updating master record for "${lawName}" with initial page ${storage.initialPage}`);
              const { error: updateError } = await supabase
                .from("verified_sources")
                .update({
                  full_citation: storage.storedCitation,
                  search_text: `${normalizeVerifiedSourceKey(storage.storedSourceName)} ${normalizeVerifiedSourceKey(storage.storedCitation)} ${storage.year ?? ""}`.trim(),
                })
                .eq("id", existingRecord.id);
              if (updateError) console.error("Update master record error:", updateError);
              else added++;
              continue;
            }
            // Otherwise exact duplicate
            skipped++;
            continue;
          }
        }
      }
    }

    let verificationStatus: VerificationStatus = "pending";
    if (!options?.skipAIVerification) {
      const result = await verifySourceWithAI(item.rawInput, storage.storedCitation, item.sourceType ?? null);
      verificationStatus = result.status as VerificationStatus;
      if (verificationStatus === "invalid") {
        invalid++;
      }
    } else {
      verificationStatus = "verified";
    }

    const payload = {
      source_name: storage.storedSourceName,
      source_type: storage.category,
      full_citation: storage.storedCitation,
      search_text: `${normalizeVerifiedSourceKey(storage.storedSourceName)} ${normalizeVerifiedSourceKey(storage.storedCitation)} ${storage.year ?? ""}`.trim(),
      auto_verified: item.autoVerified ?? false,
      verified_by: item.verifiedBy ?? null,
      verification_status: verificationStatus,
      year: storage.year,
      metadata: item.yearPreferences ? { hasHebrewYear: item.yearPreferences.hasHebrewYear, hasGregorianYear: item.yearPreferences.hasGregorianYear } : {},
    };

    const { error } = await supabase.from("verified_sources").insert(payload);

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        skipped++;
        continue;
      }

      console.error("Insert verified source error:", error);
      continue;
    }

    if (verificationStatus !== "invalid") {
      added++;
    }
  }

  return { added, invalid, skipped };
}
