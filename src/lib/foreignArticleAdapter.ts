/** Pure request/response adaptation: no classifier, cache lookup, provider or billing calls. */
import type { SourceType } from "@/data/abbreviations";
import { detectForeignSource } from "@/data/bluebook/extract";
import { renderForeignDetection } from "@/data/bluebook";
import { getMissingFieldsSummary } from "@/lib/citationValidation";
import { articleFieldMatches, enrichArticleAuthors, parseForeignArticleInput } from "../../supabase/functions/_shared/foreignArticle";

export interface ForeignArticleRequest {
  enabled: true;
  /** Client can render all terminal article outcomes, including empty/conflict fields. */
  articleResponseVersion: 1;
  kind: "journal_article";
  jurisdiction: "OTHER";
  rawInput: string;
  parsedFields: Record<string, string>;
}

export interface ForeignArticleLookupResponse {
  identity?: { matched?: boolean; conflicts?: string[] };
  fields?: Record<string, string>;
  articleResolution?: "resolved" | "incomplete" | "conflict";
}

export function buildForeignArticleRequest(rawInput: string): ForeignArticleRequest {
  const parsedFields = parseForeignArticleInput(rawInput);
  const detection = detectForeignSource(rawInput);
  if (detection?.kind === "journal_article") {
    for (const [field, value] of Object.entries(detection.fields)) {
      if (typeof value === "string" && value.trim()) parsedFields[field] = value.trim();
    }
  }
  return { enabled: true, articleResponseVersion: 1, kind: "journal_article", jurisdiction: "OTHER", rawInput, parsedFields };
}

export function articleRequestFields(sourceType?: SourceType, rawInput?: string): {
  foreignLookup?: ForeignArticleRequest;
  rawInput?: string;
} {
  if (!rawInput) return {};
  if (sourceType === "foreign_journal_article") return { foreignLookup: buildForeignArticleRequest(rawInput) };
  if (sourceType === "article") return { rawInput };
  return {};
}

export function renderForeignArticleLookup(
  request: Pick<ForeignArticleRequest, "parsedFields">,
  result?: ForeignArticleLookupResponse | null,
): { citation: string; reply: string; status: "valid" | "warning"; warningMsg?: string } | null {
  if (!result?.fields || !(result.articleResolution || (result.identity?.matched && Object.keys(result.fields).length))) return null;
  const fields = { ...result.fields, ...request.parsedFields };
  if (result.identity?.matched && result.articleResolution !== "conflict") {
    fields.authors = enrichArticleAuthors(request.parsedFields.authors, result.fields.authors);
  }
  const rendered = renderForeignDetection({
    sourceType: "foreign_journal_article", kind: "journal_article", jurisdiction: "OTHER",
    confidence: "deterministic", fields,
  });
  if (!rendered) return null;
  const warnings = [...rendered.warnings];
  if (result.articleResolution === "conflict" || result.identity?.conflicts?.length) {
    warnings.push("נמצאו פרטי פרסום סותרים; נשמרו הפרטים שסיפקתם ורק השלמות תואמות למאמר.");
  }
  if (rendered.missing.length) warnings.push(`חסרים פרטים: ${getMissingFieldsSummary("foreign_journal_article", rendered.missing)}`);
  return {
    citation: rendered.citation,
    reply: warnings.length ? `${rendered.citation}\n⚠️ ${warnings.join(" ")}` : rendered.citation,
    status: warnings.length || rendered.missing.length ? "warning" : "valid",
    warningMsg: warnings[0],
  };
}

export function mergeForeignArticleCache(rawInput: string, fullCitation: string): string | null {
  const supplied = parseForeignArticleInput(rawInput);
  if (!supplied.articleTitle) return null;
  const cached = detectForeignSource(fullCitation);
  if (cached?.kind !== "journal_article") return null;
  const fields = cached.fields as unknown as Record<string, string>;
  if (!Object.entries(supplied).every(([field, value]) =>
    field === "pinpoint" || (fields[field] && articleFieldMatches(field, value, fields[field])))) return null;
  const rendered = renderForeignDetection({ ...cached, fields: {
    ...cached.fields, ...supplied, pinpoint: supplied.pinpoint,
    authors: enrichArticleAuthors(supplied.authors, fields.authors),
  } });
  return rendered && !rendered.missing.length ? rendered.citation : null;
}

/** Preserve the existing candidate object shape and non-article behavior. */
export function compatibleArticleCache<T extends { full_citation: string }>(sourceType: SourceType, rawInput: string, candidate: T | null): T | null {
  if (!candidate) return null;
  if (sourceType === "article") return null;
  if (sourceType !== "foreign_journal_article") return candidate;
  const citation = mergeForeignArticleCache(rawInput, candidate.full_citation);
  return citation ? { ...candidate, full_citation: citation } : null;
}
