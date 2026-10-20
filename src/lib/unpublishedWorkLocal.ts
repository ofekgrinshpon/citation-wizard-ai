/**
 * Stage 5 batch 2 local-only formatter for an EFFECTIVE manuscript/thesis
 * type (detected or manual). Never a lookup or a source-accuracy assertion;
 * other types (incl. unsupported unpublished siblings) are never routed here.
 */
import { renderForeignDetection } from "@/data/bluebook";
import { extractUnpublishedWork, type UnpublishedKind } from "@/data/bluebook/unpublished";
import { escapeCitationLiteral } from "@/lib/citationSegments";
import type { SourceType } from "@/data/abbreviations";

const KIND: Partial<Record<SourceType, UnpublishedKind>> = {
  foreign_unpublished_manuscript: "unpublished_manuscript",
  foreign_thesis: "thesis",
};

export const UNPUBLISHED_NOT_VERIFIED = "האזכור עוצב לפי הפרטים שסופקו; זהות העבודה, המוסד והמאגר לא אומתו.";

export function renderUnpublishedLocal(sourceType: SourceType, raw: string) {
  const want = KIND[sourceType];
  if (!want || !raw.trim()) return null;
  const explicit = extractUnpublishedWork(raw);
  if (explicit && explicit.kind !== want) {
    // Selected kind contradicts the supplied label: preserve, do not cross.
    const warnings = ["הסוג שנבחר אינו תואם את סוג העבודה שצוין בקלט; האזכור נשמר כפי שסופק ולא עוצב."];
    const citation = escapeCitationLiteral(raw.trim());
    return { citation, warnings, missing: [] as string[], reply: `${citation}\n⚠️ ${warnings.join(" ")}`, warningMsg: warnings[0] };
  }
  const parsed = explicit ?? extractUnpublishedWork(raw, want);
  if (!parsed) return null;
  const rendered = renderForeignDetection({ kind: want, jurisdiction: "OTHER", fields: parsed.fields, sourceType, confidence: "deterministic" });
  if (!rendered) return null;
  const warnings = [...rendered.warnings];
  if (rendered.missing.length) warnings.push(`חסרים פרטים: ${rendered.missing.join(", ")}.`);
  warnings.push(UNPUBLISHED_NOT_VERIFIED);
  return { ...rendered, reply: `${rendered.citation}\n⚠️ ${warnings.join(" ")}`, warningMsg: warnings[0] };
}
