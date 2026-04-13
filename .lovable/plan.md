

## Fix Hebrew Year Prefix (ה') in Citations

### Problem
When a Hebrew year is cited (e.g., תשס"ב), it must start with ה' (התשס"ב) per Rules 23.9 and 24.9. The AI currently outputs תשס"ב without the prefix.

### Root Cause
1. The article rule (כלל 24) in `citationRules.ts` is **missing** the Hebrew year formatting note that exists in the book rule
2. The `citation-chat` prompt already mentions this rule but the AI doesn't always follow it — no programmatic enforcement exists

### Changes

**1. `supabase/functions/legal-qa/citationRules.ts`**
- Add to the article `formattingNotes` array: `"שנה: עברית בלבד → עברית (עם ה', למשל התשס"ב); לועזית בלבד → לועזית; שתיהן → לועזית בלבד (כלל 24.9)"`

**2. `supabase/functions/citation-chat/index.ts`**
- Add a post-processing function `fixHebrewYearPrefix` that uses regex to find bare Hebrew years (e.g., `תשס"ב`, `תשע"ט`) that are missing the ה' prefix and adds it
- Pattern: match `(תש[א-ת]["״][א-ת])` not preceded by ה, and prepend ה
- Apply this fix after `sanitizeHallucinatedPublicationData` on the response

**3. `supabase/functions/legal-qa/index.ts`**
- Add the same `fixHebrewYearPrefix` post-processing to the legal-qa response pipeline

### Technical Detail
The regex to catch bare Hebrew years:
```
/(?<![הH])(תש[א-ת]["״׳\u05F4][א-ת])/g → ה$1
```
This handles years like תשס"ב, תשע"ט, etc. — all modern Hebrew years start with תש.

