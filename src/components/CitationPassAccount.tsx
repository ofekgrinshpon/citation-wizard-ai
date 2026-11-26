import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useCitationCheckoutReady, useCitationPasses } from "@/hooks/useCitationPasses";
import { startCitationPassCheckout, type CitationPassStatus } from "@/lib/citationPassClient";
import { CITATION_OFFERS, type CitationOfferId } from "@/lib/citationOffers";
import { Button } from "@/components/ui/button";
import { CitationPlanOffers } from "@/components/CitationPlanOffers";
import { passSourcesRemaining, unexpiredSettledCitationPasses } from "@/lib/citationPassHeader";

const STATUS: Record<CitationPassStatus["status"], string> = {
  pending: "ממתינה לאישור תשלום", active: "החבילה פעילה", expired: "תוקף החבילה הסתיים", exhausted: "מכסת החבילה נוצלה",
};

type PassState = ReturnType<typeof useCitationPasses>;
const formatExpiry = (value: string) => new Date(value).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
const passOffer = (pass: CitationPassStatus) => CITATION_OFFERS.find(offer => offer.id === pass.offerId);

export function PurchasedCitationPassSummary({ passes }: { passes: CitationPassStatus[] }) {
  const current = unexpiredSettledCitationPasses(passes);
  if (!current.length) return null;
  const remaining = current.reduce((sum, pass) => sum + (pass.status === "active" ? passSourcesRemaining(pass) : 0), 0);
  const total = current.reduce((sum, pass) => sum + (passOffer(pass)?.sourceCount ?? 0), 0);
  return <div role="status" className="space-y-2 text-sm">
    <p className="font-semibold">נותרו {remaining} מתוך {total} מקורות בחבילות בתשלום</p>
    {current.length === 1 && current[0].expiresAt &&
      <p className="text-muted-foreground">בתוקף עד {formatExpiry(current[0].expiresAt)}</p>}
    <p className="text-muted-foreground">המכסה משותפת לאזכור מהיר, הערות שוליים ב־Word וביבליוגרפיה. החבילה אינה מתחדשת אוטומטית.</p>
  </div>;
}

export function CitationPassStatusList() {
  const { user } = useAuth();
  const state = useCitationPasses(user?.id);
  return user ? <CitationPassRows state={state} /> : null;
}

function CitationPassRows({ state: { passes, error, resolved, loading, refresh } }: { state: PassState }) {
  return <div className="space-y-3" aria-live="polite">
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-semibold">החבילות שלי</h3>
      <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={loading} aria-label="רענון מצב החבילות" title="רענון מצב החבילות"><RefreshCw className={loading ? "animate-spin" : ""} /></Button>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">לא ניתן לבדוק כעת את מצב החבילות. אין צורך לשלם שוב; אפשר לרענן את המצב.</p> :
      passes.length === 0 ? <p className="text-sm text-muted-foreground">{!resolved || loading ? "בודקים את מצב החבילות…" : "אין רכישות להצגה."}</p> :
        <ul className="divide-y divide-border">{passes.map(pass => {
          const offer = passOffer(pass);
          const status = pass.status !== "pending" && pass.expiresAt && Date.parse(pass.expiresAt) <= Date.now()
            ? "expired" : pass.status;
          return <li key={pass.id} className="py-3 space-y-1">
            <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{offer?.label}</span><span className={status === "active" ? "text-primary text-sm" : "text-muted-foreground text-sm"}>{STATUS[status]}</span></div>
            {pass.expiresAt && <p className="text-sm text-muted-foreground">בתוקף עד {formatExpiry(pass.expiresAt)}</p>}
            {status === "active" && offer && <p className="text-sm text-muted-foreground">נותרו {passSourcesRemaining(pass)} מתוך {offer.sourceCount} מקורות בחבילה זו</p>}
          </li>;
        })}</ul>}
  </div>;
}

export function CitationPassPurchaseOptions({ ready }: { ready: boolean }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState<CitationOfferId | null>(null);
  const purchase = async (offerId: CitationOfferId) => {
    if (!user || !ready || busy) return;
    setBusy(offerId);
    try { window.location.assign(await startCitationPassCheckout(offerId)); }
    catch { toast.error("לא ניתן לפתוח כרגע את עמוד התשלום. לא בוצע חיוב ב-ReLex."); setBusy(null); }
  };
  return <CitationPlanOffers enabled={ready && !!user} busy={busy} onPurchase={offerId => void purchase(offerId)} />;
}

export function CitationPassAccount({ state }: { state: PassState }) {
  const { user } = useAuth();
  const ready = useCitationCheckoutReady(user?.id);
  return <section dir="rtl" className="space-y-5 border-t border-border pt-6">
    {user && <CitationPassRows state={state} />}
    <h3 className="font-bold">רכישת חבילת אזכורים</h3>
    <CitationPassPurchaseOptions key={user?.id} ready={ready} />
  </section>;
}
