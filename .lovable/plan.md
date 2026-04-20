

## Goal
Translate the English technical reason strings shown in the credit history (Profile → ניהול חשבון → היסטוריית קרדיטים) into Hebrew labels — `אזכור אחיד` instead of `citation-chat`, `עוזר משפטי – מחקר` instead of `legal-qa:research`, etc.

## Why a display-layer fix
The ledger stores English technical reasons (`citation-chat`, `legal-qa:research+doc`, `legacy:incrementCount`, `plan changed to pro_annual`, `auto-refund: …`). Existing rows already use these strings. Translating at the **display layer** in `Profile.tsx` covers historic + new rows without DB migrations or coordinated edge-function changes, and keeps the raw value available for debugging.

## Change — `src/pages/Profile.tsx` only

### 1. Add a translator above the component (right after `EVENT_LABEL`)
```ts
const PLAN_LABELS_HE: Record<string, string> = {
  basic: "Basic",
  pro_monthly: "Pro חודשי",
  pro_semester: "Pro סמסטריאלי",
  pro_annual: "Pro שנתי",
  admin: "Admin",
};

function formatLedgerReason(raw: string | null): string {
  if (!raw) return "";
  const r = raw.trim();

  const direct: Record<string, string> = {
    "citation-chat": "אזכור אחיד",
    "legacy:incrementCount": "אזכור אחיד",
    "verified-autocomplete": "השלמה אוטומטית מאומתת",
    "batch-footnote": "מחולל הערות שוליים",
    "bibliography": "מחולל ביבליוגרפיה",
    "academic-writing": "כתיבה אקדמית",
    "invalid_input_refusal": "הקלט לא היה ברור דיו",
    "runtime-error": "שגיאה טכנית",
    "citation-chat exception": "שגיאה טכנית באזכור אחיד",
    "manual": "התאמה ידנית",
  };
  if (direct[r]) return direct[r];

  const qa = r.match(/^legal-qa:([a-z_]+)(\+doc)?$/i);
  if (qa) {
    const modes: Record<string, string> = {
      research: "עוזר משפטי – מחקר",
      pleading_analysis: "עוזר משפטי – ביקורת מסמך",
      case_summary: "עוזר משפטי – סיכום פסק דין",
      academic_writing: "עוזר משפטי – כתיבה אקדמית",
    };
    const base = modes[qa[1]] ?? `עוזר משפטי – ${qa[1]}`;
    return qa[2] ? `${base} (עם מסמך מצורף)` : base;
  }

  const auto = r.match(/^auto-refund:\s*(.+)$/i);
  if (auto) return `החזר אוטומטי – ${formatLedgerReason(auto[1])}`;

  const plan = r.match(/^plan changed to\s+(\S+)/i);
  if (plan) return `שינוי מסלול ל-${PLAN_LABELS_HE[plan[1]] ?? plan[1]}`;

  if (/[\u0590-\u05FF]/.test(r)) return r;  // already Hebrew → pass through
  return "פעולת מערכת";                      // safe fallback for unknown English strings
}
```

### 2. Use it in the ledger row render (~line 287)
Replace:
```tsx
{row.reason && <div className="text-muted-foreground truncate">{row.reason}</div>}
```
with:
```tsx
{row.reason && (
  <div className="text-muted-foreground truncate" title={row.reason}>
    {formatLedgerReason(row.reason)}
  </div>
)}
```
`title` keeps the raw technical string on hover for support/debugging.

## Out of scope
- DB migration / backfill of existing reasons.
- Changing what edge functions write (keys stay stable for analytics).
- Admin users table.

## Files modified
- `src/pages/Profile.tsx` — add translator, use it in the ledger list.

## Expected outcome
- `citation-chat` → **אזכור אחיד**
- `legacy:incrementCount` → **אזכור אחיד**
- `legal-qa:research` → **עוזר משפטי – מחקר**
- `legal-qa:academic_writing+doc` → **עוזר משפטי – כתיבה אקדמית (עם מסמך מצורף)**
- `auto-refund: legal-qa runtime error` → **החזר אוטומטי – פעולת מערכת**
- `plan changed to pro_annual` → **שינוי מסלול ל-Pro שנתי**
- Unmapped English strings → **פעולת מערכת**, raw value still visible on hover.

