import { readGroundedHebrewJournalResultType } from "../../supabase/functions/_shared/hebrewArticleValidation";
import { SOURCE_TYPE_LABELS, type SourceType } from "@/data/abbreviations";
import { citationTextOnly } from "@/lib/citationSegments";

/** Classify the displayed citation, not explanations or the original routing label. */
export function getCitationResultType(requested: SourceType, extractedCitation: string) {
  const citation = citationTextOnly(extractedCitation).trim();
  const published =
    requested === "case_law_database" &&
    /^[א-ת]{1,4}["״׳']+[א-ת]{1,3}\s+\d+[/\-]\d+/.test(citation) &&
    /[,\s](?:פ["״]ד|פד["״]ע|פ["״]מ)\s+(?:[א-ת]+[׳']?|\d+)(?:\s*\(\d+\))?\s+\d+\b/.test(citation);
  const type = published ? "case_law_published" : requested;
  return { type, label: type === "unknown" ? null : SOURCE_TYPE_LABELS[type] };
}


/** The book guess only yields to the server's bound, evidence-checked result. */
export function getGroundedJournalType(requested: SourceType | undefined, rawInput: string, response: Record<string, unknown> | null | undefined): "article" | undefined {
  if (requested !== "book" || typeof response?.content !== "string") return;
  return readGroundedHebrewJournalResultType(response.groundedJournalResultType, rawInput, response.content) ?? undefined;
}
