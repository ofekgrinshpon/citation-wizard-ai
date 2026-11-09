/**
 * "Which country is this?" — asked instead of guessing when a case has no
 * reliable country evidence (an Indian-style "(2010) 5 SCC 1", or a caption
 * that the US/UK search could not ground). Pure and in memory only: the
 * question is bound to the input fingerprint, and answering it is the user's
 * explicit choice of country for one new generation (no automatic search).
 */
import { inputFingerprint } from "@/lib/foreignCaseChoice";
import { escapeCitationLiteral } from "@/lib/citationSegments";
import type { QuickCountryId } from "@/lib/foreignQuickPick";

export interface CountryQuestionOption { id: QuickCountryId; label: string }
export interface CountryQuestion {
  version: 1;
  reason: "ambiguous_form" | "not_found";
  fingerprint: string;
  options: CountryQuestionOption[];
}

export const COUNTRY_QUESTION_OPTIONS: readonly CountryQuestionOption[] = [
  { id: "us", label: "ארצות הברית" },
  { id: "uk", label: "בריטניה" },
  { id: "ca", label: "קנדה" },
  { id: "au", label: "אוסטרליה" },
  { id: "other", label: "אחר" },
];

export const COUNTRY_QUESTION_TEXT: Record<CountryQuestion["reason"], string> = {
  ambiguous_form: "צורת האזכור משמשת ביותר ממדינה אחת (למשל SCC משמש גם בהודו), ולכן לא בוצע חיפוש. באיזו מדינה מדובר?",
  not_found: "לא נמצא פסק דין ששמות שני הצדדים בו תואמים בארה״ב או בבריטניה, ולכן לא הושלמו פרטים. באיזו מדינה מדובר?",
};
export const COUNTRY_OTHER_WARNING = "המדינה שנבחרה אינה נתמכת בהשלמה אוטומטית; הקלט נשמר כפי שהוא, ללא חיפוש.";

export function buildCountryQuestion(raw: string, reason: CountryQuestion["reason"]): CountryQuestion {
  return { version: 1, reason, fingerprint: inputFingerprint(raw), options: [...COUNTRY_QUESTION_OPTIONS] };
}

/** The reply shown with the buttons: the original input, kept as is, and the question. */
export function countryQuestionReply(raw: string, reason: CountryQuestion["reason"]): string {
  return `${escapeCitationLiteral(raw)}\n⚠️ ${COUNTRY_QUESTION_TEXT[reason]}`;
}

/** A question answers only the exact input it was asked about. */
export function countryQuestionCurrent(q: CountryQuestion, currentInput: string | undefined): boolean {
  return q.version === 1 && typeof currentInput === "string" && inputFingerprint(currentInput) === q.fingerprint;
}
