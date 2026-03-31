import { supabase } from "@/integrations/supabase/client";

export type VerifiedSourceCategory = "caselaw" | "legislation_primary" | "legislation_secondary" | "literature";

interface SourceClassificationInput {
  rawInput: string;
  fullCitation: string;
  sourceType?: string | null;
}

interface EnsureVerifiedSourceInput extends SourceClassificationInput {
  verifiedBy?: string | null;
  autoVerified?: boolean;
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

export async function ensureVerifiedSources(items: EnsureVerifiedSourceInput[]) {
  const candidates = Array.from(
    new Map(
      items
        .filter((item) => item.fullCitation.trim() && !isShortCitation(item.fullCitation))
        .map((item) => [normalizeVerifiedSourceKey(item.fullCitation), item])
    ).values()
  );

  if (candidates.length === 0) return 0;

  const { data: existingRows, error: existingError } = await supabase
    .from("verified_sources")
    .select("id, full_citation");

  if (existingError) throw existingError;

  const existingKeys = new Set(
    (existingRows || []).map((row) => normalizeVerifiedSourceKey(row.full_citation))
  );

  const payload = candidates
    .filter((item) => !existingKeys.has(normalizeVerifiedSourceKey(item.fullCitation)))
    .map((item) => ({
      source_name: item.rawInput.substring(0, 100),
      source_type: classifyVerifiedSource(item),
      full_citation: item.fullCitation.trim(),
      search_text: `${normalizeVerifiedSourceKey(item.rawInput)} ${normalizeVerifiedSourceKey(item.fullCitation)}`.trim(),
      auto_verified: item.autoVerified ?? false,
      verified_by: item.verifiedBy ?? null,
    }));

  if (payload.length === 0) return 0;

  const { error } = await supabase.from("verified_sources").insert(payload);
  if (error) throw error;

  return payload.length;
}
