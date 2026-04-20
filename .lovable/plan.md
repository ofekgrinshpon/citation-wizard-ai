

## Goal
Remove the "סוויטה מלאה" badge from the העוזר המשפטי capability card while keeping its subtle visual emphasis (primary-tinted border + sub-capability chips).

## Change
- `src/pages/Landing.tsx`:
  - Remove `badge: "סוויטה מלאה"` from the העוזר המשפטי entry in the `capabilities` array.
  - Remove the now-unused `badge` field from the `Capability` type.
  - Remove the badge rendering block inside `CapabilityCard` (the absolutely-positioned `<Sparkles />` chip).
  - Remove `Sparkles` from the `lucide-react` import if no longer used elsewhere on the page (it's still used by the pricing card's "הכי משתלם" badge — keep the import).

## Outcome
The legal assistant card keeps its primary-tinted border, hover lift, and four capability chips at the bottom (מחקר משפטי · סיכום פסיקה · בקרה למסמכים · כתיבה אקדמית), but the floating "סוויטה מלאה" tag is gone.

