---
name: Case-law disambiguation relevance + data carry-over
description: Three protections in citation-chat party-search path — token-based party relevance filter, caseType-prefix filter, and embedded data blob carrying full Perplexity result into the disambiguation selection so no re-search is needed.
type: feature
---

In `supabase/functions/citation-chat/index.ts` party-name (Branch B) search:

1. **Relevance filter**: tokenize user-typed party1/party2 (Hebrew tokens ≥3 chars, stopwords excluded: `נ נגד של את עם על בין מדינת ה`). Drop any Perplexity result whose `party1`/`party2` don't share at least one token in the user-typed order. Order-preserving — reversed parties (e.g. user wrote `קמיקר נ מדינה`, result is `מדינה נ' קמיקר`) are dropped.
2. **CaseType prefix filter**: if the user-typed input contained a procedural prefix (e.g. `סע״ש`), drop Perplexity results whose `caseType` doesn't match (after normalizing `״↔"`, `׳↔'`).
3. **Data blob carry-over**: each disambiguation line now ends with `<!--DATA:{urlencoded JSON}-->` carrying the full per-result fields (date, court, isPublished, padi_*, databaseName, year, parties, caseType, caseNumber). On `[בחירת תוצאה]`, the function parses the blob and builds `caseLawHint` directly — **no second Perplexity call**, no data loss.

`MessageBubble.tsx` strips `<!--DATA:...-->` from display but passes the full line (blob included) to `onSelectOption`, so the round-trip works invisibly.

Also: `caseNumberMatch[2].replace('-', '/')` was removed — lower-court dockets use dashes (e.g. `סע"ש 50358-09-16`); preserving the user's separator is required for takdin/nevo lookups to succeed.
