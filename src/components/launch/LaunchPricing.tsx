import { CITATION_CHECKOUT_NOT_OPEN, CITATION_OFFERS, CITATION_ONE_TIME_DISCLOSURE } from "@/lib/citationOffers";
import { Button } from "@/components/ui/button";

export function LaunchPricing({ enabled = false, onSignIn }: { enabled?: boolean; onSignIn?: () => void } = {}) {
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
            <Button type="button" disabled={!enabled || !onSignIn} className="mt-auto w-full" onClick={onSignIn}>
              {enabled ? 'כניסה לרכישה' : 'הרכישה עדיין לא נפתחה'}
            </Button>
          </article>
        ))}
      </div>
      <div className="max-w-2xl mx-auto text-center text-sm text-muted-foreground space-y-2">
        <p>{CITATION_ONE_TIME_DISCLOSURE}</p>
        <p>המכסה המתוכננת נספרת לפי מקורות, לא לפי מסמכים.</p>
        <p>הורדה חוזרת או הטמעה של תוצאה קיימת לא אמורות לצרוך מקור נוסף.</p>
        {!enabled && <p>{CITATION_CHECKOUT_NOT_OPEN}</p>}
      </div>
    </div>
  );
}
