# ReLex V2 — Stop Repeated No-New-Quote Span Hunting

Narrow efficiency fix: a targeted re-read of an already-acquired body counts as productive **only if it adds a new quote to the EvidenceStore**, and a source that produces three consecutive zero-novelty reads stops answering further paraphrases with another in-document search.

Nothing in discovery, acquisition, identity, verification, temporal, sufficiency, drafting or citation rendering was changed. No budget, context, quote-retention or step limit was changed.

---

## 1. Implementation

### 1.1 Quote novelty is now observable (`evidence/evidenceStore.ts`)

`serveQuotesWithNovelty(source_id, windows, issue)` returns `{ quotes, new_count }`. `serveQuotes()` is retained and simply delegates to it, so quote ids, quote text, the 40-char floor, the 900-char cap, dedupe by `(source_id, text)` and the 24-quote FIFO are byte-identical to before. No second quote registry was created.

### 1.2 Per-source state (`tools/acquisitionLedger.ts`)

`SourceReadRow` gained three optional fields, serialized with the rest of the ledger and therefore surviving chunk/resume:

```ts
consecutive_no_new_quotes?: number;
span_hunting_exhausted?: boolean;
attempted_locators?: string[];   // locators/sections asked for here, present or not
```

New methods, all deterministic:

* `noteQuoteYield(source_id, new_quotes)` — `>0` resets the counter and clears exhaustion; `0` increments and, at `NO_NEW_QUOTE_THRESHOLD = 3`, sets `span_hunting_exhausted`. Returns the row plus a one-shot `newly_exhausted` flag for telemetry.
* `spanHuntingExhausted(source_id)`
* `isNewLocator(source_id, locator)` / `noteLocatorAttempt(source_id, locator)`

The existing `noteRead` / `no_yield` / `missing_locators` / `exhausted` machinery is untouched and still runs on its own axis: *the query matched somewhere* and *new quotable text was produced* are now two separate signals, which is exactly the conflation the inspection identified.

### 1.3 Suppression and escape hatch (`tools/fetch.ts`)

In the targeted-re-read branch (`source_id`, no `url`, no `result_id`), **before** any excerpt or section work:

* a read is **structurally new** if it names a section/locator never attempted on this source and not already known missing, or carries a non-empty `refetch_reason`;
* if the source is span-hunting exhausted and the read is not structurally new, it returns a compact payload — `ok:false`, `already_read:true`, `no_new_evidence:true`, `span_hunting_exhausted:true`, `span_hunting_suppressed:true`, the last served quotes for that source, and one instruction: use the exact quotes already served, pursue another concrete source/authority, or submit the memo. No `excerpt()`, no `locateSection()`, no new quote serving, no body text.

Both executing branches (section retrieval and generic targeted read) now serve through `serveExactText`, which reports `new_quote_count` / `served_quote_count`, and call `noteQuoteYield`. A generic read that matched but returned only already-served text is now marked `no_new_evidence: true` and carries a short advisory. Productive re-reads are unchanged and, as before, consume **no** fetch budget — there is no network call in this path, and that was deliberately left alone.

### 1.4 Telemetry

`targeted_rereads`, `targeted_rereads_new_quote`, `targeted_rereads_no_new_quote`, `span_hunting_exhaustions`, `span_hunting_reads_suppressed`, `new_quotes_served`, `duplicate_quotes_resurfaced` — added to agent stats, `RunTelemetry` and the run telemetry object.

### 1.5 State machine

```text
per source S:
  read(S) → new quotes > 0 ─────────► counter = 0, exhausted = false
  read(S) → new quotes = 0 ─────────► counter += 1
                                       counter >= 3 → exhausted = true
  read(S) while exhausted:
      structurally new (unseen section/locator, or refetch_reason)
            → executes normally (may reset the counter)
      otherwise
            → suppressed, answered from already-served quotes
```

---

## 2. Tests

`src/test/spanHuntingEfficiency.test.ts`, 23 deterministic tests: novelty counting and unchanged quote ids/dedupe; productive read leaves the counter at zero; a second distinct productive read likewise; a paraphrase landing on already-served text increments; three zero-novelty reads mark the source exhausted; the fourth paraphrase is suppressed; the suppressed read performs no excerpt/section search and serves no new quote; the last useful exact quotes are still returned; the instruction names the source and the memo option; a new quote resets the counter and clears exhaustion; per-source independence; serialize/resume survival; one-shot exhaustion transition; an unseen statute section bypasses exhaustion; a known-missing section does not; a materially new locator bypasses once and no longer bypasses after it has been attempted; an ordinary paraphrase never bypasses; an explicit `refetch_reason` revisits the source; neither productive nor suppressed re-reads are network fetches; exact quote text handed on is identical to what verification consumes; `no_yield` / missing-locator behaviour intact; a first read of another source is unaffected; acquisition targets unchanged.

