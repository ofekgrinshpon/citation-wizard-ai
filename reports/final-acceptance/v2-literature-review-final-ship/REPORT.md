# ReLex V2 — Final Bibliographic Safety + Unattended Reliability

Release hardening only. No change to the Research Agent, the agent-owned
coverage check, research-depth logic, the Drafter, the Verifier, synthesis,
same-work recovery, identity enrichment, evidence verification, exact-authority
logic, or source quotas.

## 1. Phase 1 — weak embedded PDF metadata can no longer originate a field

Root cause (Acceptance #4, finding 6.1): the bibliographic trust hierarchy
allowed `pdf_metadata` — the lowest tier — to be the *sole* basis for an author
name. Embedded PDF `/Author` fields routinely carry the uploader, a template
owner, or an unrelated person, so a confidently false author reached the user's
footnotes (L5 fn 6 "Ido Baum" from `weisman-hamdani-kastiel.pdf`; L5 fn 2
"נופר אזולאי" from `levi.pdf`).

Change (`shared/bibliographic.ts`):

- `AUTHOR_FORBIDDEN_SOLE_BASES = ["pdf_metadata"]` + `canOriginateAuthor()`.
  PDF metadata may still *corroborate* an author supplied by a stronger basis;
  it may never *originate* one.
- `mergeBibliographic` drops a PDF-only author and records
  `authors:pdf_metadata_not_sole_basis` in `dropped_fields`.
- `sanitizeBibliographic` re-applies the rule at the end, catching bare
  PDF-info candidates that bypass the merge path.
- `looksLikeMachineDocumentLabel()` extends garbage-title filtering to machine
  document labels (`fs3d rep bv 449`, `ab12 draft v3`, `qx7 rev 0012`) while
  preserving legitimate titles (Brown v. Board of Education, Roe v. Wade,
  Chevron, Law and Finance, Hebrew titles).
- Year behaviour deliberately unchanged — no threshold, no new taxonomy.

Tests: `src/test/bibliographicWeakMetadataSafety.test.ts` (B1–B9 + year), 12 new.

## 2. Phase 2 — unattended stall recovery

Root cause: nothing supervised a run whose executor died between checkpoints.
The state was always fine — every manual resume in Acceptance #4 succeeded
instantly — the supervisor simply did not exist.

- `beta/resumePolicy.ts` (new, pure): `classifyStall()` / `decideAutoResume()`
  over `recoverable_no_executor | still_alive | terminal_status | no_checkpoint
  | resume_budget_exhausted | claimed_by_other | abandoned_too_old`;
  stale after 180 s, at most 4 automatic resumes, 45-minute age ceiling,
  batch of 5.
- `index.ts`: a throttled run beat (15 s) stamps `last_beat_at` on every
  progress advance and on pause; the mid-chunk checkpoint now also carries the
  user-facing job row and stage (previously lost on mid-chunk recovery);
  `sweepStalledRuns()` claims a stale run atomically
  (`auto_resume_count = prior + 1` guarded on the prior value and on status)
  and resumes it through the function's own resume path. Live runs are selected
  newest-first and long-abandoned rows are excluded, so a historical row can
  never crowd a live run out of the batch.
- Watchdog entry requires a single-use nonce from `v2_watchdog_ticks`; no
  credential is stored or transmitted.
- Migrations: `0001_v2_unattended_resume_watchdog.sql`,
  `0002_v2_watchdog_age_guard.sql`. The `v2-resume-watchdog` cron job runs
  once a minute (1 440 ticks/day) and returns immediately when nothing is
  pending; the minute cadence is what bounds a stall to roughly 3–4 minutes.

Tests: `src/test/unattendedResumeReliability.test.ts` (R1–R8), 20 new.
Suite: 1 090 passing, typecheck clean, `legal-research-v2` deployed.

## 3. Phase 3 — live ship validation (no code change during the runs)

Exact Acceptance #4 prompts L5, L7, L2, L6, L8 (the false-author, garbage-title
and stall-prone set), run sequentially against the deployed function.

| prompt | status | seconds | chunk | automatic resumes | reason | footnotes | chars |
|---|---|---|---|---|---|---|---|
| L5 | done | 219 | 2 | 0 | — | 3 | 1 337 |
| L7 | done | 205 | 1 | 0 | — | 5 | 2 118 |
| L2 | done | 735 | 3 | 1 | recoverable_no_executor | 3 | 1 077 |
| L6 | done | 227 | 2 | 0 | — | 4 | 1 707 |
| L8 | done | 254 | 3 | 0 | — | 3 | 1 497 |

**Manual resumes required: 0.** L2 lost its executor mid-run, was detected
stale, claimed once, resumed automatically and completed — the first fully
unattended recovery in this track. No run was resumed twice, no run was claimed
by two sweeps, no terminal run was touched.

Bibliographic outcome:

- **No false author anywhere.** The two Acceptance #4 attributions do not
  reproduce: L5 now carries no author on the two affected sources rather than a
  wrong one. Authors still appear where a strong basis supplies them
  (Doolittle in L7; Barak Medina and Alison L. Young in L6/L8).
- **No garbage title.** `"fs3d rep bv 449"` is gone from L7; the legitimate
  Georgetown/Boston College sources survive.

## 4. Remaining defects (pre-existing, none introduced, none blocking)

1. Raw URLs still appear in citation text for sources without structured
   bibliographic metadata (L2 fn 2, L6 fn 1–2, L8 fn 1).
2. One RTL-reversed title from PDF text extraction
   (L5 fn 2, "חובת האמון – בתאגיד ת נאּו מּו א יחסי").
3. Two filename-derived labels in L7 fn 3 (`hayden-2kgames-ndohio2022`,
   `Alexander-v-Take-Two-...`) — identifiable, but not citation-grade titles.
4. Low-authority sources are still sometimes cited for primary law (L6 fn 1, a
   law-office summary of בג"ץ 5658/23).

None of these is a confidently false statement about a source; each is a
presentation gap over correct underlying evidence.

## 5. Verdict

**SHIP.**

Both release blockers are closed against their stated criteria: weak embedded
PDF metadata can no longer originate a bibliographic field, the machine-label
garbage title is filtered, and a stalled run now recovers without a human — as
demonstrated live, not only in tests. Research behaviour, evidence gates and
citation architecture are untouched, and the five validation answers are of the
same quality as Acceptance #4.

No product code was modified during the validation runs. No verdict was
softened and no missing artifact was reconstructed.
