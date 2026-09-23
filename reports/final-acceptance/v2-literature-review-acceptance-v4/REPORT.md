# ReLex V2 — Acceptance #4 (Agent-Owned Coverage Check)

Ten prompts, exact wording, run sequentially against the deployed
`legal-research-v2` after the coverage-check change was shipped. No product
code, prompt, threshold or configuration was changed during the acceptance run.

## 1. What changed before this acceptance

One change only: a bounded, **agent-owned, semantic, once-per-run pre-memo
reflection** (`agent/coverageCheck.ts`), plus diagnostic telemetry.

- Fires at most once per run, and only when the memo already has claims **and**
  at least one already-read, non-duplicate, successfully-fetched source was not
  used by the memo.
- Asks the agent, in its own words, whether the memo covers the dimensions the
  user explicitly asked for (approaches, disagreement, historical development,
  comparison, competing explanations, doctrinal evolution), to look first at
  material already read, to continue research only if worthwhile within the
  remaining budget, and otherwise to record the gap explicitly.
- No source quota, no classifier, no minimum source count, no forced use of
  read material, no new mode, no second model, no orchestration change, no
  Drafter change. Duplicate / same-work handling and every evidence gate are
  untouched.
- Safety fallback: if the post-reflection resubmission comes back with zero
  claims, the pre-check memo is kept (`memo_coverage_reverted_to_pre_check`).

Tests: 1059 passing (12 new, C1–C8), typecheck clean.

## 2. Run inventory

| prompt | run_id | latency (s) | agent steps | resumes |
|---|---|---|---|---|
| L1 | 1711627d-68ea-46be-bdb3-21052ce34e9e | 441 | 24 | 1 |
| L2 | c524c1a4-b5d6-4900-8658-f4e82ab780d5 | 850 | 17 | 4 |
| L3 | 14902b94-a4d7-4c93-8452-9497c62f945f | 259 | 23 | 0 |
| L4 | 2ec97305-0d10-4361-bd46-0b7c5b07ab0e | 254 | 18 | 0 |
| L5 | 3d69979f-026e-48b6-b4d5-fc8da409d32a | 362 | 9 | 1 |
| L6 | b784dc47-ea30-42ac-9ece-cc68f88e39e2 | 760 | 17 | 2 |
| L7 | 7d6f8ac0-0fdc-4d5b-897c-1fb2af5d489c | 192 | 20 | 0 |
| L8 | 3191aa43-8069-4d67-9dcc-cd74edc3bee5 | 607 | 24 | 2 |
| N1 | b1bc0387-e4ec-411f-8c86-80ed748399aa | 153 | 24 | 0 |
| N2 | ca79df09-ba26-4ab8-8f80-7825597b0bea | 55 | 6 | 0 |

All ten reached a terminal `done` state. Resumes are the known checkpoint-stall
pattern, not answer failures.

## 3. Coverage-check behaviour (diagnostic only)

| prompt | triggered | unused read sources at check | reused an existing read source | continued research | claims delta | explicit gap | reverted |
|---|---|---|---|---|---|---|---|
| L1 | yes | 6 | 0 | 0 | 0 | 0 | 0 |
| L2 | yes | 2 | 0 | 0 | 0 | 0 | 0 |
| L3 | yes | 5 | 0 | 0 | 0 | 0 | 0 |
| L4 | yes | 3 | 0 | 0 | 0 | 0 | 0 |
| L5 | yes | 1 | 0 | 0 | 0 | 0 | 0 |
| L6 | yes | 2 | 1 | 0 | +2 | 0 | 0 |
| L7 | yes | 3 | 0 | 0 | 0 | 0 | 0 |
| L8 | yes | 2 | 0 | 0 | −1 | 0 | 0 |
| N1 | yes | 1 | 0 | 0 | 0 | 0 | 0 |
| N2 | no | 0 | — | — | — | — | 0 |

Readings:

- The check is genuinely bounded: once per run, never twice, and it never fired
  where nothing was left unused (N2).
- It is not coercive: in seven of nine triggered runs the agent looked at the
  unused material and decided the memo was already sufficient — exactly the
  intended "reflect, don't obey" behaviour. L8 even removed a claim after
  reflection.
- Where reflection was worthwhile it paid: L6 pulled an already-read source into
  the memo and added two claims.
- The safety fallback never had to fire in this acceptance (`reverted = 0`
  everywhere); the narrow prompts N1/N2 came back narrow and correct
  (2 and 3 footnotes, 153 s and 55 s).

