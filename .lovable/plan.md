

# Replace Disclaimer Text Across All Three Sections

## What
Replace the existing text below the search bar in the "טקסט חופשי" mode, and add the same disclaimer to the "הערות שוליים" and "ביבליוגרפיה" sections:

**New text:** `ReLex הוא AI ויכול לעשות טעויות. יש לבדוק שנית את הפלט לפני השימוש בו.`

## Changes

| File | Line(s) | Change |
|------|---------|--------|
| `src/pages/Index.tsx` | 1123–1126 | Replace "כללי האזכור האחיד..." text with the new disclaimer |
| `src/components/BatchFootnoteBuilder.tsx` | 444–446 | Replace subtitle `<p>` text with the disclaimer |
| `src/components/BibliographyGenerator.tsx` | 113–115 | Replace subtitle `<p>` text with the disclaimer |

All three will use the same styling — small muted text centered or aligned per existing layout.

