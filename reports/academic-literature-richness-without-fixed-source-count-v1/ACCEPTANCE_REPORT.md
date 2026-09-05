# academic_literature_richness_without_fixed_source_count_v1 — Acceptance Report

Deployed: `legal-research-v1`. No fixed source or citation count was introduced anywhere.

## What was implemented

1. **`stages/academicLiteratureRichness.ts` (new)** — count-free machinery:
   - `scoreLiteratureTopicality` — deterministic subject-stem overlap between the question and a candidate (direct / adjacent / off-topic).
   - `isLiteratureOnlyRequest` — Hebrew detection of "literature review only / no case-law review" requests.
   - `decideBodyBudget` — topical gate deciding which candidates may consume body-acquisition budget.
   - `selectLiteraturePack` — dynamic, role-aware pack membership with **no minimum and no maximum count**.
   - `assessResearchRichness` — sufficiency verdict: `rich_enough` | `thin_but_honest` | `thin_due_to_pipeline_loss` | `unsafe_or_off_topic`, plus a mandatory limitation directive whenever the result is not rich.
   - `literatureSynthesisDirectives` — named-source synthesis instructions; forbids anonymous "הספרות טוענת" without a cited source.

2. **`stages/secondaryBodyAcquisition.ts`** — accepts `question` + `literature_mode`; body budget is now spent on direct topical scholarship first, and in literature mode candidates with no shared subject vocabulary are refused *before* any fetch. Emits `academic_body_budget_decision` and `body_budget_decisions`.

3. **`stages/academicCandidateAdmission.ts`** — validated **article identity** (recognised law-journal name, or author + scholarly title) now counts as provenance, so real Israeli scholarship served from a mirror or an unrecognised host is no longer auto-rejected as `no_credible_academic_provenance` / `citation_aggregator_or_search_index`. Anti-SEO, listing, marketing, off-topic and integrity gates unchanged. Added journals/institutes (השילוח, המכון הישראלי לדמוקרטיה, ניירות מדיניות). New telemetry: `topicality_score`, `detected_journal_or_institution`.

4. **`stages/perplexityRetrieval.ts`** — admission rows now carry `academic_topicality_score` and `academic_detected_journal`.

5. **`stages/drafterV2.ts`** — for literature-only academic runs the fixed three-source floor of `academicPackFit` is replaced by `selectLiteraturePack`; the pre-draft richness verdict, its limitation directive and the named-synthesis directives are injected into the prompt; telemetry `literature_pack_selection`, `research_richness_sufficiency`, `literature_only_request`.

6. **`index.ts`** — passes the question and literature mode into secondary body acquisition.

Typecheck of the changed stages passes (remaining errors in `drafterV2.ts` / `judgmentTextAcquisition.ts` pre-date this track). Vitest: 31 files / 307 tests pass.

## Live validation (2 literature-only queries)

| | L1 (עילת הסבירות) | L2 (הבטחה מנהלית) |
|---|---|---|
| run_id | `6c18e85f-b694-4346-b033-063c05dbdd87` | `dc94c576-65ee-4786-8019-9831305cfec3` |
| duration | 270,689 ms | 224,081 ms |
| candidates found | 92 | 80 |
| admitted as scholarship at the gate | 5 (was 0–1 pre-fix) | 2 |
| body budget considered / kept | 5 → 3 | 3 → 1 |
| bodies acquired | 3 (HUJI law journal ×2, Haifa PDF) | 1 |
| final pack | 2 | 1 |
| footnotes | 1 | 1 |
| off-topic body spend | 0 | 0 |
| richness verdict | `thin_but_honest` | `thin_but_honest` |
| limitation sentence present in answer | yes | yes |

Full answers: `L1_answer.md`, `L2_answer.md` (in `reports/literature-only-richness-validation-v1/`).

## Assessment

Improved, but not yet rich:

- **Fixed.** Off-topic body spend is now zero (previously travel agencies, corporate law, consumer credit, cyber-risk consumed budget). Strong Israeli scholarship on journal hosts is admitted instead of rejected (`שלילת ביקורת שיפוטית של "סבירות ההחלטה"`, `עילת הסבירות: בין שלטון החוק לשיקול דעת שיפוטי`, `שיקול דעת מנהלי וסבירות`, `אקטיביזם שיפוטי והדיון שאיננו — השילוח`). Both answers now declare their own limitation instead of pretending to survey the field. No filler, no case-law/statute padding.
- **Remaining loss — post-acquisition, not admission.** In L1 three scholarship bodies were acquired but only two reached the drafter pack and only one was cited. The loss now sits between body acquisition and the pack (verifier usability + claim-source match), not in admission or body budget.
- L2's single pack source (דגן, on reasonableness/proportionality) is only adjacent to administrative promise; direct Israeli literature on הבטחה מנהלית (e.g. ידין) was still not retrieved as a fetchable body.

**Recommendation for the next track:** `post_acquisition_scholarship_survival_v1` — make an acquired, on-topic scholarship body survive verifier usability and claim-source match in literature mode, and report per-source why an acquired body never reaches the pack.

## Prohibitions honoured

No extra model pass, no fixed source/citation minimum, no global retrieval inflation, no unsafe or unverified citations, no case/statute filler, no Hebrew style changes.
