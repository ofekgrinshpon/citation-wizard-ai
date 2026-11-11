/** Selected ONE-TIME citation passes, NOT active account plans or payment product IDs.
 * Prices, currency and source counts come from the shared server catalogue.
 * Keep legacy PLANS unchanged. Checkout and entitlement activation stay disabled
 * until authoritative, verified payment confirmation exists.
 */
import { CITATION_PASS_OFFERS, type CitationPassOfferId } from "../../supabase/functions/_shared/citationPassOffers.ts";

const PRESENTATION: Record<CitationPassOfferId, { label: string; termLabel: string }> = {
  citation_week_pass_v1: { label: 'אזכורים — 7 ימים', termLabel: 'ל־7 ימים' },
  citation_month_pass_v1: { label: 'אזכורים — חודש', termLabel: 'לחודש קלנדרי אחד' },
};

export const CITATION_OFFERS = CITATION_PASS_OFFERS.map(offer => ({
  ...offer,
  label: PRESENTATION[offer.id].label,
  priceLabel: `₪${offer.priceIls} בתשלום חד־פעמי`,
  allowanceLabel: `${offer.sourceCount} מקורות ${PRESENTATION[offer.id].termLabel}`,
}));
export type CitationOfferId = CitationPassOfferId;
export const CITATION_CHECKOUT_ENABLED = false;
export const CITATION_ONE_TIME_DISCLOSURE = 'תשלום חד־פעמי בלבד — ללא מנוי וללא חידוש אוטומטי, ולא יבוצע חיוב נוסף בתום התקופה. חודש הוא חודש קלנדרי, ולא 30 ימים קבועים. המסלולים מיועדים לאזכורים בלבד.';
export const CITATION_CHECKOUT_NOT_OPEN = 'הרכישה עדיין לא נפתחה: לא ניתן לשלם באתר בשלב זה ולא מתבצע חיוב. תנאי מסלול קיים בחשבון אינם משתנים.';
export const CITATION_UNIT_DISCLOSURE = 'המכסה נספרת לפי מקור שנשלח לבדיקה, ולא לפי מסמך. הורדה או הטמעה חוזרת של תוצאה קיימת אינן צורכות מקור נוסף. תוצאה מקומית או שמורה שאינה מחייבת בדיקה חדשה אינה צורכת יחידה.';
