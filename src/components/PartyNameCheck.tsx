import { useState } from "react";

interface PartyNameCheckProps {
  onDismiss: () => void;
}

/**
 * Rule 18.4.4 party name verification checklist.
 * Shows guidance and lets users confirm their citation's party names are correct.
 */
export function PartyNameCheck({ onDismiss }: PartyNameCheckProps) {
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

      <button
        onClick={() => { setDismissed(true); onDismiss(); }}
        className="mt-2.5 w-full text-center py-1.5 rounded-md bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
      >
        ✓ בדקתי – שמות הצדדים תקינים
      </button>
    </div>
  );
}
