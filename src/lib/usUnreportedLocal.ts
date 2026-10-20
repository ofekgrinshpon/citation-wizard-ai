/** D1a local-only formatting; never a lookup or source-accuracy assertion. */
import { renderForeignCitation } from "@/data/bluebook";
import type { ForeignCaseFields } from "@/data/bluebook/types";
import type { SourceType } from "@/data/abbreviations";

export function renderUsUnreportedLocal(sourceType: SourceType, raw: string) {
  // An effective non-US/other-family override must not be crossed by detection.
  if (sourceType !== "foreign_case_us") return null;
  const rendered = renderForeignCitation(raw);
  if (!rendered || rendered.detection.jurisdiction !== "US" || rendered.detection.kind !== "case" ||
      !(rendered.detection.fields as ForeignCaseFields).opinionFormat) return null;
  const warnings = [...rendered.warnings];
  if (rendered.missing.length) warnings.push(`חסרים פרטים: ${rendered.missing.join(", ")}.`);
  // Keeps chat's existing verification guard from treating formatting as identity proof.
  warnings.push("האזכור עוצב לפי הפרטים שסופקו; זהות המקור ודיוקו לא אומתו.");
  return { ...rendered, reply: `${rendered.citation}\n⚠️ ${warnings.join(" ")}`, warningMsg: warnings[0] };
}