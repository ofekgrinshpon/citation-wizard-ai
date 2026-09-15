# Span-Hunting Patch — Variance Check (Q22, Q29)

Validation only. No code, prompt, budget, threshold or deployment change.
Both questions run once each on the current deployed build, same harness
(`scripts/v2-batch3-eval.ts`, labels `batch3-Q22`, `batch3-Q29`).

Runs inspected:
- Q22 — run `6aaa7d6d-9f00-4dae-8a25-684ae0d04780` (eval row `b6e0ce3b…`)
- Q29 — run `09833ecf-d028-4cb2-9a9d-0f839058d38b` (eval row `0bdc6894…`)

---

## Q22 — administrative promise (הבטחה שלטונית)

| Metric | Pre-patch | Post-patch #1 | **Rerun (this check)** |
|---|---|---|---|
| Prompt tokens | ~66.6k | ~169.9k | **98.3k** |
| Agent steps / turns | 8 | 16 | **10** |
| Verified claims / core | — | — | **5 / 5** |
| Unsupported claims | — | — | **0** |
| Footnotes | 2 | 1 | **3** |
| central_issue_covered | true | false | **true** (0 gap terms) |
| Already-read actions | — | — | **23** |
| Targeted rereads (new / no-new) | — | — | **22 (13 / 9)** |
| Span-hunting exhaustions / suppressions | — | 15 suppressions | **1 / 3** |
| Authority targets opened / acquired / unresolved | — | — | **3 / 1 / none** |
| Repair cycles | — | — | 0 |
| Latency | — | — | 143s |

### Turn sequence

```text
1 search
2 lookup_authority
3 acquire_authority (no-op)
4 fetch  +evidence
5 fetch  +evidence
6 fetch  (no-op)
7 fetch  (no-op)   <- span-hunting suppressions occur in this band
8 fetch  (no-op)
9 fetch  (no-op)
10 submit_research_memo
```

### Did suppression redirect the agent into unnecessary authority acquisition?

No. Reconstructed sequence: the only authority-acquisition action (turn 3)
happens **before** any span-hunting suppression — suppression is only possible
after three consecutive zero-novelty reads of an already-acquired source, which
cannot occur before turn 6. Everything after the first suppression is
zero-cost no-op reads followed immediately by the memo. The run opened 3
authority targets, acquired 1, and left **no unresolved authorities**.

בג"ץ 8634/08 — flagged in the first post-patch run as "extra work" — is in this
rerun a **productive** authority: it is source S4 and carries footnote 3,
supporting the authority/intent conditions and the withdrawal-from-promise
passage. גרוס was not pursued at all.

### Answer assessment

Substantive, well-structured Hebrew memo (1,611 chars) with four headed
sections: binding promise from the duty of public fairness, the cumulative
conditions, the authority and legal-intent requirements, and withdrawal from a
promise with the burden on the authority. Three footnotes — סאי-טקס 135/75,
a secondary explanatory source, and בג"ץ 8634/08. Five verified claims, all
core, zero unsupported. Central issue covered.

**Q22 verdict: the first post-patch result did not reproduce.** Footnotes and
coverage are at or above pre-patch quality; tokens are ~42% below the first
post-patch run and ~1.5× pre-patch, within ordinary run variance for this
question given it acquired one more authority than the pre-patch run.

---

## Q29 — revocation of a business licence / right to be heard

| Metric | Pre-patch | Post-patch #1 | **Rerun (this check)** |
|---|---|---|---|
| Prompt tokens | ~209k | ~264k | **104.1k** |
| Agent steps / turns | 16 | 21 | **10** |
| Verified claims / core | — | — | **5 / 3 core** |
| Unsupported claims | — | — | **0** |
| Footnotes | 3 | 3 | **2** |
| central_issue_covered | — | — | **true** (0 gap terms) |
| Already-read actions | — | — | **30** |
| Targeted rereads (new / no-new) | — | 40 (4 no-new) | **30 (12 / 18)** |
| Span-hunting exhaustions / suppressions | — | — | **3 / 5** |
| Authority targets opened / acquired | — | — | **2 / 0** |
| Unresolved authorities | — | — | 6023/22, 3379/03, 654/78 |
| Temporal unresolved / contradicted | — | — | **0 / 0** |
| Repair cycles | — | — | 0 |
| Latency | — | — | 195s |

### Does the 20+ step path repeat?

No. This rerun took 10 turns and finished with the memo; the 21-step path did
not recur. Prompt tokens fell to **half** the pre-patch baseline and ~40% of
the first post-patch run.

### Is the extra cost of the earlier run acquisition/search variance?

Yes. The cost driver visible here is search/acquisition, not span hunting:
8 web searches, 71s of search time, 2 authority targets opened and 0 acquired,
with three named judgments (6023/22, 3379/03, 654/78) never resolved — those
are network-edge acquisition failures already documented in the acquisition
inspection, and they vary run to run.

### Does the patch materially affect this run?

Marginally and in the intended direction. Suppression fired 5 times across
3 exhausted sources, all in the late no-op band (turns 4–9), each replacing a
would-be in-document re-search with a compact deterministic response. It did
not block any new acquisition path and did not truncate research: 19 new quotes
were still served, temporal checks resolved cleanly (0 unresolved,
0 contradicted).

### Answer assessment

Substantive Hebrew memo (1,781 chars): the right to be heard as a foundational
administrative principle, the balancing scope of hearing/inspection rights,
inadequate preparation time, genuine cure of a defective hearing requiring a
reopened decision process, and interim relief freezing the decision. Two
footnotes — a State Comptroller paper and בר"מ 8707/19 (Supreme Court). One
footnote fewer than both earlier runs; grounding density remains real (5
verified claims, 0 unsupported), but the third authority is lost to the
unresolved-acquisition set rather than to the patch.

---

## Conclusion

- Q22's regression (token blow-up, 1 footnote, coverage false) **did not
  reproduce**; the rerun is better than pre-patch on footnotes and equal on
  coverage. The earlier result was run variance in which authorities were
  chased, not a suppression-caused redirection — suppression provably occurred
  only after the run's single acquisition action.
- Q29 shows **no patch-caused quality or cost regression**: half the pre-patch
  tokens, ten turns instead of sixteen, clean temporal state, substantive
  answer. Its residual variance is unresolved authority acquisition, which the
  patch does not touch.
- No verification, identity, acquisition, temporal or sufficiency behaviour
  changed in either run.

SPAN-HUNTING FIX — SHIP

NO CODE CHANGED.
