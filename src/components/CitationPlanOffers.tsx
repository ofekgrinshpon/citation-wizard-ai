import { useId } from "react";
import { CitationManualBaseBuyerStatus, useCitationManualBaseBuyer } from "./CitationManualBaseBuyer";
import { CITATION_CHECKOUT_NOT_OPEN, CITATION_OFFERS, CITATION_ONE_TIME_DISCLOSURE, CITATION_UNIT_DISCLOSURE } from '@/lib/citationOffers';

/** No direct checkout URL or entitlement write. Manual requests are opt-in. */
export function CitationPlanOffers() {
  const unavailableNoteId = useId();
  const enabled = import.meta.env.VITE_TAKBULL_MANUAL_BASE_BUYER === "true";
  const buyer = useCitationManualBaseBuyer(enabled);
  return <div dir="rtl" className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      {CITATION_OFFERS.map(offer => <article key={offer.id} className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="font-bold text-foreground">{offer.label}</h3>
        <p className="text-2xl font-bold text-primary">{offer.priceLabel}</p>
        <p className="text-sm">{offer.allowanceLabel}</p>
        <p className="text-sm text-muted-foreground">אזכור אחיד, הערות שוליים וביבליוגרפיה — ללא כלי המחקר המשפטי.</p>
        {enabled ? <button type="button" disabled={!buyer.canRequest} onClick={() => void buyer.request(offer.id)}
          className="w-full rounded-lg border p-2 text-sm disabled:opacity-60" aria-label={`בקש קישור תשלום עבור ${offer.label}`}>
          בקש קישור לתשלום
        </button> : <button type="button" disabled aria-describedby={unavailableNoteId} className="w-full rounded-lg border p-2 text-sm opacity-60 cursor-not-allowed" aria-label={`רכישת ${offer.label} עדיין אינה זמינה`}>הרכישה עדיין לא נפתחה</button>}
      </article>)}
    </div>
    <p className="text-sm text-muted-foreground">{CITATION_ONE_TIME_DISCLOSURE}</p>
    <p className="text-sm text-muted-foreground">{enabled ? "המכסה נספרת לפי מקור חדש שנבדק, ולא לפי מסמך. שימוש חוזר באותה תוצאה קיימת אינו מחייב בדיקה חדשה." : CITATION_UNIT_DISCLOSURE}</p>
    {enabled ? <CitationManualBaseBuyerStatus state={buyer} /> : <p id={unavailableNoteId} role="note" className="text-sm font-medium">{CITATION_CHECKOUT_NOT_OPEN}</p>}
  </div>;
}
