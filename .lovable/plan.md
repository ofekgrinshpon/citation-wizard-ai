

## Goal
Make `legal-qa` use **local DB chunks** as the *source of truth for what a statute section says*, while using **Perplexity** purely as a *citation-formatting helper* (year, ס"ח/ק"ת, page). On any content conflict, local wins.

## Current behavior (verified from `supabase/functions/legal-qa/index.ts` + memories)
- Hybrid retrieval: local Supabase (text + vector) **and** Perplexity run in parallel.
- Perplexity results are merged into the prompt as candidate sources/citations alongside local chunks.
- Local items are already prioritized in display (≥60% target, mem `legal-qa/citation-prioritization`), but the AI is allowed to take **substantive content** from either pool.
- There is no explicit "local = content truth, Perplexity = format only" instruction. So when local has no chunk for "Section 30", Perplexity's prose can leak in as fact (the bug from earlier).

## The change

### 1. Re-scope the two retrieval pools in the system prompt
Add an explicit, top-of-prompt rule block in `supabase/functions/legal-qa/index.ts`:

```
כללי שימוש במקורות (חובה):
- מקורות מקומיים (מסומנים [מאומת]) הם מקור האמת היחיד לתוכן מהותי של חוקים, סעיפים, פסיקה והלכות.
  • כל ציטוט תוכן ("סעיף X קובע...", "ההלכה קבעה...") חייב להיות מעוגן בטקסט שמופיע באחד ממקורות [מאומת].
  • אם אין במקור מקומי טקסט התומך בקביעה — אסור לקבוע אותה. נסח כללית או השמט.
- מקורות Perplexity (מסומנים [חיצוני]) משמשים אך ורק להשלמת מטא-דאטה ביבליוגרפית: שנת פרסום, ס"ח/ק"ת, מספר עמוד, כרך, מו"ל, שם כתב עת.
  • אסור לשאוב מ-Perplexity קביעות מהותיות על תוכן סעיף או הלכה.
  • אם Perplexity מספק תוכן מהותי שסותר את המקור המקומי — התעלם ממנו והעדף את המקומי.
- במקרה של קונפליקט בנוסח/תוכן בין מקור מקומי למקור חיצוני — המקומי גובר תמיד.
```

### 2. Tag sources distinctly when building the prompt context
In the section that assembles the source cards for the AI:
- Prefix every local chunk header with `[מאומת – מקור אמת לתוכן]`.
- Prefix every Perplexity result with `[חיצוני – למטא-דאטה בלבד]`.
- For Perplexity entries, **strip long body excerpts** before injection (keep title + URL + bibliographic hints only — year, ס"ח, page if detectable). This removes the temptation/ability for the model to lift substantive prose from Perplexity.

### 3. Citation merge logic
When building footnote citations:
- If the **same statute** appears in both pools, take the **content/quote from local** and **enrich the citation tail** (year, ס"ח X, page) from Perplexity's parsed metadata if local is missing it.
- Lightweight matcher: normalize law names (existing helpers in `verified_source_engine`), match local↔Perplexity by law name + section number; on match, build one merged footnote.

### 4. Post-response sanity check (non-blocking, log only)
Scan the AI answer for `סעיף\s+\S+\s+ל\S+.*?(קובע|מורה|מגדיר)` followed by a quoted span. For each hit:
- Verify the quoted span (or the section number near the law name) appears in at least one **local** chunk that was provided.
- If it only appears in Perplexity context (or nowhere), `console.warn("[content-grounding-violation]", ...)`. No user-facing block — just observability so we can keep tightening.

### 5. Memory updates
- Update `mem://logic/anti-hallucination` to add: "Local DB = source of truth for substantive statutory/case content. Perplexity is restricted to bibliographic metadata only. On conflict, local wins."
- Update `mem://logic/legal-qa/citation-prioritization` to reflect the new role split (not just ordering, but functional).

## Files to change
- `supabase/functions/legal-qa/index.ts` — system prompt rules, source-tagging in context assembly, Perplexity payload trimming, merge logic, post-response scan + log.
- `mem://logic/anti-hallucination` — append rule.
- `mem://logic/legal-qa/citation-prioritization` — clarify role split.

## Out of scope
- Bulk re-ingesting Israeli statutes (separate larger task).
- Changing the user-visible UI (badges/labels stay as today).
- Touching `citation-chat` / Uniform Citation flow.

## Expected outcome
- The AI can no longer attribute fabricated content to "Section X of Law Y" — substantive claims must trace to a local `[מאומת]` chunk.
- Perplexity continues to enrich citations with year / ס"ח / page when local metadata is incomplete, but never injects substantive legal content.
- Conflicts resolve deterministically: local wins.
- Console warnings flag any remaining ungrounded statutory claims for monitoring.

