/**
 * Friendly foreign-source menu: a short list of everyday source kinds and,
 * for case law / legislation, a country. Every choice maps to an exact
 * override on the shared classification (`foreignClassification.ts`), so the
 * routing, support report and generation plan stay the single source of
 * truth. Pure and local — no network, no model text.
 */
import type { ClassificationOverrides, EffectiveClassification } from "@/lib/foreignClassification";
import { UK_ID, US_ROOT_ID, getEntity, isUnder } from "@/data/bluebook/classification/entities";
import { familyLabel, subtypeLabel } from "@/data/bluebook/classification/taxonomy";

export type QuickKindId =
  | "case" | "statute" | "book" | "chapter" | "article" | "newspaper" | "web" | "thesis" | "treaty";
export type QuickCountryId = "us" | "uk" | "ca" | "au" | "other";

export interface QuickKind { id: QuickKindId; label: string; icon: string; family: string; subtype: string; needsCountry: boolean }
export interface QuickCountry { id: QuickCountryId; label: string; jurisdiction: string | null; note?: string }

export const QUICK_KINDS: readonly QuickKind[] = [
  { id: "case", label: "פסיקה", icon: "⚖️", family: "decision", subtype: "decision.judgment", needsCountry: true },
  { id: "statute", label: "חקיקה", icon: "📜", family: "normative_instrument", subtype: "normative_instrument.statute", needsCountry: true },
  { id: "book", label: "ספר", icon: "📕", family: "nonperiodical", subtype: "nonperiodical.book", needsCountry: false },
  { id: "chapter", label: "פרק בספר ערוך", icon: "📖", family: "collection_component", subtype: "collection_component.chapter", needsCountry: false },
  { id: "article", label: "מאמר בכתב עת", icon: "📰", family: "periodical", subtype: "periodical.article", needsCountry: false },
  { id: "newspaper", label: "כתבה בעיתון", icon: "🗞️", family: "periodical", subtype: "periodical.newspaper", needsCountry: false },
  { id: "web", label: "מקור אינטרנט", icon: "🌐", family: "web_native", subtype: "web_native.page", needsCountry: false },
  { id: "thesis", label: "עבודת גמר או דוקטורט", icon: "🎓", family: "unpublished_communication", subtype: "unpublished_communication.thesis", needsCountry: false },
  { id: "treaty", label: "אמנה בין־לאומית", icon: "🤝", family: "treaty", subtype: "treaty.agreement", needsCountry: false },
];

const LOCAL_ONLY_NOTE = "עיצוב והשלמת פרטים מהרשת לתבניות מסוימות בלבד (פסקי דין של בתי המשפט העליונים והפדרליים וחקיקה פדרלית). יש לבדוק ידנית.";
export const QUICK_COUNTRIES: readonly QuickCountry[] = [
  { id: "us", label: "ארצות הברית", jurisdiction: US_ROOT_ID },
  { id: "uk", label: "בריטניה", jurisdiction: UK_ID },
  { id: "ca", label: "קנדה", jurisdiction: "t2:canada", note: LOCAL_ONLY_NOTE },
  { id: "au", label: "אוסטרליה", jurisdiction: "t2:australia", note: LOCAL_ONLY_NOTE },
  { id: "other", label: "מדינה אחרת או בין־לאומי", jurisdiction: null, note: "יעוצב כמקור לועזי כללי. יש לבדוק ידנית." },
];

export const quickKind = (id: QuickKindId) => QUICK_KINDS.find((k) => k.id === id)!;

/** The exact override a friendly choice stands for. Country only for case law / legislation. */
export function quickOverride(kind: QuickKindId, country?: QuickCountryId): ClassificationOverrides {
  const k = quickKind(kind);
  const scalars: NonNullable<ClassificationOverrides["scalars"]> = { family: k.family, subtype: k.subtype };
  if (k.needsCountry) {
    const c = QUICK_COUNTRIES.find((x) => x.id === country);
    if (!c) throw new Error("country required");
    scalars.jurisdiction = c.jurisdiction;
  }
  return { scalars };
}

/** Which friendly kind (if any) the effective classification currently is. */
export function quickKindOf(e: EffectiveClassification): QuickKindId | null {
  if (e.otherUnidentified) return null;
  const sub = e.scalars.subtype;
  const hit = QUICK_KINDS.find((k) => k.subtype === sub);
  if (hit) return hit.id;
  if (!sub && e.scalars.family === "decision") return "case";
  return null;
}

const COUNTRY_ROOTS: [QuickCountryId, string][] = [["us", US_ROOT_ID], ["uk", UK_ID], ["ca", "t2:canada"], ["au", "t2:australia"]];

/** Which friendly country the effective jurisdiction falls under; "other" when none is set or it is elsewhere. */
export function quickCountryOf(e: EffectiveClassification): QuickCountryId {
  const jur = e.scalars.subjurisdiction ?? e.scalars.jurisdiction;
  if (!jur) return "other";
  return COUNTRY_ROOTS.find(([, root]) => isUnder(jur, root))?.[0] ?? "other";
}

const HEBREW_PLACE: Record<string, string> = { [US_ROOT_ID]: "ארצות הברית", [UK_ID]: "בריטניה", "t2:canada": "קנדה", "t2:australia": "אוסטרליה" };

/** Short, everyday summary line ("פסיקה · בריטניה"); falls back to the full taxonomy labels. */
export function friendlySummary(e: EffectiveClassification): string {
  if (e.otherUnidentified || !e.scalars.family) return "אחר / לא זוהה";
  const kind = quickKindOf(e);
  const sub = getEntity(e.scalars.subjurisdiction);
  const jurId = e.scalars.jurisdiction;
  const place = sub?.name ?? (jurId ? HEBREW_PLACE[jurId] ?? getEntity(jurId)?.name : undefined);
  const head = kind ? [quickKind(kind).label] : [familyLabel(e.scalars.family), subtypeLabel(e.scalars.subtype)];
  return [...head, place].filter(Boolean).join(" · ");
}
