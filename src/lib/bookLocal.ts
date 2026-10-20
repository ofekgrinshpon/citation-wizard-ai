/**
 * Stage 5 batch 4 local-only formatter (R15.1–15.4(a), R15.5.1(a)) shared by
 * runCitation and Index chat. Formats ONLY the effective foreign_book /
 * foreign_book_chapter types; mismatched manual choices, ambiguous input and
 * unsupported siblings (generic foreign) are preserved with a warning.
 * Never a lookup or a source-identity assertion.
 */
import { renderForeignDetection } from "@/data/bluebook";
import { extractBookWork, type BookWorkParse } from "@/data/bluebook/bookWorks";
import { escapeCitationLiteral } from "@/lib/citationSegments";
import type { SourceType } from "@/data/abbreviations";

export const BOOK_NOT_VERIFIED = "האזכור עוצב לפי הפרטים שסופקו; זהות הספר, המהדורה והעמודים לא אומתו.";
export const BOOK_PRESERVE: Record<NonNullable<BookWorkParse["preserve"]>, string> = {
  ambiguous_pinpoint: "לא ניתן לקבוע אם המספר שבסוף הכותרת הוא חלק מהכותרת או עמוד מצוטט; האזכור נשמר כפי שסופק. לעמוד מצוטט יש להוסיף \", at\" לפניו.",
  ambiguous_author: "לא ניתן לקבוע בבטחה את הגבול בין שם המחבר לכותרת הפרק; האזכור נשמר כפי שסופק. ניתן לסמן במפורש \"Author: …; Chapter: …; In: …\".",
  publisher_unknown: "סופק מו״ל אך לא צוין אם זו מהדורה שאינה של המו״ל המקורי; האזכור נשמר כפי שסופק ולא עוצב. ניתן לציין \"Publisher status: non-original\".",
  pre1900: "מהדורה שלפני 1900 (מקום ומו״ל) אינה נתמכת בשלב זה; האזכור נשמר כפי שסופק ולא עוצב.",
};
export const BOOK_MISMATCH = "הסוג שנבחר (ספר/פרק בספר) אינו תואם את מבנה הקלט; האזכור נשמר כפי שסופק ולא עוצב.";
export const BOOK_UNSUPPORTED = "תת־הסוג שנבחר אינו נתמך בתבנית הספר/הפרק; האזכור נשמר כפי שסופק ולא עוצב.";

function preserve(raw: string, warning: string) {
  const citation = escapeCitationLiteral(raw.trim());
  return { citation, warnings: [warning], missing: [] as string[], reply: `${citation}\n⚠️ ${warning}`, warningMsg: warning };
}

export function renderBookLocal(sourceType: SourceType, raw: string) {
  if (!raw.trim()) return null;
  if (sourceType !== "foreign_book" && sourceType !== "foreign_book_chapter" && sourceType !== "foreign") return null;
  const p = extractBookWork(raw);
  if (!p) return null; // Existing paths unchanged.
  if (sourceType === "foreign") {
    if (!p.signal) return null;
    return preserve(raw, p.preserve ? BOOK_PRESERVE[p.preserve] : BOOK_UNSUPPORTED);
  }
  if ((sourceType === "foreign_book") !== (p.kind === "book")) return preserve(raw, BOOK_MISMATCH);
  if (p.preserve) return preserve(raw, BOOK_PRESERVE[p.preserve]);
  const kind = p.kind === "book" ? "book" : "book_chapter";
  const rendered = renderForeignDetection({ kind, jurisdiction: "OTHER", fields: p.fields, sourceType, confidence: "deterministic" });
  if (!rendered) return null;
  const warnings = [...rendered.warnings];
  if (rendered.missing.length) warnings.push(`חסרים פרטים: ${rendered.missing.join(", ")}.`);
  warnings.push(BOOK_NOT_VERIFIED);
  return { ...rendered, reply: `${rendered.citation}\n⚠️ ${warnings.join(" ")}`, warningMsg: warnings[0] };
}
