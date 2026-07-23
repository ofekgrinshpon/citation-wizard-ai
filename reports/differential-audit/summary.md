# Differential audit — `sources_only` vs `answer` on 5 stub questions

Scope: Q03 (statutory interpretation), Q09 (academic doctrine), Q14 (practical AML), Q16 (labour-law mixed), Q18 (Basic Law verbatim + official source).

Method:
- Pulled the stored July-16 `answer`-mode telemetry (`qa_logs.metadata`) for the 5 stub runs.
- Ran each question once today in `mode: "sources_only"`.
- Ran each question once today in `mode: "answer"` (added mid-audit — see below).

## Headline finding

**The July-16 stub failure pattern is not reproducible today.** All 5 questions that stubbed on July 16 produce full answers on today's `answer` pipeline, with primary-source coverage that looks reasonable at a glance.

That reframes the question you asked. The audit was set up to explain why `sources_only` succeeds where `answer` fails on these 5 items. On today's pipeline, `answer` also succeeds — so there is no per-question "loss stage" to attribute for the current build.

## Cross-question table

| Q | July-16 kind | July-16 `answer` cands | July-16 verifier direct+partial | July-16 result | Today `answer` cands | Today `answer` direct+partial | Today `answer` used | Today `sources_only` total / usable / additional |
|---|---|---:|---:|---|---:|---:|---:|---|
| Q03 | verifier-rejects-all | 10 | 0 | STUB | 11 | 3 | 3 | 9 / 2 / 10 |
| Q09 | verifier-rejects-all | 6 | 0 | STUB | 9 | 3 | 3 | 15 / 7 / 5 |
| Q14 | retrieval-empty | 0 | 0 | STUB | 18 | 8 | 8 | 19 / 9 / 15 |
| Q16 | verifier-rejects-all | 5 | 0 | STUB | 9 | 4 | 4 | 18 / 11 / 15 |
| Q18 | retrieval-empty | 0 | 0 | STUB | 6 | 5 | 4 | 9 / 5 / 5 |


## Reading the two July-16 subtypes against today

You asked me to keep the distinction sharp:

**Retrieval-empty (Q14, Q18) on July 16.** 0 candidates ever reached the verifier back then.
- Q14: today's `sources_only` returns 19 candidates and today's `answer` returns 18 (8 used). This is not a case of the same retrieval quietly filtering out results — retrieval genuinely produced items this time. Either (a) the planner LLM emitted better queries this run, (b) Perplexity has more relevant coverage now, or (c) something in the retrieval/pool code changed since July 16. I did **not** confirm which; both `answer` and `sources_only` share planner+retrieval+verifier, so whichever it is affects both paths.
- Q18: today's `sources_only` returns `m.knesset.gov.il/Activity/Legislation/Documents/yesod3.pdf` as a **direct/primary_statute** hit, and today's `answer` mode cites the same URL as source #1. On July 16 this URL never appeared. Q18 was the biggest single audit failure and today's pipeline does surface the official Knesset PDF.

**Verifier-rejects-all (Q03, Q09, Q16) on July 16.** Candidates existed but the verifier labeled all as unrelated/tangential.
- Today the verifier labels several as direct/partial for each question (Q03: 3 partial; Q09: 2 direct + 1 partial; Q16: 2 direct + 2 partial). Whether that is a real change in verifier behavior or LLM non-determinism on the same candidate set, I did not disentangle. The observable effect is the same: no verifier over-rejection blocking the drafter today.

## What `sources_only` uniquely surfaces today

Even now that `answer` produces usable output, `sources_only` still shows two capabilities the `answer` path deliberately hides:

1. **Additional-sources tier** (5–15 items per question) built from Perplexity `discovery_only` / `class_*` drops and verifier-`tangential` candidates. On Q03 this includes `nevo.co.il/law_html/law01/255_390.htm` — the actual regulation directly relevant to §32(9) — which `answer` did not use as a footnote today. On Q14 it includes Wikisource `חוק איסור הלבנת הון`. These are held back from `answer` mode by design (drop-reason admission and tangential filtering), not by verifier over-rejection.
2. **Broader statute coverage.** On Q16 `sources_only` lists explicit pension-related statutes (`חוק הביטוח הלאומי` fragments, `תקנות הפיקוח על שירותים פיננסיים`) that `answer` mode omitted or replaced with weaker `psakdin.co.il` case pages.

So the honest story about the two paths right now is: same retrieval and same verifier, but `answer` mode admits a strict subset of candidates for footnoting. `sources_only` shows the wider pool for user selection.

## Stage-of-loss classification

Given that all 5 questions succeed on today's `answer` path, there is no per-question "stage of loss" for the current build. If we treat "primary source that `sources_only` surfaces but `answer` today does not cite" as a soft loss, the pattern is consistent across the 5:

- Loss stage: **`answer`-mode footnote admission**, not retrieval, not verifier.
- Loss content: Wikisource statute mirrors and non-court knowledge bases (Kol-Zchut, blog explainers) that are demoted to the additional tier.
- For Q03 specifically the demoted-to-additional item that most matters is `nevo.co.il/law_html/law01/255_390.htm` (`צו מס הכנסה` directly under §32(9)). It appears in `sources_only.additional` but not in today's `answer.used_sources`.

## Recommendation (report only — no code changes made)

Because the baseline moved between July 16 and today, the highest-value next step is **not** to pick "one minimal change to `answer` mode to recover stubs." There are no reproducible stubs to recover on these 5.

The single most defensible next step is:

**Re-run the full 18-question quality audit.** The July-16 report is now stale on at least 5 of 18 items — enough that the 28% stub rate and the "retrieval/grounding is the dominant blocker" verdict need to be reconfirmed on today's pipeline before any prioritization work continues. Only after that should you decide whether to invest in the `sources_only` → `answer` bridge below.

If, after the re-audit, `answer` mode still under-cites primary statutes that `sources_only` surfaces (the Q03 pattern above), the smallest useful change would be:

- Extend the `answer`-mode footnote-admission filter to promote a *single* candidate per required statute/section from `sources_only`'s admissible additional tier (`discovery_only`, Wikisource statute mirrors, `nevo.co.il/law_html`) when no candidate in the primary tier already cites the target statute. This reuses the existing admit-list and tangential-inclusion logic from `lib/sourcesOnly.ts` — it does not touch retrieval, planner, verifier prompts, thresholds, or verifier acceptance.

That is a hypothesis, not a proposal. I would not want to implement it before the re-audit tells us whether the problem exists at scale on the current build.

## Files

- Per-question diffs: `reports/differential-audit/candidate-diff/Q03.md` … `Q18.md`
- Raw `sources_only` responses: `reports/differential-audit/sources_only/Q0*.json`
- Raw today `answer` responses: `reports/differential-audit/answer_today/Q0*.json`
- Stored July-16 `answer` telemetry: `reports/differential-audit/answer_telemetry/<qa_log_id>.json`
