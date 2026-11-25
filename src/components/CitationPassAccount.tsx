import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useCitationCheckoutReady, useCitationPasses } from "@/hooks/useCitationPasses";
import { startCitationPassCheckout, type CitationPassStatus } from "@/lib/citationPassClient";
import { CITATION_OFFERS, type CitationOfferId } from "@/lib/citationOffers";
import { Button } from "@/components/ui/button";
import { CitationPlanOffers } from "@/components/CitationPlanOffers";
import { PERIOD_LEVEL_LABEL, usageLevel } from "@/hooks/useUsage";

const STATUS: Record<CitationPassStatus["status"], string> = {
  pending: "ממתינה לאישור תשלום", active: "החבילה פעילה", expired: "תוקף החבילה הסתיים", exhausted: "מכסת החבילה נוצלה",
};

export function CitationPassStatusList() {
  const { user } = useAuth();
  const { passes, error, loading, refresh } = useCitationPasses(user?.id);
  if (!user) return null;
  return <div className="space-y-3" aria-live="polite">
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-semibold">החבילות שלי</h3>
      <Button variant="ghost" size="icon" onClick={() => void refresh()} disabled={loading} aria-label="רענון מצב החבילות" title="רענון מצב החבילות"><RefreshCw className={loading ? "animate-spin" : ""} /></Button>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">לא ניתן לבדוק כעת את מצב החבילות. אין צורך לשלם שוב; אפשר לרענן את המצב.</p> :
      passes.length === 0 ? <p className="text-sm text-muted-foreground">{loading ? "בודקים את מצב החבילות…" : "אין רכישות להצגה."}</p> :
        <ul className="divide-y divide-border">{passes.map(pass => {
          const offer = CITATION_OFFERS.find(o => o.id === pass.offerId);
          return <li key={pass.id} className="py-3 space-y-1">
            <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{offer?.label}</span><span className={pass.status === "active" ? "text-primary text-sm" : "text-muted-foreground text-sm"}>{STATUS[pass.status]}</span></div>
            {pass.expiresAt && <p className="text-sm text-muted-foreground">בתוקף עד {new Date(pass.expiresAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}</p>}
            {pass.status === "active" && <p className="text-sm text-muted-foreground">{PERIOD_LEVEL_LABEL[usageLevel(pass.usedRatio)]}</p>}
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

export function CitationPassAccount() {
  const { user } = useAuth();
  const ready = useCitationCheckoutReady(user?.id);
  return <section dir="rtl" className="space-y-5 border-t border-border pt-6">
    <CitationPassStatusList />
    <h3 className="font-bold">רכישת חבילת אזכורים</h3>
    <CitationPassPurchaseOptions key={user?.id} ready={ready} />
  </section>;
}
