import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReLexLogo } from "@/components/ReLexLogo";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

type State = "loading" | "valid" | "already" | "invalid" | "done" | "error";

const Unsubscribe = () => {
  const [state, setState] = useState<State>("loading");
  const [email, setEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const token = new URLSearchParams(window.location.search).get("token");

  useEffect(() => {
    let cancelled = false;
    const validate = async () => {
      if (!token) {
        setState("invalid");
        return;
      }
      try {
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`;
        const res = await fetch(url, {
          headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setState("invalid");
          return;
        }
        setEmail(data?.email ?? null);
        setState(data?.alreadyUnsubscribed || data?.used_at ? "already" : "valid");
      } catch {
        if (!cancelled) setState("error");
      }
    };
    validate();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const confirm = async () => {
    if (!token || submitting) return;
    setSubmitting(true);
    const { error } = await supabase.functions.invoke("handle-email-unsubscribe", { body: { token } });
    setSubmitting(false);
    setState(error ? "error" : "done");
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4" style={{ direction: "rtl" }}>
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center space-y-4">
        <div className="flex justify-center">
          <ReLexLogo size={44} />
        </div>

        {state === "loading" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">בודקים את הבקשה...</p>
          </div>
        )}

        {state === "valid" && (
          <>
            <h1 className="text-xl font-bold text-foreground">ביטול הרשמה לדיוור</h1>
            <p className="text-sm text-muted-foreground">
              {email ? `הכתובת ${email} תוסר מרשימת ההודעות שלנו.` : "הכתובת שלכם תוסר מרשימת ההודעות שלנו."}
              {" "}הודעות מערכת חיוניות (כמו איפוס סיסמה) עדיין יישלחו.
            </p>
            <button
              onClick={confirm}
              disabled={submitting}
              className="w-full py-2.5 rounded-xl font-bold text-sm text-primary-foreground disabled:opacity-60"
              style={{ background: "var(--gradient-primary)" }}
            >
              {submitting ? "מבטל..." : "אישור ביטול ההרשמה"}
            </button>
          </>
        )}

        {state === "already" && (
          <>
            <CheckCircle2 className="w-8 h-8 text-primary mx-auto" />
            <h1 className="text-xl font-bold text-foreground">כבר בוטלה ההרשמה</h1>
            <p className="text-sm text-muted-foreground">הכתובת הזו כבר הוסרה מרשימת הדיוור שלנו.</p>
          </>
        )}

        {state === "done" && (
          <>
            <CheckCircle2 className="w-8 h-8 text-primary mx-auto" />
            <h1 className="text-xl font-bold text-foreground">ההרשמה בוטלה</h1>
            <p className="text-sm text-muted-foreground">לא נשלח אליכם עוד דיוור. אפשר לפנות אלינו בכל עת ב-support@relexlm.com.</p>
          </>
        )}

        {(state === "invalid" || state === "error") && (
          <>
            <AlertTriangle className="w-8 h-8 text-destructive mx-auto" />
            <h1 className="text-xl font-bold text-foreground">
              {state === "invalid" ? "הקישור אינו תקין" : "אירעה שגיאה"}
            </h1>
            <p className="text-sm text-muted-foreground">
              נסו שוב מהקישור שבמייל, או כתבו לנו ל-support@relexlm.com ונטפל בזה.
            </p>
          </>
        )}

        <a href="/" className="inline-block text-sm text-primary hover:underline">חזרה לאתר</a>
      </div>
    </div>
  );
};

export default Unsubscribe;
