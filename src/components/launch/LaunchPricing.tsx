import { CITATION_CHECKOUT_NOT_OPEN, CITATION_OFFERS, CITATION_ONE_TIME_DISCLOSURE } from "@/lib/citationOffers";

export function LaunchPricing() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-3xl mx-auto">
        {CITATION_OFFERS.map(offer => (
          <article key={offer.id} className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-4">
            <h3 className="text-lg font-bold">{offer.label}</h3>
            <p className="text-3xl font-bold">{offer.priceLabel}</p>
            <p className="text-primary font-semibold">{offer.allowanceLabel}</p>
            <p className="text-sm text-muted-foreground">אזכור אחיד, ביבליוגרפיה והערות שוליים. מסלול תיקון DOCX בהכנה להשקה.</p>
            <p className="text-sm">תשלום חד־פעמי, ללא מנוי וללא חידוש אוטומטי.</p>
            {/* Presentation cannot activate billing, even if the catalog flag changes later. */}
            <button type="button" disabled className="mt-auto w-full rounded-xl border border-border bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground cursor-not-allowed">
              הרכישה עדיין לא נפתחה
            </button>
          </article>
        ))}
      </div>
      <div className="max-w-2xl mx-auto text-center text-sm text-muted-foreground space-y-2">
        <p>{CITATION_ONE_TIME_DISCLOSURE}</p>
        <p>המכסה המתוכננת נספרת לפי מקורות, לא לפי מסמכים.</p>
        <p>הורדה חוזרת או הטמעה של תוצאה קיימת לא אמורות לצרוך מקור נוסף.</p>
        <p>{CITATION_CHECKOUT_NOT_OPEN}</p>
      </div>
    </div>
  );
}
