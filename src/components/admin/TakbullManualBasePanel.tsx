import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Row = { order_id: string; user_id: string; offer_id: string; amount_minor: number;
  demand_ref: string | null; paid_at: string | null; activated_at: string | null;
  expires_at: string | null; refunded_at: string | null; unfulfilled_reason: string | null; cancelled_at: string | null };
type Action = "issue" | "settle" | "refund";

export default function TakbullManualBasePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [order, setOrder] = useState("");
  const [action, setAction] = useState<Action>("issue");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = rows.find((r) => r.order_id === order);

  const refresh = async () => {
    const { data, error } = await supabase.functions.invoke("takbull-manual-base", { body: { action: "queue" } });
    if (error || !Array.isArray(data)) throw new Error("queue");
    setRows(data);
  };
  const fetchOrders = async () => {
    setBusy(true);
    try { await refresh(); setStatus(""); } catch { setStatus("לא ניתן לטעון את תור התשלומים."); }
    finally { setBusy(false); }
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selected || busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const read = (name: string) => String(data.get(name) ?? "").trim();
    if (read("observedOrder").toLowerCase() !== selected.order_id.toLowerCase()) {
      setStatus("מזהה ההזמנה מתקבול לא תואם להזמנה שנבחרה."); return;
    }
    setBusy(true);
    try {
      const out = await supabase.functions.invoke("takbull-manual-base", { body: {
        action, order: read("observedOrder"), merchant: read("merchant"), demand: read("demand"),
        transaction: read("transaction"), document: read("document"), refund: read("refund"),
        amountMinor: Number(read("amount")) * 100, currency: "ILS", at: read("at"), attest: data.has("attest"),
      }});
      if (out.error || out.data?.ok !== true) {
        setStatus("הפעולה לא אושרה. בדקו הרשאות והתאמה לנתוני תקבול."); return;
      }
      setStatus(action === "settle"
        ? out.data.fulfilled === true ? `החבילה פעילה עד ${new Date(out.data.expires_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}.`
          : "התשלום נרשם אך לא ניתנה גישה. נדרש טיפול נפרד."
        : action === "refund" ? "החזר שכבר בוצע בתקבול נרשם." : "דרישת התשלום מתקבול נרשמה.");
      form.reset();
      try { await refresh(); } catch { /* don't imply successful mutation failed */ }
    } catch { setStatus("לא התקבל אישור. רעננו את התור לפני ניסיון חוזר."); }
    finally { setBusy(false); }
  };

  const field = (name: string, label: string, placeholder?: string) => (
    <label className="block text-sm">{label}<input required dir="ltr" name={name} maxLength={128}
      className="block w-full rounded border bg-background p-2" placeholder={placeholder} autoComplete="off" /></label>
  );
  return <section className="space-y-3 rounded-lg border p-4" dir="rtl" aria-label="תשלומים ידניים">
    <h3 className="font-bold">הפעל חבילה אחרי אימות תשלום</h3>
    <p className="text-sm text-muted-foreground">שבועית: 100 מקורות ב־39 ₪. חודשית: 250 מקורות ב־65 ₪. החבילה מתחילה בעת ההפעלה. אין להזין מספר כרטיס.</p>
    <Button type="button" variant="outline" disabled={busy} onClick={() => void fetchOrders()}>טען בקשות תשלום</Button>
    <p aria-live="polite" className="text-sm">{status}</p>
    {rows.length > 0 && <label className="block text-sm">הזמנה
      <select className="mx-2 rounded border bg-background p-2" value={order} onChange={(e) => setOrder(e.target.value)}>
        <option value="">בחירת בקשה</option>
        {rows.map((r) => <option key={r.order_id} value={r.order_id}>
          {r.amount_minor / 100} ₪ · {r.order_id} · {r.refunded_at ? "הוחזר" : r.activated_at ? "הופעל" : r.paid_at ? "לטיפול" : r.cancelled_at ? "בוטל" : r.demand_ref ? "נשלחה דרישה" : "בקשה חדשה"}
        </option>)}
      </select></label>}
    {selected && <form key={`${order}-${action}`} onSubmit={submit} className="space-y-3">
      <label className="block text-sm">פעולה
        <select className="mx-2 rounded border bg-background p-2" value={action} onChange={(e) => setAction(e.target.value as Action)}>
          <option value="issue">תיעוד דרישה שנוצרה בתקבול</option>
          <option value="settle">אימות תשלום והפעלת חבילה</option>
          <option value="refund">תיעוד החזר שכבר בוצע בתקבול</option>
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("observedOrder", "מזהה הזמנה כפי שמופיע בתקבול")}
        {field("merchant", "מזהה בית העסק בתקבול")}
        {action !== "refund" && <>
          {field("demand", "מזהה דרישת תשלום בתקבול")}
          {field("amount", "סכום בשקלים כפי שמופיע בתקבול")}
          {field("at", action === "issue" ? "מועד יצירת הדרישה, כולל אזור זמן" : "מועד החיוב, כולל אזור זמן", "YYYY-MM-DDTHH:mm:ss+02:00")}
        </>}
        {action !== "issue" && <>
          {field("transaction", "מזהה העסקה המקורית")}
          {field("document", action === "refund" ? "מזהה מסמך זיכוי" : "מזהה קבלה")}
        </>}
        {action === "refund" && field("refund", "מזהה עסקת ההחזר")}
      </div>
      <label className="block text-sm"><input type="checkbox" required name="attest" className="ml-2" />
        בדקתי את הפרטים בחשבון תקבול, לא לפי צילום מסך או הודעה מהלקוח.
      </label>
      <Button type="submit" disabled={busy}>אישור ותיעוד</Button>
    </form>}
  </section>;
}
