

# Fix: AI Fabricating Non-Existent Sources in Legal QA

## The Problem
The footnote `זאב סגל "זכויות אדם כחוקה" משפטים כח 77, 85 (1997)` looks perfectly formatted but the article doesn't exist. The AI hallucinated it.

## Root Cause
Line 701 in `supabase/functions/legal-qa/index.ts` explicitly permits the AI to cite sources not in the provided list:

> "אתה יכול גם לכתוב אזכורים נוספים שאינם ברשימה, אם אתה בטוח לחלוטין שהם קיימים."

This is a direct invitation for hallucination. LLMs cannot reliably verify whether an article exists — they generate plausible-sounding metadata (author + journal + volume + page + year) that passes human eye-test but is fabricated.

## Plan

### 1. Remove the permission to cite outside the source list
Replace line 701 with a strict prohibition:

> "אסור בהחלט לצטט מקורות שאינם מופיעים ברשימת המקורות הזמינים למעלה. אם אין מספיק מקורות ברשימה, כתוב פחות הערות שוליים — אל תמציא מקורות חדשים."

### 2. Add a post-processing validation step
After the AI response is received, cross-check each footnote against the source cards that were actually provided. Flag or strip any footnote that doesn't match any provided source (by title, case number, or author).

### 3. Mark unverified external citations
For footnotes derived from Perplexity (web) sources, add a subtle marker so users know these weren't from the local verified database.

## Files to Change
- `supabase/functions/legal-qa/index.ts` — prompt rewrite (line 701) + post-processing validation
- No database changes needed

## Expected Result
- The AI will only cite sources actually provided in the source catalog
- Fabricated articles like the Zeev Segal example will no longer appear
- If retrieved sources are insufficient, the memo will have fewer footnotes rather than fake ones

