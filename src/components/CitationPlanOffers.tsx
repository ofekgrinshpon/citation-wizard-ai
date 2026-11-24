import { useId } from "react";
import { CITATION_CHECKOUT_NOT_OPEN, CITATION_OFFERS, CITATION_ONE_TIME_DISCLOSURE, CITATION_UNIT_DISCLOSURE, type CitationOfferId } from '@/lib/citationOffers';
import { Button } from '@/components/ui/button';

/** Server readiness and authenticated purchase actions are supplied by the host. */
export function CitationPlanOffers({ enabled = false, busy = null, onPurchase }: { enabled?: boolean; busy?: CitationOfferId | null; onPurchase?: (offer: CitationOfferId) => void } = {}) {
  const unavailableNoteId = useId();
  return <div dir="rtl" className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">
      {CITATION_OFFERS.map(offer => <article key={offer.id} className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h3 className="font-bold text-foreground">{offer.label}</h3>
        <p className="text-2xl font-bold text-primary">{offer.priceLabel}</p>
        <p className="text-sm">{offer.allowanceLabel}</p>
        <p className="text-sm text-muted-foreground">אזכור אחיד, הערות שוליים וביבליוגרפיה — ללא כלי המחקר המשפטי.</p>
        <Button type="button" disabled={!enabled || !!busy || !onPurchase} aria-describedby={!enabled ? unavailableNoteId : undefined} className="w-full" onClick={() => onPurchase?.(offer.id)}>{busy === offer.id ? 'פותחים עמוד תשלום…' : enabled ? `רכישת ${offer.label}` : 'הרכישה עדיין לא נפתחה'}</Button>
      </article>)}
    </div>
    <p className="text-sm text-muted-foreground">{CITATION_ONE_TIME_DISCLOSURE}</p>
    <p className="text-sm text-muted-foreground">{CITATION_UNIT_DISCLOSURE}</p>
    {!enabled && <p id={unavailableNoteId} role="note" className="text-sm font-medium">{CITATION_CHECKOUT_NOT_OPEN}</p>}
  </div>;
}
