import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CITATION_OFFERS, type CitationOfferId } from "@/lib/citationOffers";

type OrderStatus = {
  order_id?: string; offer?: CitationOfferId; status: string;
  sources_included?: number | null; sources_remaining?: number | null; expires_at?: string | null;
};
const closed = new Set(["none", "refunded", "expired", "cancelled"]);
const labels: Record<string, string> = {
  requested: "הבקשה התקבלה. עדיין לא בוצע חיוב.",
  demand_issued: "דרישת התשלום הונפקה בתקבול. יש לבדוק את האימייל לקבלת קישור התשלום.",
  active: "התשלום אומת והחבילה פעילה.",
  expired: "תוקף החבילה הסתיים.",
  refunded: "החזר התשלום נרשם.",
  cancelled: "הבקשה בוטלה.",
  reconcile: "התשלום נרשם אך החבילה טרם הופעלה. הבקשה בבדיקה.",
};

export function useCitationManualBaseBuyer(enabled: boolean) {
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async (offer?: CitationOfferId, active = () => true) => {
    if (!enabled) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: failure } = await supabase.functions.invoke("takbull-manual-base", {
        body: offer ? { action: "request", offer } : { action: "status" },
      });
      if (!active()) return;
      if (failure || data?.ok !== true || typeof data.status !== "string") {
        setError(data?.code === "ALREADY_ACTIVE" ? "כבר קיימת חבילה פעילה בחשבון." : "לא התקבל אישור לבקשה. אפשר לרענן את הסטטוס.");
        return;
      }
      setOrder(data);
    } catch {
      if (active()) setError("לא התקבל אישור לבקשה. אפשר לרענן את הסטטוס.");
    } finally { if (active()) setBusy(false); }
  };
  useEffect(() => {
    let mounted = true;
    if (enabled) void load(undefined, () => mounted);
    return () => { mounted = false; };
    // Intentionally don't reload after changing local order state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return { order, busy, error, refresh: () => load(), request: (offer: CitationOfferId) => load(offer),
    canRequest: !!order && closed.has(order.status) && !busy };
}

export function CitationManualBaseBuyerStatus({ state }: { state: ReturnType<typeof useCitationManualBaseBuyer> }) {
  const { order, busy, error, refresh } = state;
  const offer = CITATION_OFFERS.find((item) => item.id === order?.offer);
  return <section className="space-y-2 rounded border p-3" aria-label="סטטוס בקשת תשלום">
    <p className="text-sm">בקשת קישור אינה מחייבת בתשלום. החבילה מתחילה בהפעלה לאחר אימות תשלום.</p>
    {offer && <p className="text-sm">{offer.label} · {offer.priceLabel}</p>}
    <p aria-live="polite" className="text-sm">{error || (order && labels[order.status]) || (busy ? "טוען סטטוס…" : "")}</p>
    {order?.status === "active" && order.sources_remaining != null && order.sources_included != null &&
      <p className="text-sm font-bold">נותרו {order.sources_remaining} מתוך {order.sources_included} מקורות</p>}
    {order?.status === "active" && order.expires_at &&
      <p className="text-sm">בתוקף עד {new Date(order.expires_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}</p>}
    <button type="button" disabled={busy} onClick={() => void refresh()} className="rounded border p-2 text-sm">רענן סטטוס</button>
  </section>;
}
