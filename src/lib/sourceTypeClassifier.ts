import { supabase } from "@/integrations/supabase/client";
import {
  detectSourceType,
  hasStrongStatuteSignal,
  looksLikeLiteratureShape,
  type SourceType,
} from "@/data/abbreviations";

export interface ClassifyResult {
  sourceType: SourceType;
  confidence: number;
  reason: string;
}

/** Legislation guess that rests only on a mid-title statute word. */
export function isWeakLegislationGuess(rawText: string, regexType: SourceType): boolean {
  const isLegislation =
    regexType === "primary_legislation" ||
    regexType === "basic_law" ||
    regexType === "secondary_legislation";
  if (!isLegislation) return false;
  return !hasStrongStatuteSignal(rawText);
}

/**
 * Decide whether to call the Gemini classifier for this input.
 * Skip when the regex already returns a high-confidence non-literature type.
 */
export function shouldUseLLMClassifier(rawText: string, regexType: SourceType): boolean {
  // Scholarship-shaped input always deserves the LLM's opinion.
  if (looksLikeLiteratureShape(rawText) && !hasStrongStatuteSignal(rawText)) return true;

  // Strong, reliable regex signals — skip LLM.
  if (
    regexType === "case_law_published" ||
    regexType === "case_law_database" ||
    regexType === "primary_legislation" ||
    regexType === "basic_law" ||
    regexType === "secondary_legislation" ||
    regexType === "bill" ||
    regexType === "treaty" ||
    regexType === "regulation" ||
    regexType === "internet" ||
    regexType === "internet_comment" ||
    regexType === "religious" ||
    regexType === "other" ||
    regexType === "court_pleading" ||
    regexType === "government_decision" ||
    regexType === "expert_opinion" ||
    regexType === "planning_plan" ||
    regexType === "collective_agreement"
  ) {
    // A weak legislation guess (mid-title "חוק") must go to the LLM.
    if (isWeakLegislationGuess(rawText, regexType)) return true;
    // Even for caselaw/legislation, if no docket / no חוק/תקנות/הצעת etc. — let LLM check
    if (/\d+\/\d+/.test(rawText)) return false;
    if (/חוק[- ]יסוד|תקנות|הצעת חוק|פקודת|חוק\s+\S/.test(rawText)) return false;
    if (/https?:\/\//.test(rawText)) return false;
    if (/אמנה|כ["״]א\s+\d/.test(rawText)) return false;
    if (regexType === "internet" || regexType === "internet_comment" || regexType === "religious") return false;
    // Otherwise still let LLM weigh in
  }
  // Ambiguous family — always use LLM
  return true;
}


/**
 * Call the classify-source edge function. Fails soft: returns null on error.
 */
export async function classifySourceWithLLM(rawText: string): Promise<ClassifyResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke("classify-source", {
      body: { rawText },
    });
    if (error) {
      console.warn("[classifySource] edge error", error);
      return null;
    }
    if (!data || typeof data.sourceType !== "string") return null;
    return {
      sourceType: data.sourceType as SourceType,
      confidence: Number(data.confidence) || 0,
      reason: String(data.reason || ""),
    };
  } catch (e) {
    console.warn("[classifySource] exception", e);
    return null;
  }
}

/**
 * Hybrid classifier: regex first, LLM for ambiguous/literature cases.
 * Returns the chosen SourceType. The LLM result overrides only when its
 * confidence is high enough (>= 0.6) and the regex result was unknown or
 * the literature family (book/article/article_in_book).
 */
export async function resolveSourceType(rawText: string): Promise<{
  sourceType: SourceType;
  source: "regex" | "llm";
  llm?: ClassifyResult;
}> {
  const regexType = detectSourceType(rawText);
  if (!shouldUseLLMClassifier(rawText, regexType)) {
    return { sourceType: regexType, source: "regex" };
  }
  const llm = await classifySourceWithLLM(rawText);
  if (!llm) return { sourceType: regexType, source: "regex" };

  const ambiguous =
    regexType === "unknown" ||
    regexType === "book" ||
    regexType === "article" ||
    regexType === "article_in_book";

  if (ambiguous && llm.confidence >= 0.6 && llm.sourceType !== "unknown") {
    return { sourceType: llm.sourceType, source: "llm", llm };
  }

  // Weak legislation guesses (mid-title "חוק", no statute year / marker at the
  // start) may be overridden by a confident LLM verdict. Strong statute-shaped
  // matches are never overridden.
  if (
    isWeakLegislationGuess(rawText, regexType) &&
    llm.confidence >= 0.7 &&
    llm.sourceType !== "unknown"
  ) {
    return { sourceType: llm.sourceType, source: "llm", llm };

  }
  return { sourceType: regexType, source: "regex", llm };
}
