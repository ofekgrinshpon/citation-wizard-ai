/**
 * Stage 5 batch 3 local-only formatter shared by runCitation and Index chat.
 * Routes ONLY the effective nonconsecutive article (foreign_journal_article)
 * and print newspaper (foreign_newspaper) types; generic/unsupported foreign
 * types holding a periodical-shaped input are preserved with a warning and
 * never formatted. Never a lookup or a source-identity assertion.
 */
import { renderForeignDetection } from "@/data/bluebook";
import { extractPeriodical } from "@/data/bluebook/periodical";
import { escapeCitationLiteral } from "@/lib/citationSegments";
import type { SourceType } from "@/data/abbreviations";

export const PERIODICAL_NOT_VERIFIED = "האזכור עוצב לפי הפרטים שסופקו; זהות הפרסום, התאריך והעמודים לא אומתו.";
export const PERIODICAL_AMBIGUOUS = "לא ניתן לקבוע בבטחה אם זה מאמר בכתב עת/מגזין או כתבה בעיתון; האזכור נשמר כפי שסופק. ניתן לבחור תת־סוג ידנית.";
export const PERIODICAL_MISMATCH = "הסוג שנבחר אינו תואם את מבנה הקלט (תאריך/מקום/מדור); האזכור נשמר כפי שסופק ולא עוצב.";
export const PERIODICAL_UNSUPPORTED = "מבנה הקלט אינו נתמך בתבנית העיתון המודפס; האזכור נשמר כפי שסופק ולא עוצב.";

export const PERIODICAL_AUTHOR_AMBIGUOUS = "לא ניתן לקבוע בבטחה אם החלק שלפני הפסיק הראשון הוא שם מחבר או חלק מהכותרת; האזכור נשמר כפי שסופק ולא עוצב. בחירת תת־סוג אינה פותרת עמימות זו.";

function preserve(raw: string, warning: string) {
  const citation = escapeCitationLiteral(raw.trim());
  return { citation, warnings: [warning], missing: [] as string[], reply: `${citation}\n⚠️ ${warning}`, warningMsg: warning };
}

export function renderPeriodicalLocal(sourceType: SourceType, raw: string) {
  if (!raw.trim()) return null;
  if (sourceType !== "foreign_journal_article" && sourceType !== "foreign_newspaper" && sourceType !== "foreign") return null;
  const p = extractPeriodical(raw);
  if (p?.authorTitleAmbiguous) return preserve(raw, PERIODICAL_AUTHOR_AMBIGUOUS);
  if (sourceType === "foreign") return p ? preserve(raw, PERIODICAL_AMBIGUOUS) : null;
  if (sourceType === "foreign_journal_article") {
    if (!p) return null; // Existing consecutive-pagination path.
    if (p.newspaperSignal) return preserve(raw, PERIODICAL_MISMATCH);
  } else {
    if (!p) return preserve(raw, PERIODICAL_UNSUPPORTED);
    if (p.articleSignal) return preserve(raw, PERIODICAL_MISMATCH);
  }
  const kind = sourceType === "foreign_newspaper" ? "newspaper" : "journal_article";
  const fields = kind === "journal_article" ? { ...p.fields, nonconsecutive: true as const } : p.fields;
  const rendered = renderForeignDetection({ kind, jurisdiction: "OTHER", fields, sourceType, confidence: "deterministic" });
  if (!rendered) return null;
  const warnings = [...rendered.warnings];
  if (rendered.missing.length) warnings.push(`חסרים פרטים: ${rendered.missing.join(", ")}.`);
  warnings.push(PERIODICAL_NOT_VERIFIED);
  return { ...rendered, reply: `${rendered.citation}\n⚠️ ${warnings.join(" ")}`, warningMsg: warnings[0] };
}
