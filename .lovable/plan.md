

## Goal
Fix two related defects in **מחקר משפטי** (Research Mode):
1. The AI placed footnote marker `[1]` next to "חוק החוזים (חלק כללי)" but footnote 1 was an unrelated family-court case (`תמ"ש 3402-09-21`).
2. The named law (חוק החוזים) did not get its own bibliographic footnote, despite the existing exception rule.

## Root cause (from edge logs)
- Rerank dropped 11/12 local docs as off-topic. Only 1 family-court case passed (score 4) — completely unrelated to contract law.
- The system prompt enforces "≥60% of references must be `[מאומת]`", so the model jammed the only available local source as footnote 1 and attached it to the law mention — even though the source has nothing to do with `חוק החוזים`.
- The "legislation exception" rule (lines 1626–1631, 1676–1681) is correct on paper, but the model preferred fulfilling the 60% quota over citing the law properly.
- The relevance gate is too lenient for the family-court case: a citation about "הסכמים שעניינם הגירת קטינים" scored 4 because it superficially mentions "הסכמים".

## Changes (all in `supabase/functions/legal-qa/index.ts`)

### 1. Anti-mismatch guard in the prompt
Add an explicit, high-priority rule near the top of the rules section:
> **לעולם אל תצרף סימן הפניה `[N]` לאזכור של חוק/פקודה/תקנה אם הערת השוליים `N` היא מקור מסוג אחר** (למשל פסק דין, מאמר). אזכור של חוק חייב להיות מקושר אך ורק להערת שוליים שהיא ציטוט ביבליוגרפי של אותו חוק עצמו.

Pair it with a positive instruction: when the body says "חוק X", footnote `[N]` next to it MUST be the bibliographic citation of חוק X (per the existing exception), not a tangentially related case.

### 2. Drop the rigid 60% מאומת quota when there are no on-topic local sources
Change line 1624 from a hard "≥60%" to: "אם המקורות [מאומת] רלוונטיים מהותית — העדף אותם. אם המקורות [מאומת] עוסקים בנושא אחר לחלוטין — **אל תצטט אותם בכלל**, גם אם המשמעות היא תשובה עם פחות הערות שוליים מקומיות. ציטוט מקור לא רלוונטי הוא הפרה חמורה."

This removes the perverse incentive that caused the family-court case to be jammed in.

### 3. Tighten the rerank gate further
- Raise the caselaw floor from 4 → **5**. A score of 4 still means "weakly related"; we want "directly on point" only.
- Keep the safety valve (allow score-3 caselaw back if no caselaw at all survives) **only when the question itself is a caselaw-domain question**. For doctrinal/contract questions, an empty caselaw bucket is fine — Perplexity + legislation footnote can carry the answer.
- Strengthen the rerank prompt with an explicit domain-mismatch example: "שאלה על חוזים מסחריים + מקור על משמורת קטינים = ציון 0–1, גם אם שניהם מזכירים 'הסכם'."

### 4. Verify the legislation-footnote exception is being honored
The rule already exists (lines 1676–1681). After change #1 above, the model has no escape route — it must either generate a proper בקבוק footnote for `חוק החוזים` or omit the marker entirely. No code change needed beyond #1.

## Out of scope
- Other modes (pleading audit, academic writing, case summary) — unchanged.
- Changes to retrieval (vector/keyword search) — only the rerank gate is tuned.
- UI changes.

## Files touched
- `supabase/functions/legal-qa/index.ts` (+ redeploy)
- `mem://logic/legal-qa/relevance-filtering` (update thresholds)

## Expected outcome
For the same query about "השינוי בחוק החוזים":
- The body still says "פרשנות חוזים בישראל מוסדרת בעיקרה בחוק החוזים (חלק כללי).¹"
- Footnote 1 reads: `חוק החוזים (חלק כללי), התשל"ג-1973, ס"ח 118.` (or `(לא נמצאו פרטי פרסום)` if Perplexity has no metadata).
- The unrelated family-court case (`תמ"ש 3402-09-21`) does not appear at all.

