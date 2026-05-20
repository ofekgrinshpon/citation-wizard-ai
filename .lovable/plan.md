## Goal

Add diagnostic logging so we can see **which URLs** Perplexity pulled when it returned `year: 2001` for `ע"פ 4596/98`. No behavior change.

## Changes

### 1. `supabase/functions/citation-chat/index.ts` — case-number branch (~line 1100, after `await perplexityResp.json()`)

Log the citation URLs alongside the parsed JSON:

```ts
const pData = await perplexityResp.json();
const rawContent = pData.choices?.[0]?.message?.content || "";
console.log(`[case-law] perplexity sources for ${fullCaseRef}:`, JSON.stringify({
  citations: pData.citations ?? null,
  search_results: pData.search_results ?? null,
  model: pData.model,
}));
console.log(`[case-law] perplexity raw content for ${fullCaseRef}:`, rawContent);
```

### 2. Same file — date-verification call inside `verifyDecisionDate` / `reconcilePublishedDate`

After the verification Perplexity response is parsed, log:

```ts
console.log(`[case-law] date-verify sources for ${fullCaseRef}:`, JSON.stringify({
  citations: dvData.citations ?? null,
  search_results: dvData.search_results ?? null,
}));
console.log(`[case-law] date-verify raw content:`, dvContent);
```

### 3. `supabase/functions/case-law-search/index.ts` — both Perplexity calls

Same two log lines after each `await ...json()`. Mirrors citation-chat so the standalone path is debuggable too.

## What we'll do next

After deploying, re-run `ע"פ 4596/98` and check edge function logs. The `citations[]` array will list the exact URLs Perplexity grounded on. That tells us:

- Whether `2001` came from a volume-catalog page, a follow-up motion, or a hallucination with no source at all.
- Whether the date-verify retry hits the same pages (explaining why it doesn't fix the year).
- Whether tightening `search_domain_filter` (e.g. dropping `psakdin.co.il`) or switching to `sonar-pro` would help — before committing to the Wikipedia helper.

## Out of scope

- Any change to the year logic, prompts, or domain filter.
- Wikipedia helper (deferred until logs justify it).
