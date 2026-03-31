import { supabase } from "@/integrations/supabase/client";

export type VerifiedSourceCategory = "caselaw" | "legislation_primary" | "legislation_secondary" | "literature";
export type VerificationStatus = "verified" | "pending" | "invalid";

interface SourceClassificationInput {
  rawInput: string;
  fullCitation: string;
  sourceType?: string | null;
}

interface EnsureVerifiedSourceInput extends SourceClassificationInput {
  verifiedBy?: string | null;
  autoVerified?: boolean;
}

interface VerifySourceResult {
  status: VerificationStatus;
  confidence: number;
  issues: string[];
  details: string;
}

const LEGISLATION_PATTERNS = /^(חוק|פקודת|פקודה|תקנות|צו|כללי|הוראות|נוהל|תקנון|חוק[\s-]יסוד)/;
const CASELAW_PATTERNS = /^(בג"ץ|בג״ץ|ע"א|ע״א|ע"פ|ע״פ|רע"א|רע״א|דנ"א|דנ״א|ת"א|ת״א|ע"ע|ע״ע|עע"מ|עע״מ|בש"פ|בש״פ|ת"פ|ת״פ|תפ"ח|תפ״ח|עמ"ה|עמ״ה|בר"ם|בר״ם)/;
const SECONDARY_LEGISLATION = /^(תקנות|צו|כללי|הוראות|נוהל|תקנון)/;
const SECTION_TO_LAW = /^סעיף\s+[\dא-ת()./\\–-]+\s+ל/;
const CASE_NUMBER_PATTERN = /(?:בג"ץ|בג״ץ|ע"א|ע״א|ע"פ|ע״פ|רע"א|רע״א|דנ"א|דנ״א|ת"א|ת״א|ע"ע|ע״ע|עע"מ|עע״מ|בש"פ|בש״פ|ת"פ|ת״פ|תפ"ח|תפ״ח|עמ"ה|עמ״ה|בר"ם|בר״ם)\s+([0-9]+\/[0-9]+)/;

const LEGISLATION_SOURCE_TYPES = ["חוק יסוד", "חקיקה ראשית", "חקיקה משנית", "חקיקת משנה", "חקיקה", "basic_law", "primary_legislation", "secondary_legislation", "bill", "legislation_primary", "legislation_secondary"];
const CASELAW_SOURCE_TYPES = ["פסיקה", "פסיקה (מאגר)", "פסיקה (פד\"י)", "case_law_published", "case_law_database", "caselaw"];
const LITERATURE_SOURCE_TYPES = ["מאמר", "ספר", "article", "book", "literature", "מקור מרשתת", "מקור לועזי"];

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeVerifiedSourceKey(text: string) {
  return normalizeWhitespace(text).toLowerCase();
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

function extractLawName(text: string) {
  const withoutSection = normalizeWhitespace(text).replace(SECTION_TO_LAW, "").trim();
  return withoutSection.split(",")[0]?.trim() ?? withoutSection;
}

function normalizeLawCitationForStorage(fullCitation: string) {
  let normalized = normalizeWhitespace(fullCitation).replace(SECTION_TO_LAW, "").trim();

  normalized = normalized.replace(/,\s*(?:בעמ['״׳]?|עמ['״׳]?|עמוד|at|p\.|pp\.)\s*[\d\-–]+\.?$/iu, "");
  normalized = normalized.replace(/,\s*(?:ס["״]ח|ק["״]ת)\s*[\d\-–]+(?:\s*[,/]\s*[\d\-–]+)?\.?$/u, "");
  normalized = normalized.replace(/\s+\./g, ".");
  normalized = normalized.replace(/,+$/g, "").trim();

  if (!/[.]$/.test(normalized)) {
    normalized = `${normalized}.`;
  }

  return normalized;
}

function buildStorageShape(item: EnsureVerifiedSourceInput) {
  const category = classifyVerifiedSource(item);
  const isLaw = category === "legislation_primary" || category === "legislation_secondary";
  const storedCitation = isLaw ? normalizeLawCitationForStorage(item.fullCitation.trim()) : item.fullCitation.trim();
  const storedSourceName = isLaw ? extractLawName(storedCitation).slice(0, 100) : item.rawInput.substring(0, 100);
  const year = extractYear(storedCitation) ?? extractYear(item.fullCitation) ?? null;

  return {
    category,
    storedCitation,
    storedSourceName,
    year,
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
                ? `${extractLawName(storage.storedCitation)}|${storage.year ?? ""}`
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
