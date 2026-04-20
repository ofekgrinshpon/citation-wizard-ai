

## Goal
Replace the linear 4-step "How it works" section on the Landing page with a 4-card capabilities section presenting the four core ReLex modes.

## Section header
- Title: `כל הדרכים לעבוד עם ReLex`
- Subtitle: `ממחקר משפטי ועד אזכור אחיד, הערות שוליים וביבליוגרפיה — הכל במקום אחד.`

## Layout
- 2×2 grid on desktop (`md:grid-cols-2`), single column on mobile.
- Card 1 (העוזר המשפטי) gets a subtle highlight: primary-tinted border + a small `סוויטה מלאה` chip — signaling it's the broader workflow without burying אזכור אחיד.
- Each card: screenshot at top (rounded, bordered) → title → short description → on Card 1 only, a chip-row of sub-capabilities.
- Reuse existing `useInView` fade-in animation, RTL, and existing `bg-card`/`border-border` tokens (no `index.css` changes).

## Cards & screenshot mapping

| # | Title | Description | Image |
|---|-------|-------------|-------|
| 1 | העוזר המשפטי | מחקר משפטי, סיכום פסיקה, בקרה למסמכים וכתיבה אקדמית — עם תוצאות מובנות ומותאמות לעבודה משפטית. | new (image 1) → `legal-assistant.png` |
| 2 | אזכור אחיד | הפקת אזכור אחיד משפטי בעברית — בהתאם לכללי האזכור האחיד. | new (image 4) → `uniform-citation.png` |
| 3 | הערות שוליים | הוסיפו מספר מקורות ובנו הערות שוליים מסודרות באופן אוטומטי. | reuse `step3.png` |
| 4 | ביבליוגרפיה | צרו רשימה ביבליוגרפית מסודרת ממספר מקורות. | reuse `step4.png` |

Card 1 also shows chips: `מחקר משפטי · סיכום פסיקה · בקרה למסמכים · כתיבה אקדמית`.

The third uploaded image (academic writing wizard) is also a Legal Assistant view; I'll keep image 1 as the primary Card 1 visual since it best conveys the multi-mode breadth (visible mode tabs + memo result). The academic-wizard screenshot won't be used in this section.

## Files touched
- `public/how-it-works/legal-assistant.png` — copied from `user-uploads://1.png`
- `public/how-it-works/uniform-citation.png` — copied from `user-uploads://4.png`
- `src/pages/Landing.tsx` — replace the `steps` array, the `StepCard` component, and the "How It Works" section block. Keep header, refs, hero, pricing, and everything else untouched.

## Out of scope
- No changes to `/auth` page (it has no "How it works" section — only Landing does).
- No changes to hero, pricing, or design tokens.
- Existing `step1.png` / `step2.png` remain on disk unused (kept as harmless fallbacks).

## Outcome
Visitors immediately see ReLex as a 4-mode product (broad legal assistant + uniform citation + footnotes + bibliography) instead of one linear citation flow. The legal assistant gets visual emphasis without diminishing אזכור אחיד.

