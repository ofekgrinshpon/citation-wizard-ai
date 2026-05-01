**What actually happened with `רבינאי נגד מן שקד`**

I traced the run in `citation_history` and the edge logs:

1. At 07:20 the user typed `רבינאי נגד מן שקד`. The party-name branch ran and produced an output without a docket: `[חסר: סוג הליך] [חסר: מספר תיק] **רבינאי** נ' **מן שקד**`.
2. At 07:21 the user clicked a disambiguation result and the saved citation became:
   `ע"א 207/79 רבינאי נ' מן שקד בע"מ (בפירוק), פ"ד לה(1) 480 (1980)`.

The correct answer is **ע"א 158/77 רבינאי נ' מן שקד בע"מ, פ"ד לג(2) 281 (1979)**. So the docket, the פ"ד volume, and the year are all wrong. This is a Perplexity hallucination that we accepted without any verification.

**Root cause**

The party-name branch at `supabase/functions/citation-chat/index.ts:1240-1284` calls Perplexity (`sonar`) and asks it to invent JSON with a `caseNumber` field. There are three concrete weaknesses that make hallucination almost guaranteed for older cases:

1. **No `search_domain_filter`.** Unlike the case-number branch in `case-law-search/index.ts` (which restricts to `lite.takdin.co.il`, `nevo.co.il`, `supreme.court.gov.il`, …), the party-name call lets Perplexity use any web source, so blog summaries and memory often beat actual court records — and pre-1980 פ"ד cases are exactly where Perplexity is least reliable.
2. **No grounding check.** We accept whatever JSON the model returns. Even if `citations[]` is empty or points to non-authoritative pages, we still display the result and offer it for the user to click.
3. **No docket↔פ"ד consistency check.** A docket like `207/79` cannot have been published in פ"ד לה(1) of 1980 except by hallucination (לה(1) volumes are 1980 publications of late-1970s cases, but `207/79` does not match `158/77` regardless). The edge function does not cross-validate `caseNumber`, `padi_volume`, and `year` against each other.

**Plan**

1. **Add domain filtering to the party-name Perplexity call** in `supabase/functions/citation-chat/index.ts` (~line 1246). Add `search_domain_filter: ["supreme.court.gov.il","court.gov.il","gov.il","nevo.co.il","takdin.co.il","lite.takdin.co.il","psakdin.co.il"]` and switch the model from `sonar` to `sonar-pro`, matching what `partyLookup.ts` already does for the academic flow. This alone removes most blog-driven hallucinations.

2. **Require source-grounded results.** After parsing `psParsed.results`, only keep entries where Perplexity returned at least one citation URL whose host matches the trusted list. The Perplexity response exposes `citations` at the top level — log them and drop any result whose docket/parties cannot be traced to a trusted URL. If nothing survives the filter, fall through to the existing "no results" hint asking the user for a docket.

3. **Cross-validate docket/year/פ"ד before showing a result.** Add a small sanity check in the same block:
   - The docket year (the digits after `/` or `-` in `caseNumber`) must be ≤ `year` and within ~5 years of it.
   - If `isPublished=true`, `padi_volume` must be a known mapping (or at least `year >= dockerYear`); if any of these fail, drop the entry.
   This prevents the `207/79 → לה(1) 1980` style mismatch from ever reaching the user.

4. **Tighten the disambiguation UI hint** so the AI is told explicitly: *"Show the user the list, but if any field is missing or uncertain, mark it `[חסר:…]` and never invent a docket."* Also add a final warning line: *"אם לא ניתן לוודא את מספר התיק ממקור מוסמך — השמט את ההצעה."*

5. **Optional but recommended — verify the chosen case after disambiguation.** When the user clicks a `[בחירת תוצאה]` line, before saving to history call `case-law-search` (already exists) with the chosen `caseType + caseNumber`. If it returns `found:false`, surface a yellow warning ("לא הצלחנו לאמת את התיק במאגרים הציבוריים — בדוק את המספר") instead of silently saving a hallucinated reference.

6. **Logging.** Log Perplexity's `citations` array next to each `Party search result` line so the next time this happens we can see at a glance whether the answer was sourced or invented.

**Expected result**

For `רבינאי נגד מן שקד`:
- The party-name search will be domain-restricted to court/legal databases.
- Perplexity should now find ע"א 158/77 (it appears on supreme.court.gov.il and nevo.co.il); if not, the result is dropped instead of replaced by a hallucinated `207/79`.
- The cross-validation guard would have caught `207/79` + `פ"ד לה(1) 1980` as inconsistent and removed it from the disambiguation list.
- If nothing survives the guards, the user sees an honest "couldn't verify, please provide a docket" message rather than a confidently wrong citation.

**Files to change**
- `supabase/functions/citation-chat/index.ts` — party-name Perplexity call (search filter, sonar-pro, citation grounding, sanity checks, hint text, logging).
- (Optional, step 5) `src/pages/Index.tsx` — call `case-law-search` for verification on disambiguation selection before saving.
