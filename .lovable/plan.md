## Diagnosis (Stage 5e exception path)

### Root cause — confirmed empirically

`STATUTE_RE` (built in `supabase/functions/legal-qa/index.ts` ~line 5001-5007) has **zero capturing groups**. Every alternative is wrapped in `(?:…)` and the outer wrapper is `(?:…)` as well:

```
(?:חוק[- ]יסוד\s*:\s*…
 |חוק\s+(?:…)…
 |פקודת\s+(?:…)…
 |תקנות\s+(?:…)…)
```

But the consumer at line 5021 reads `scanM[1]`:

```js
let name = scanM[1].replace(/\s+/g, " ").trim().replace(/[,;:.]+$/, "");
```

`scanM[1]` is therefore always `undefined`, and `.replace` on `undefined` throws:

> `TypeError: Cannot read properties of undefined (reading 'replace')`

This matches the runtime stack in the edge logs (`[statute-completion] stage threw: TypeError… handleLegalQARequest …index.ts:5064:31`). The line offset (5064 vs 5021) is bundler-shifted — the unique fingerprint is the message + the fact that it fires from inside Stage 5e's `try`.

I reproduced it locally with the exact regex and the Q21 body fragment "סעיף 17 לחוק שירות המדינה (מינויים), התשי\"ט-1959": `m[0]` correctly returns "חוק שירות המדינה (מינויים), התשי\"ט-1959", and `m[1]` is `undefined`.

### Why Q21 / Q22 hit it but Q6 doesn't

- Q6's body contains no real statute name. After the new whitelist regex tightening, `regex_matches_total = 0` on Q6, so the loop body never executes and Stage 5e exits cleanly with no candidates.
- Q21 / Q22 both contain real statute names that the new whitelist correctly matches ("חוק שירות המדינה (מינויים)" and "חוק החוזים (חלק כללי)"). The first match enters the loop, `scanM[1]` is `undefined`, the throw fires, and the outer `catch` at line 5286 sets `status: "exception"` for the whole stage.

### Is the exception suppressing valid statute-completion output?

Yes — entirely. The crash happens **before** any candidate is built, before Perplexity is called, and before anything is added to footnotes. So on every query where the regex matches at least one real statute name, Stage 5e produces zero structured-completion footnotes, regardless of what Perplexity would have returned. This is exactly what we see in Q21 / Q22 footnote counts staying at 1–2.

This bug has been present since the whitelist regex landed — it's not a new regression, but it's the reason Fix E telemetry shows `structured_path: true` while no completed citations actually appear.

### Why the standalone regex test didn't catch it

`eval/regex-statute-name.test.mjs` line 43 reads `m[1].replace(...)` against the same group-less regex. Every positive test case would crash with the identical error. Since the file was added but apparently not executed (or its failure was treated as "not yet wired up"), the bug shipped.

## The smallest safe fix

Two surgical edits, both one-liner shape changes — no logic change, no tuning loop:

### Edit 1 — `supabase/functions/legal-qa/index.ts` ~line 5001-5007

Wrap the alternation in a single capturing group so `scanM[1]` returns the matched name. Change the outer `(?:…)` to `(…)`:

```diff
 const STATUTE_RE = new RegExp(
-  `(?:חוק[- ]יסוד\\s*:\\s*${HEB}[^,.\\n\\[\\]()]{2,80}` +
+  `(חוק[- ]יסוד\\s*:\\s*${HEB}[^,.\\n\\[\\]()]{2,80}` +
   `|חוק\\s+${HEAD}(?:\\s+${HEAD})?${PAREN_QUAL}${YEAR_CLAUSE}` +
   `|פקודת\\s+${HEAD}(?:\\s+${HEAD})?${PAREN_QUAL}${YEAR_CLAUSE}` +
-  `|תקנות\\s+${HEAD}(?:\\s+${HEAD})?${PAREN_QUAL}${YEAR_CLAUSE})`,
+  `|תקנות\\s+${HEAD}(?:\\s+${HEAD})?${PAREN_QUAL}${YEAR_CLAUSE})`,
   "g",
 );
```

(Inner `(?:…)` for HEAD repetition stays non-capturing; only the outer wrapper becomes capturing. `scanM[1]` then equals `scanM[0]`.)

Defense-in-depth (recommended, still one line): make line 5021 tolerant in case anyone tweaks groups later:

```diff
- let name = scanM[1].replace(/\s+/g, " ").trim().replace(/[,;:.]+$/, "");
+ let name = (scanM[1] ?? scanM[0]).replace(/\s+/g, " ").trim().replace(/[,;:.]+$/, "");
```

### Edit 2 — `eval/regex-statute-name.test.mjs` ~line 28-34 and line 43

Mirror the same change so the standalone test exercises the same shape as production:

- Outer wrapper from `(?:…)` to `(…)`.
- Line 43: `let name = (m[1] ?? m[0]).replace(/\s+/g, " ")…`.

### Validate

1. Run `node eval/regex-statute-name.test.mjs` — all 17 positives/negatives should now actually execute (they were silently throwing before).
2. Re-run the regression harness on Q6, Q21, Q22.

   Expected:
   - Q6: unchanged (regex still matches nothing → no Stage 5e work).
   - Q21 / Q22: `statute_completion.status` flips from `"exception"` to either `"ok"` (with `completed_count ≥ 1`) or whatever Perplexity returns (`not_found`, etc.). Footnote totals should rise if Perplexity resolves the names.

## Out of scope (deliberately)

- Regex shape, anchors, post-filters, prep-tail rule — all unchanged.
- Drafter prompt, claim map, rerank floor — unchanged.
- citation-chat — still untouched.
- Telemetry counters — unchanged structure (they'll just start populating with non-zero `completed_count`).

## Risk

Minimal. The fix restores the contract the consumer code was already written against. If for any reason `scanM[1]` is still missing, the `?? scanM[0]` fallback prevents a future crash.
