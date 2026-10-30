/** Selected future offers, NOT active account plans or payment product IDs.
 * Keep legacy PLANS unchanged. Checkout and entitlement activation are disabled
 * until authoritative paid-cycle events and citation-only server gates exist.
 */
export const CITATION_OFFERS = [
  { id: 'citation_weekly_v1', label: 'אזכורים — שבועי', priceIls: 39, sourceUnits: 100,
    interval: 'week', intervalCount: 1, priceLabel: '₪39 לשבוע', allowanceLabel: '100 מקורות בכל מחזור שבועי' },
  { id: 'citation_monthly_v1', label: 'אזכורים — חודשי', priceIls: 65, sourceUnits: 250,
    interval: 'month', intervalCount: 1, priceLabel: '₪65 לחודש', allowanceLabel: '250 מקורות בכל מחזור חודשי' },
] as const;
export type CitationOfferId = typeof CITATION_OFFERS[number]['id'];
export const CITATION_CHECKOUT_ENABLED = false;
export const CITATION_RENEWAL_DISCLOSURE = 'המסלולים מיועדים לאזכורים בלבד ומתחדשים אוטומטית עד לביטול. המחזור החודשי הוא חודש קלנדרי ממועד החיוב, ולא 30 ימים קבועים.';
export const CITATION_UNIT_DISCLOSURE = 'המכסה נספרת לפי מקור שנשלח לבדיקה, ולא לפי מסמך. הורדה או הטמעה חוזרת של תוצאה קיימת אינן צורכות מקור נוסף. תוצאה מקומית או שמורה שאינה מחייבת בדיקה חדשה אינה צורכת יחידה.';