## 4. Answer quality vs Acceptance #3

Improvement is real and concentrated where #3 was weakest:

- **L1 (עילת הסבירות)** — #3 produced a thin sketch. #4 maps Dotan's two
  historical models (סבירות של מופרכות → סבירות איזונית, with the דפי זהב
  turning point), names the analytic disagreement about judicial deference,
  qualifies the "full transition" narrative, and carries the debate into
  בג"ץ 5658/23 and the 2024 literature. 1 917 chars, 4 footnotes.
- **L5 (בעיית הנציג)** — now maps five distinct approaches (fiduciary duty,
  triple-approval procedural screening, the minority-veto critique, the
  independent-director critique, judicial review per Goshen & Hamdani, and
  empirical derivative-suit enforcement) across six cited sources. This is the
  largest single-run improvement in the set.
- **L6 (ביקורת שיפוטית על חוקי יסוד)** — maps Reichman/Gavison against Barak's
  limited-constituent-power position; the coverage check contributed here.
- **L2, L3, L4, L7, L8** — comparable to or slightly better than #3, no
  regressions in structure, disagreement coverage or historical framing.
- **N1, N2** — narrow questions still get narrow, correct, short answers. No
  broadening regression.

Drafter utilisation is 100 % in all ten runs: every verified source available
to the Drafter was cited (`verified_sources_available_to_drafter ==
verified_sources_cited`). The #3 complaint "read and verified sources omitted
from the memo" does not reproduce at the Drafter boundary.

## 5. Evidence safety

Unchanged and holding:

- No gate was weakened; verification and span/support checks are as before.
- Same-work recovery fired in five runs (L4 ×2, L6, L7 ×2, L8, N1), saw 42
  candidates, rejected 36 on identity and 0 on host, and recovered 0. No false
  match. `same_work_agent_hint_used_for_equivalence = 0` in every run — the
  trust boundary from the previous track is intact in live traffic.
- Rejected evidence remains visible (L2 2, L6 1, N2 1); unsupported claims are
  dropped rather than asserted.

## 6. Remaining defects (all pre-existing, none introduced by this change)

1. **False author attribution from embedded PDF metadata — blocking.**
   L5 footnote 6 attributes "התביעה הנגזרת בישראל — סיכום ביניים ומבט לעתיד"
   to *Ido Baum*; the file is `weisman-hamdani-kastiel.pdf` and the prose
   correctly credits Weisman, Hamdani and Kastiel. L5 footnote 2 attributes
   "עניין אישי ומעמדם של בעלי השליטה בדיני חברות" to *נופר אזולאי* from
   `levi.pdf`. In both cases `field_basis.authors = "pdf_metadata"` — the
   lowest-trust tier is still allowed to supply an author name when no stronger
   source provides one. Same root cause family as the L8 wrong-year finding in
   Acceptance #3.
2. **Garbage title surfaced as a source.** L7 footnote 2 renders
   `"fs3d rep bv 449" (2020)` alongside a legitimate Georgetown source.
3. **Raw URLs still appear in citation text** for sources without structured
   bibliographic metadata (L1 fn 3, L2 fn 1–2, L3 fn 1, L8 fn 1). The
   raw-URL suppression only covers structured academic citations.
4. **Low-authority sources cited for primary law.** L3 cites Hebrew Wikipedia
   for דפי זהב; L1/L3 cite a law-office summary page for בג"ץ 5658/23, where the
   official judgment text would be expected.
5. **Checkpoint stalls persist** (L2 four resumes, L6 and L8 two each). Correct
   answers were produced, but unattended reliability is not yet acceptable.

## 7. Verdict

**PARTIAL / REVIEW.**

The coverage check itself passes on every criterion it was asked to meet: it is
semantic, agent-owned, once per run, bounded, non-coercive, free of quotas and
classifiers, safe against empty resubmission, and it measurably improved the
worst answers from Acceptance #3 without broadening the narrow ones. On that
change alone the result is SHIP.

The overall track cannot be declared SHIP because item 6.1 is a confidently
false author attribution reaching the user's footnotes in two places in a single
run. Per the standing criteria, one such attribution blocks SHIP regardless of
answer quality. The bibliographic trust hierarchy needs `pdf_metadata` demoted
so that it can no longer be the sole basis for an author name, together with the
garbage-title filter extension in 6.2.

No product code was modified during this acceptance run. No verdict was softened
and no missing artifact was reconstructed.