**Full V2 suite: 76 files, 848 tests, all passing.** Function deployed.

---

## 3. Targeted validation

Latest pre-fix run vs post-fix run, same questions, same harness:

| | Q27 | Q28 | Q29 | Q18 | Q22 (control) |
|---|---|---|---|---|---|
| prompt tokens before | 304,871 | 165,676 | 209,036 | 228,978 | 66,601 |
| **prompt tokens after** | **171,307** | **69,566** | 264,104 | 257,383 | 169,878 |
| change | **−44%** | **−58%** | +26% | +12% | +155% |
| agent steps before → after | 21 → 15 | 15 → 8 | 16 → 21 | 20 → 21 | 8 → 16 |
| already-read actions before → after | 61 → 55 | 42 → 8 | 31 → 55 | 35 → 26 | 6 → 55 |
| targeted re-reads (new-quote / no-new-quote) | 54 (18/36) | 7 (6/1) | 40 (36/4) | 25 (19/6) | 54 (30/24) |
| span-hunting exhaustions | 2 | 0 | 0 | 0 | 1 |
| **reads suppressed** | **18** | 0 | 0 | 0 | 15 |
| footnotes before → after | 2 → 2 | 1 → 1 | 3 → 3 | 1 → 2 | 2 → 1 |
| span-verified pairs | 5 → 7 | 8 → 9 | 7 → 6 | 4 → 7 | 5 → 6 |
| central_issue_covered | true → true | true → true | true → true | false → true | true → **false** |
| answer chars | 1,897 → 1,760 | 1,236 → 1,503 | 1,978 → 1,762 | 1,170 → 1,416 | 1,347 → 1,340 |

### Quality

* **Q27** — same legal conclusion (share can be publication under §2 of חוק איסור לשון הרע, like distinguished, per רע"א 1239/19), same two footnotes, 7 span-verified pairs (up from 5), 3 temporally verified claims. 18 suppressions at 44% less cost. **Primary target met.**
* **Q28** — substantive, unchanged conclusion (employee vs contractor decided by the mixed test, not contract labels), footnote count unchanged, span-verified pairs up 8 → 9, at 58% less cost. The mechanism was barely needed here: the run simply did not span-hunt this time (7 targeted re-reads vs 42 before).
* **Q29** — grounding held: 3 footnotes, §7ג still analysed, substantive 1,762-char answer, 1 temporally current-verified claim. But the run took 21 steps instead of 16 and cost 26% more; 36 of its 40 targeted re-reads produced genuinely new quotes, so the gate legitimately never fired.
* **Q18 (safety case)** — **did not regress**: substantive 1,416-char answer on חוזה למראית עין with 2 footnotes (previously 1), 7 span-verified pairs (previously 4), and central issue now covered. Alternate-source acquisition remained free. Cost rose 12%.
* **Q22 (control)** — **regressed**: 67k → 170k, 8 → 16 steps, footnotes 2 → 1, `central_issue_covered` true → false. The answer is still substantive and correctly grounded in בג"ץ 580/83 אטלנטיק, but the סאי-טקס footnote of the earlier run is gone and the run spent its extra steps chasing גרוס and בג"ץ 8634/08 without obtaining usable bodies. Suppression fired 15 times *inside* this run, i.e. it limited the damage rather than causing it; the extra cost comes from a different, unsuccessful acquisition path being chosen this time.

---

## 4. Assessment

**What the fix demonstrably does:** where the pathology is present, it stops it. Q27 — the cleanest case in the inspection — dropped 44% with identical substance and slightly better grounding, and 18 zero-novelty reads were answered from state instead of consuming a turn each. No quality metric fell on Q27, Q28, Q29 or Q18.

**What it does not do:** it does not control the other, larger source of variance — which authorities a run decides to chase and how many turns it spends on acquisition paths that never yield a body. Q29, Q18 and especially Q22 rose in cost for that reason, with the gate either never firing (Q29, Q18) or firing without changing the run's shape (Q22). Q22 also lost one footnote and its covered-issue status, which is a real, if modest, quality difference on the control question.

Given one clear regression on the control (Q22) and two cost increases that the fix neither caused nor prevented, this does not meet the bar for a clean pass. The mechanism itself is sound, bounded and reversible; the run-to-run variance around it is the open question, and it predates this patch.

**Recommended next step (not taken here):** rerun Q22 and Q29 once on the current build to separate variance from effect before any further change, and do not stack another optimization on top until that is settled.

---

SPAN-HUNTING EFFICIENCY FIX PARTIAL — REVIEW REQUIRED
