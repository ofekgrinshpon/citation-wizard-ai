import { useState } from "react";

interface PartyNameCheckProps {
  onDismiss: () => void;
  onRequestEdit: () => void;
}

/**
 * Rule 18.4.4 party name verification checklist.
 * Shows guidance and lets users confirm or fix their citation's party names.
 */
export function PartyNameCheck({ onDismiss, onRequestEdit }: PartyNameCheckProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      className="mt-2 rounded-lg border border-border bg-surface px-3.5 py-3 text-xs leading-relaxed"
      style={{ direction: "rtl" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-foreground text-sm">
          📐 בדיקת שמות הצדדים (כלל 18.4.4)
        </span>
        <button
          onClick={() => { setDismissed(true); onDismiss(); }}
          className="text-muted-foreground hover:text-foreground transition-colors text-base leading-none px-1"
          title="סגור"
        >
          ✕
        </button>
      </div>

      <ul className="space-y-1.5 text-muted-foreground list-none pr-0">
        <li className="flex gap-2 items-start">
          <span className="text-primary mt-0.5">•</span>
          <span><strong className="text-foreground">אדם</strong> — יש לציין רק את <strong className="text-foreground">שם המשפחה</strong> (ללא שם פרטי, ללא תואר).</span>
        </li>
        <li className="flex gap-2 items-start">
          <span className="text-primary mt-0.5">•</span>
          <span><strong className="text-foreground">קשור לאדם</strong> (עיזבון, יורשים, נאמן) — <strong className="text-foreground">הקשר + שם משפחה</strong>, ללא תארים כגון "המנוח", "ז&quot;ל", "החייב".</span>
        </li>
        <li className="flex gap-2 items-start">
          <span className="text-primary mt-0.5">•</span>
          <span><strong className="text-foreground">תאגיד</strong> — <strong className="text-foreground">השם המלא</strong> (בע&quot;מ, חל&quot;צ וכד׳).</span>
        </li>
      </ul>

      <div className="mt-2.5 pt-2 border-t border-border text-muted-foreground">
        <span className="font-medium text-foreground">דוגמאות:</span>
        <div className="mt-1 space-y-0.5">
          <div>ע&quot;א 374/64 <strong className="text-foreground">רוזנר</strong> נ׳ <strong className="text-foreground">מגן דוד אדום בישראל</strong></div>
          <div>ע&quot;א 248/86 <strong className="text-foreground">עזבון חננשוילי</strong> נ׳ <strong className="text-foreground">רותם חברה לביטוח בע&quot;מ</strong></div>
        </div>
      </div>

      <div className="mt-2.5 pt-2 border-t border-border text-muted-foreground">
        <span className="font-semibold text-foreground text-sm">📐 תפקיד ותואר (כלל 18.4.5)</span>
        <p className="mt-1">
          אם מופיע שמו של אדם לצד <strong className="text-foreground">תפקידו</strong> — יש לציין רק את <strong className="text-foreground">שם המשפחה</strong> אם הוא מעורב כאדם פרטי, ורק את <strong className="text-foreground">התפקיד</strong> אם הוא מעורב מכוח תפקידו (אלא אם שם התפקיד כוללני מדי).
        </p>
        <p className="mt-1">
          אם מופיע שמו של אדם לצד <strong className="text-foreground">תוארו</strong> — <strong className="text-foreground">אין לציין את התואר</strong>.
        </p>
        <div className="mt-1.5 space-y-1">
          <div>
            <span className="text-xs text-primary">✓</span>{" "}
            בג&quot;ץ 987/94 יורונט קווי זהב (1992) בע&quot;מ נ׳ <strong className="text-foreground">שרת התקשורת</strong>
          </div>
          <div>
            <span className="text-xs text-destructive">✗</span>{" "}
            בג&quot;ץ 987/94 יורונט קווי זהב (1992) בע&quot;מ נ׳ שרת התקשורת, <s className="text-destructive/70">הגב׳ אלוני</s>
          </div>
          <div className="mt-1">
            <span className="text-xs text-primary">✓</span>{" "}
            ע&quot;א 3295/94 <strong className="text-foreground">הנאמן על נכסי מור</strong> נ׳ מור
          </div>
          <div>
            <span className="text-xs text-destructive">✗</span>{" "}
            ע&quot;א 3295/94 <s className="text-destructive/70">פרמינגר, עו&quot;ד,</s> הנאמן על נכסי <s className="text-destructive/70">חוה ויוסף</s> מור...
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex gap-2">
        <button
          onClick={() => { setDismissed(true); onDismiss(); }}
          className="flex-1 text-center py-1.5 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
        >
          ✓ שמות הצדדים תקינים
        </button>
        <button
          onClick={() => { setDismissed(true); onRequestEdit(); }}
          className="flex-1 text-center py-1.5 rounded-md bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors"
        >
          ✏️ שמות הצדדים לא תקינים – עריכה
        </button>
      </div>
    </div>
  );
}
