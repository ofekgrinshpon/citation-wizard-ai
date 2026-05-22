**Findings from the latest output**

Latest completed run: `fd3db2ba-0faa-47b5-a8be-87765b7229fb` at 08:52 UTC.

The run completed technically (`citation_quality.status = ok`), but the output quality regressed in source selection and citation rendering:

1. **No `חוק העונשין`**
   - `חוק העונשין` exists in `legal_documents` as `israeli_law` (`cd6ab407-9fa7-489c-a966-dc4124577712`).
   - Retrieval did not select it. Instead, the factual anchor pool selected unrelated “דמי ביטוח” regulations because the factual query contained broad tokens like `דמי` / `גביית` and the anchor reserve accepted the first primary-law hit.
   - Root cause: the planner did not force the obvious criminal-law anchor for “גביית דמי חסות / פרוטקשן / סחיטה באיומים”, and retrieval has no protected “offense statute” recall path.

2. **No MMM `דמי חסות` in final answer**
   - The MMM documents do exist and were found by the factual anchor pre-pass:
     - `גביית דמי חסות – ניתוח נתוני דיווח לכנסת – תיקון`
     - `סחיטת דמי חסות`
   - But the per-claim 2-slot anchor reserve chose `israeli_law + journal_article`, not `knesset_research`, because primary-law preservation and pool ordering let unrelated primary regulations outrank the topical MMM reports.
   - Root cause: factual anchors are not currently scored for exact title/topic relevance before reserve selection.

3. **`סעד החובה לחוקק` rendered as generic “המשפטים (מאמר אקדמי)”**
   - The correct local article exists: `סעד החובה לחוקק: הצעה למתווה הדרגתי` (`02fa534c-9c4d-4e1f-96f9-69235480b5ee`).
   - The concept layer did retrieve a `journal_article`, but the final footnote used weak/generic scholarship metadata (`המשפטים (מאמר אקדמי)` / `כתב העת משפטים`) instead of the local article title/citation.
   - Root cause: local secondary metadata is not sufficiently protected when web/weak scholarship candidates survive, and journal-article passthrough citations do not prefer the local `legal_documents.citation/title/source_url` record strongly enough.

**Fix plan**

1. **Add protected criminal-statute recall for offense questions**
   - Add a small general legal-anchor expansion for criminal-offense phrasing: when the question/plan contains `דמי חסות`, `פרוטקשן`, or `סחיטה באיומים`, retrieval should explicitly search for `חוק העונשין` and the relevant offense terms.
   - This is not document-ID hardcoding; it is a legal concept-to-statute anchor rule.
   - Ensure `חוק העונשין` can enter the candidate set as a protected primary source before unrelated `דמי ביטוח` regulations.

2. **Rank anchor candidates by topical relevance before reserving slots**
   - For factual anchors, prefer candidates whose `title/citation/snippet` match strong factual terms (`דמי חסות`, `פרוטקשן`, `סחיטה`) over generic matches (`דמי`, `גביית`, `אכיפה`).
   - Keep primary-law protection, but do not let an unrelated primary source displace a directly topical MMM source.
   - Expected result: MMM `knesset_research` sources survive into verifier/ledger when the query is about `דמי חסות`.

3. **Protect local secondary sources over weak web scholarship labels**
   - When a local `journal_article` or `knesset_research` row and a web/approved source refer to the same topic, prefer the local row’s `title`, `citation`, `source_type`, `source_url`, and metadata.
   - Avoid final footnotes like `המשפטים (מאמר אקדמי)` when a concrete local title exists.
   - Expected result: the article footnote should cite `סעד החובה לחוקק: הצעה למתווה הדרגתי`, not a generic journal label.

4. **Harden citation rendering for local journal/MMM passthrough**
   - For local `journal_article` / `knesset_research`, treat a concrete local citation/title as informative even when the citation engine cannot build a full canonical Rule 24/official-report citation.
   - Keep partial placeholders if metadata is missing, but never collapse to a generic source label when a title is available.

5. **Validate on the same query**
   - Re-run the same query after deployment.
   - Confirm in `qa_logs` that:
     - `חוק העונשין` appears in retrieval/ledger/footnotes when used.
     - MMM `דמי חסות` appears in retrieval and survives if verified.
     - `סעד החובה לחוקק` appears by title in the final footnotes.
     - No unrelated `דמי ביטוח` regulation is selected as the factual statutory anchor.

**Files to touch after approval**

- `supabase/functions/legal-qa/core/retrieval.ts`
- `supabase/functions/legal-qa/core/citations.ts`
- Possibly `supabase/functions/_shared/legalDoctrineSynonyms.ts` or a new shared legal-anchor helper

**Files not to touch**

- Database schema / migrations
- UI components
- Drafter prompt
- Verifier prompt
- Footnote builder behavior, unless validation shows the generic label is produced only there