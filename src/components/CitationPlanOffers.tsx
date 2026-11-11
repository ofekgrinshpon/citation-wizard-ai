import { useId } from "react";
import { CITATION_CHECKOUT_NOT_OPEN, CITATION_OFFERS, CITATION_ONE_TIME_DISCLOSURE, CITATION_UNIT_DISCLOSURE } from '@/lib/citationOffers';

/** Informational only: intentionally no checkout handler or entitlement writes. */
export function CitationPlanOffers() {
  const unavailableNoteId = useId();
  return <div dir="rtl" className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      {CITATION_OFFERS.map(offer => <article key={offer.id} className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="font-bold text-foreground">{offer.label}</h3>
        <p className="text-2xl font-bold text-primary">{offer.priceLabel}</p>
        <p className="text-sm">{offer.allowanceLabel}</p>
        <p className="text-sm text-muted-foreground">אזכור אחיד, הערות שוליים וביבליוגרפיה — ללא כלי המחקר המשפטי.</p>
        <button type="button" disabled aria-describedby={unavailableNoteId} className="w-full rounded-lg border p-2 text-sm opacity-60 cursor-not-allowed" aria-label={`רכישת ${offer.label} עדיין אינה זמינה`}>הרכישה עדיין לא נפתחה</button>
      </article>)}
    </div>
    <p className="text-sm text-muted-foreground">{CITATION_ONE_TIME_DISCLOSURE}</p>
    <p className="text-sm text-muted-foreground">{CITATION_UNIT_DISCLOSURE}</p>
    <p id={unavailableNoteId} role="note" className="text-sm font-medium">{CITATION_CHECKOUT_NOT_OPEN}</p>
  </div>;
}
