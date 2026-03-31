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

const LEGISLATION_SOURCE_TYPES = ["חוק יסוד", "חקיקה ראשית", "חקיקה משנית", "חקיקת משנה", "חקיקה", "basic_law", "primary_legislation", "secondary_legislation", "bill", "legislation_primary", "legislation_secondary"];
const CASELAW_SOURCE_TYPES = ["פסיקה", "פסיקה (מאגר)", "פסיקה (פד\"י)", "case_law_published", "case_law_database", "caselaw"];
const LITERATURE_SOURCE_TYPES = ["מאמר", "ספר", "article", "book", "literature", "מקור מרשתת", "מקור לועזי"];

export function normalizeVerifiedSourceKey(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
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

/**
 * Call the verify-source edge function to AI-validate a source.
 */
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

/**
 * Check if a source already exists in verified_sources by normalized full_citation.
 */
async function sourceAlreadyExists(fullCitation: string): Promise<boolean> {
  const key = normalizeVerifiedSourceKey(fullCitation);
  const { data } = await supabase
    .from("verified_sources")
    .select("id")
    .ilike("full_citation", key)
    .limit(1);

  if (data && data.length > 0) return true;

  // Fallback: fetch all and compare normalized keys (handles edge cases)
  const { data: allRows } = await supabase
    .from("verified_sources")
    .select("id, full_citation");

  if (!allRows) return false;
  return allRows.some((row) => normalizeVerifiedSourceKey(row.full_citation) === key);
}

/**
 * Ensure verified sources are saved, with AI cross-referencing.
 * Returns: { added: number, invalid: number, skipped: number }
 */
export async function ensureVerifiedSources(
  items: EnsureVerifiedSourceInput[],
  options?: { skipAIVerification?: boolean }
): Promise<{ added: number; invalid: number; skipped: number }> {
  const candidates = Array.from(
    new Map(
      items
        .filter((item) => item.fullCitation.trim() && !isShortCitation(item.fullCitation))
        .map((item) => [normalizeVerifiedSourceKey(item.fullCitation), item])
    ).values()
  );

  if (candidates.length === 0) return { added: 0, invalid: 0, skipped: 0 };

  let added = 0;
  let invalid = 0;
  let skipped = 0;

  for (const item of candidates) {
    // Zero redundancy: skip if already exists
    const exists = await sourceAlreadyExists(item.fullCitation);
    if (exists) {
      skipped++;
      continue;
    }

    // AI verification (unless skipped for admin manual verification)
    let verificationStatus: VerificationStatus = "pending";
    if (!options?.skipAIVerification) {
      const result = await verifySourceWithAI(item.rawInput, item.fullCitation, item.sourceType ?? null);
      verificationStatus = result.status as VerificationStatus;

      if (verificationStatus === "invalid") {
        invalid++;
        // Still save as invalid for admin review
      }
    } else {
      // Admin manual verification = directly verified
      verificationStatus = "verified";
    }

    const payload = {
      source_name: item.rawInput.substring(0, 100),
      source_type: classifyVerifiedSource(item),
      full_citation: item.fullCitation.trim(),
      search_text: `${normalizeVerifiedSourceKey(item.rawInput)} ${normalizeVerifiedSourceKey(item.fullCitation)}`.trim(),
      auto_verified: item.autoVerified ?? false,
      verified_by: item.verifiedBy ?? null,
      verification_status: verificationStatus,
    };

    const { error } = await supabase.from("verified_sources").insert(payload);
    if (error) {
      console.error("Insert verified source error:", error);
      continue;
    }

    if (verificationStatus !== "invalid") {
      added++;
    }
  }

  return { added, invalid, skipped };
}
