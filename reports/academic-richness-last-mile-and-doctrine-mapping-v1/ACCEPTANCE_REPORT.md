# academic_richness_last_mile_and_doctrine_mapping_v1 — Acceptance Report

Status: **partially accepted**. The four implemented items work and are verified live, but
final citation richness is still thin (3 footnotes / 3 distinct sources per academic answer).

## 1. What was implemented

1. **Footnote builder last-mile materialization** (`stages/footnoteBuilder.ts`)
   - Mixed primary/secondary blocks no longer delete secondary sources block-wide; secondary
     sources are relocated per-sentence.
   - New `footnote_materialization[]` (per-source decision + explicit reason) and
     `footnote_builder_richness_summary` telemetry, wired through `drafterV2.ts` and persisted
     in `qa_logs.metadata.drafter`.
   - No fixed footnote targets, no safety-gate weakening, no unsupported citations.
2. **Doctrine mapping / canonical registry** (`stages/coreAuthorityRegistry.ts`)
   - Scored signal / negative-signal mapping (`mapDoctrine`), new `administrative_promise`
     family (סאי-טקס 135/75, גדות 5018/91, קלכמן 585/01), widened reasonableness signals,
     rabbinical/property family protected by negative signals.
   - Telemetry: `doctrine_mapping` + `canonical_registry_selection` (durable checkpoint
     `doctrine_mapping_v1`).
3. **Academic provenance repair** (`stages/academicCandidateAdmission.ts`)
   - Israeli law journals (הפרקליט, משפטים, עיוני משפט, ...), university/faculty hosts,
     article/PDF/DOI signals now count as credible provenance; blogs/SEO/marketing/mirrors
     still rejected.
4. **Academic-only pool/backfill tuning** (`stages/candidatePool.ts`)
   - `academic_mode` raises the origin-diversity cap and allows distinct topical sources from
     the same origin; safety/dedup/listing/integrity gates unchanged; `pool_collapse` telemetry
     (durable checkpoint `pool_collapse_v1`). Non-academic paths untouched.

Typecheck clean; Vitest 29 files / 300 tests pass (incl. new `src/test/doctrineMapping.test.ts`).

## 2. Live validation (deployed build)

| run | question | run_id | ms | raw found | final pool | footnotes |
|---|---|---|---|---|---|---|
| Q1 | עילת הסבירות | 298abd35-860d-4ab3-bff2-13cf9797aad6 | 244,329 | 287 | 11 | 3 |
| Q2 | הבטחה מנהלית / ציפייה לגיטימית | 3e6e8577-8b61-4060-9bc4-19bfcb574cc0 | 248,249 | 305 | 30 | 3 |
| Q2S | statutory text | 71035b85-76e9-4c8d-b69b-be6a5f97227c | — | 44 | 20 | 0 |
| Q3 | מידתיות | 6f45fe76-0562-42ce-a538-423cf6aafcf2 | 162,215 | 129 | 23 | 2 |
| AW7 | academic | 8fd51532-6976-417c-a8e3-aa234352c6be | 151,893 | 120 | 6 | 1 |

Baseline before this track: Q1 = 2 footnotes, Q2 = 2 footnotes.

### Doctrine mapping (fixed)

- Q1 → `reasonableness` (score 3 vs proportionality 1), family `public_law_hcj`,
  nominated: `hcj_389_80_dapei_zahav`, `hcj_935_89_ganor`, `hcj_5658_23_reasonableness_amendment`.
  `rabbinical_civil_property` rejected by negative signal.
- Q2 → `administrative_promise`, nominated: סאי-טקס, גדות, קלכמן. (Previously
  `rabbinical_civil_property`.)
- Q3 → `proportionality` preserved. No regression.

### Pool collapse (improved)

- Q1: 287 → 283 (listing/precision) → pool 11 (was 5+2). Drops: dup_document_id 60,
  backfill_origin_diversity_cap 20 (cap raised 3 → 4).
- Q2: 305 → 292 → pool 30 (was 25). `backfill_origin_diversity_cap` drops = **0**
  (was 219). Cap raised 8 → 12.

### Footnote builder last mile (fixed)

Both runs: `collapsed_by_cap: 0`, `collapsed_by_duplicate: 0`, `collapsed_by_paragraph_rule: 0`,
`collapsed_without_valid_reason: 0`, `approved_but_not_rendered: []`,
`approved_distinct_sources == final_distinct_sources == 3`.

The previously reported `footnote_builder_or_reference_only` losses are no longer caused by
the builder: everything approved at the builder's input is now rendered. Sources that still
carry that funnel label (e.g. נדב דגן in Q1) are marked *reference-only* by claim-source match
before the builder, not dropped by it.

## 3. Where richness is still lost

Q1 funnel highlights:

| source | role | found | admitted | body | in_pack | representative | emitted | survived | cited | loss_reason |
|---|---|---|---|---|---|---|---|---|---|---|
| בג״ץ 389/80 דפי זהב | binding_case_law | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | claim_source_match_removed_ref |
| חוק-יסוד: כבוד האדם וחירותו | primary_statute | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| בג״ץ 5658/23 | binding_case_law | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | — |
| נדב דגן, מידתיות חוקתית סבירות מנהלית | scholarship | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | reference_only (CSM) |
| חוברת סיכום כנסת 20 | primary_statute | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | no_acquired_body_or_weak_fit |
| נייר עמדה: עילת הסבירות | primary_statute | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | no_acquired_body_or_weak_fit |

Canonical authorities: דפי זהב is now **nominated, discovered, body-acquired and emitted** —
it dies at claim-source match. גנור is nominated and discovery-queried but no usable body is
acquired (Supreme Court endpoints still return 502 / 0 bytes via the relay). 5658/23 is cited,
but through a commercial mirror rather than the official text.

## 4. Diagnosis

The answers are **still thin**, but the loss stage has moved. It is no longer:
doctrine mapping (fixed), pool collapse (largely fixed), academic provenance (fixed) or the
footnote builder (zero unexplained collapses).

Current limiters, in order of impact:

- **b. dedicated relay / judgment body acquisition** — canonical judgments (גנור, official
  5658/23, סאי-טקס/גדות/קלכמן) are nominated and discovered, but official court endpoints
  return 502/0 bytes, so they never become citable bodies.
- **f. CSM/alignment over-pruning** — דפי זהב is body-acquired and emitted yet removed by
  claim-source match; נדב דגן survives alignment but is demoted to reference-only.
- **e. drafter under-use** — with a 4–7 source pack the model emits only 3–5 refs.

## 5. Recommendation

`fix_dedicated_relay_or_court_pdf_acquisition`

Secondary follow-up once bodies land: loosen claim-source-match removal / reference-only
demotion for nominated canonical authorities that are already body-acquired and emitted.
