import { useState, forwardRef } from "react";
import { Mail, Send, ShieldCheck, CreditCard, Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const CONTACT_EMAILS = [
  {
    label: "תמיכה כללית",
    email: "support@relexlm.com",
    description: "שאלות על השימוש במערכת, תקלות ובקשות",
    Icon: Mail,
  },
  {
    label: "פרטיות ומידע",
    email: "privacy@relexlm.com",
    description: "בקשות בנוגע למידע אישי ומדיניות פרטיות",
    Icon: ShieldCheck,
  },
  {
    label: "חיובים ותשלומים",
    email: "billing@relexlm.com",
    description: "תכניות, קרדיטים וחשבוניות",
    Icon: CreditCard,
  },
];

type Fields = { firstName: string; lastName: string; email: string; message: string };

const EMPTY: Fields = { firstName: "", lastName: "", email: "", message: "" };

export const ContactSection = forwardRef<HTMLDivElement>((_props, ref) => {
  const [values, setValues] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const set = (key: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = () => {
    const next: Partial<Record<keyof Fields, string>> = {};
    if (!values.firstName.trim()) next.firstName = "שדה חובה";
    if (!values.lastName.trim()) next.lastName = "שדה חובה";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim())) next.email = "כתובת אימייל לא תקינה";
    if (values.message.trim().length < 5) next.message = "כתבו לפחות כמה מילים";
    if (values.message.trim().length > 5000) next.message = "עד 5000 תווים";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !validate()) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-contact-message", {
        body: {
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          email: values.email.trim(),
          message: values.message.trim(),
        },
      });
      if (error || !data?.ok) {
        throw new Error(error?.message || "send_failed");
      }
      setSent(true);
      setValues(EMPTY);
      toast({ title: "הפנייה נשלחה", description: "נחזור אליכם בהקדם למייל שציינתם." });
    } catch {
      toast({
        title: "שליחת הפנייה נכשלה",
        description: "אפשר לנסות שוב, או לכתוב לנו ישירות ל-support@relexlm.com",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = (key: keyof Fields) =>
    `w-full rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary ${
      errors[key] ? "border-destructive" : "border-border"
    }`;

  return (
    <section ref={ref} className="py-16 px-4 max-w-6xl mx-auto relative z-10">
      <div className="text-center mb-10 space-y-3">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground">יצירת קשר</h2>
        <p className="text-muted-foreground text-sm md:text-base max-w-2xl mx-auto">
          יש שאלה, הצעה או תקלה? כתבו לנו ונחזור אליכם למייל שתשאירו כאן.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6">
          {sent ? (
            <div className="flex flex-col items-center text-center gap-3 py-10">
              <CheckCircle2 className="w-10 h-10 text-primary" />
              <h3 className="text-lg font-bold text-foreground">הפנייה התקבלה</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                ההודעה נשמרה אצלנו ונשלחה לצוות התמיכה. נחזור אליכם בהקדם.
              </p>
              <button
                type="button"
                onClick={() => setSent(false)}
                className="mt-2 text-sm font-medium text-primary hover:underline"
              >
                שליחת פנייה נוספת
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="contact-first" className="text-xs font-medium text-foreground">שם פרטי</label>
                  <input id="contact-first" value={values.firstName} onChange={set("firstName")} maxLength={80} className={inputClass("firstName")} placeholder="ישראל" />
                  {errors.firstName && <p className="text-[11px] text-destructive">{errors.firstName}</p>}
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="contact-last" className="text-xs font-medium text-foreground">שם משפחה</label>
                  <input id="contact-last" value={values.lastName} onChange={set("lastName")} maxLength={80} className={inputClass("lastName")} placeholder="ישראלי" />
                  {errors.lastName && <p className="text-[11px] text-destructive">{errors.lastName}</p>}
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="contact-email" className="text-xs font-medium text-foreground">מייל ליצירת קשר</label>
                <input id="contact-email" type="email" dir="ltr" value={values.email} onChange={set("email")} maxLength={254} className={`${inputClass("email")} text-left`} placeholder="you@example.com" />
                {errors.email && <p className="text-[11px] text-destructive">{errors.email}</p>}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="contact-message" className="text-xs font-medium text-foreground">תוכן ההודעה</label>
                <textarea id="contact-message" value={values.message} onChange={set("message")} maxLength={5000} rows={6} className={inputClass("message")} placeholder="במה נוכל לעזור?" />
                <div className="flex items-center justify-between">
                  {errors.message ? (
                    <p className="text-[11px] text-destructive">{errors.message}</p>
                  ) : <span />}
                  <span className="text-[10px] text-muted-foreground">{values.message.length}/5000</span>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 rounded-xl font-bold text-sm text-primary-foreground transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ background: "var(--gradient-primary)" }}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {submitting ? "שולח..." : "שליחת פנייה"}
              </button>

              <p className="text-[10px] text-muted-foreground text-center">
                הפנייה נשמרת אצלנו ונשלחת לתיבת התמיכה support@relexlm.com. בשליחה אתם מאשרים את
                {" "}
                <a href="/privacy" className="text-primary hover:underline">מדיניות הפרטיות</a>.
              </p>
            </form>
          )}
        </div>

        {/* Direct emails */}
        <div className="space-y-3">
          {CONTACT_EMAILS.map(({ label, email, description, Icon }) => (
            <a
              key={email}
              href={`mailto:${email}`}
              className="block rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-foreground">{label}</div>
                  <div className="text-xs text-primary break-all" dir="ltr">{email}</div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
});

ContactSection.displayName = "ContactSection";
