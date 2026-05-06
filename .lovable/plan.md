# Stop Gemini from adding first names to case parties

## What you saw

Output: `ע"א 158/77 ברכה רבינאי נ' מנחם מן שקד, פ"דלג(2) 281 (1979).`

Two bugs:

1. **Hallucinated first names.** The Perplexity lookup correctly returned `party1: "רבינאי"`, `party2: "מן שקד"` (last names only, per Rule 18.4). But the `caseLawHint` we inject into the user message says only "use this data" — it does not forbid the drafter from *augmenting* the names with first names it "remembers". Gemini added "ברכה" and "מנחם" from training data.
2. **Missing space:** `פ"דלג` instead of `פ"ד לג`. The hint string in the edge function builds `פ"ד ${r.padi_volume}${part}` correctly, but the drafter is re-formatting and dropping the space.

The lookup is right. The drafter is over-helpful.

## Fix

Edit `supabase/functions/citation-chat/index.ts` in the single-result branch of the party-name search (lines ~1112–1116) to make the hint a **hard override**, not a suggestion.

Replace the closing instruction with:

```ts
const partyLockLine = (r.party1 && r.party2)
  ? `\n⚠️ חובה מוחלטת: השתמש בשמות הצדדים בדיוק כפי שמופיעים כאן — "${r.party1}" ו-"${r.party2}". אסור להוסיף שמות פרטיים, תארים, "עזבון", "יורשי" או כל תוספת אחרת, גם אם אתה "זוכר" אותם ממקור אחר. כלל 18.4: שם משפחה בלבד לאנשים פרטיים.\n`
  : "";
const spacingLine = `⚠️ חובה: רווח בין "פ\"ד" לכרך (למשל: פ"ד לג(2) 281, ולא פ"דלג).\n`;

if (caseLawOverrideLabel === "פסיקה (דפוס)") {
  details += `${partyLockLine}${spacingLine}══ חובה לעצב כפסיקה (דפוס) לפי כלל 18, תוך שימוש בלעדי בנתונים שלמעלה. ══`;
} else {
  details += `${partyLockLine}══ השתמש אך ורק בנתונים שלמעלה. אסור להוסיף מידע מהזיכרון. אם נתון חסר — סמן [חסר:...]. ══`;
}
```

Why this works:
- "חובה מוחלטת" + the explicit ban list ("ברכה", "מנחם" pattern) gives Gemini a clear rule it can follow.
- Naming the failure mode ("גם אם אתה זוכר ממקור אחר") directly addresses training-data leakage.
- The spacing line targets the exact `פ"ד<volume>` glue bug.

## What I'm explicitly NOT doing yet

- **Post-response validator** that compares final-answer party names against the lookup's `r.party1`/`r.party2` and rewrites if different. Better to try the prompt-level fix first; if it still leaks, we add the validator as a second line of defense.
- Touching `caselaw-search` (single-case-number path) — same hint pattern lives there too. Want to fix it there only after confirming the party-search fix works, so we don't change two paths at once.

## Files

- `supabase/functions/citation-chat/index.ts` — single-result branch around line 1112.

After approval I'll apply the edit and deploy.
