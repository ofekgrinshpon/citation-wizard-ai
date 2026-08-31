# academic_source_utilization_diagnostics_v1 — read-only report

Runs analysed: latest live AW1, AW4, AW7, AW8 after `academic_declared_category_remap_and_body_acquisition_v2`.
No code was changed.

## 0. Funnel at a glance

| Run | Candidates | Acquired bodies | Usable | Pack (refs) | Refs emitted by drafter | Refs kept by CSM | Footnotes | Branch |
|-----|-----------|-----------------|--------|-------------|-------------------------|------------------|-----------|--------|
| AW1 | 30 | 8 | 11 | 9 | 8 | 4 | 2 | normal |
| AW4 | 31 | 7 | 11 | 9 | 13 | 4 | 2 | normal |
| AW7 | 25 | 2 | 11 | 8 | 2 | **0** | **0** | academic limited |
| AW8 | 25 | 15 | 15 | 15 | 14 | 4 | 2 | academic_limited_draft |

The pipeline is no longer starved at the top of the funnel — AW8 carried 15 usable sources with 16k-char bodies.
The loss is now concentrated in two places: **the drafter emits refs for only a fraction of the pack**, and **claim-source-match drops 60–100% of the refs it does emit**.

## 1. Available source inventory (per run)

**AW1** — 9 pack refs. Strong on-topic material: `s9` על תורת הסעדים החוקתיים (verdict **direct**, but body only 334 chars → bibliography-only), `s7` הזכות לקיום בכבוד (partial, 16k body), `s5` המהפכה החוקתית (partial, 16k). Primary anchors present (בג"ץ 73/85 קנית, בג"ץ 5658/23) with metadata/excerpt only.

**AW4** — 9 pack refs. Best available theoretical source `s7` דיון אינטגרטיבי – מידתיות וניתוח מדיניות (**direct**, 16k body). Also `s5` רבע מאה למהפכה החוקתית (partial, 16k). `s6`, `s9` (מבחני המידתיות; האם המחוקק ירה בתותח) are on-topic but bibliography-only stubs (73 / 139 chars).

**AW7** — 8 pack refs, only **2 acquired bodies** in the entire run. Yet the pack held `s5` נדב דגן, מידתיות חוקתית, סבירות מנהלית (**direct**, 16k) and `s7` על חוקתיות ועל סבירות (בקמן) (**direct**, 16k) — both squarely on the question. Court fetches failed (connection resets on supremedecisions), so no primary anchor.

**AW8** — 15 pack refs, the richest pack yet: `s4` הבטחה מינהלית (direct, 16k), `s6` "כגודל הציפייה" (direct, 16k), `s3` הזכות המנהלית והסעד הכספי (partial, 16k), `s9` כריש, תנין ולווייתן (direct, bib-only 128 chars), `s7`/`s8` הגנת ההסתמכות / הבטחה מנהלית: לידתה (bib-only stubs), `s5` בג"ץ 8760/20 (direct excerpt).

## 2. Unused good sources

| Run | Ref | Source | Verdict | Body | Why unused |
|-----|-----|--------|---------|------|------------|
| AW1 | s7 | הזכות לקיום בכבוד | partial | 16k | in pack, drafter never emitted a ref |
| AW1 | s5 | המהפכה החוקתית | partial | 16k | never emitted |
| AW4 | **s7** | **דיון אינטגרטיבי – מידתיות וניתוח מדיניות** | **direct** | 16k | emitted, then dropped twice as `unrelated_legal_area` |
| AW4 | s5 | רבע מאה למהפכה החוקתית | partial | 16k | dropped as `claim_mismatch` |
| AW7 | **s5** | **נדב דגן, מידתיות חוקתית / סבירות מנהלית** | **direct** | 16k | emitted, dropped as `unrelated_legal_area` → answer left with zero citations |
| AW7 | s7 | על חוקתיות ועל סבירות (בקמן) | direct | 16k | in pack, never emitted |
| AW7 | s2 | שיקול הצדק בהחלטות מנהליות | partial | 16k | never emitted |
| AW8 | **s6** | **"כגודל הציפייה" – ביקורת שיפוטית על שינוי מדיניות** | **direct** | 16k | emitted, dropped as `claim_mismatch` (×2) |
| AW8 | s3 | הזכות המנהלית והסעד הכספי | partial | 16k | dropped as `claim_mismatch` |
| AW8 | s9 | כריש, תנין ולווייתן | direct | 128 (bib-only) | dropped: `commentary_in_substantive_block` (no acquired body ⇒ not doctrinally eligible) |
| AW8 | s7, s8 | הגנת ההסתמכות; הבטחה מנהלית: לידתה | partial/direct | bib-only | `insufficient_authority_for_claim_category` |

In every run at least one **direct-verdict, on-topic, fully acquired 16k-char** source went uncited.

## 3. Dropped refs audit

| Run | Ref | Claim category | Drop reason | Verdict |
|-----|-----|----------------|-------------|---------|
| AW1 | s9 (סעדים חוקתיים) | theoretical_explanation | commentary_in_substantive_block | **Defensible but costly** — dropped only because its body is a 334-char stub; re-acquisition failed |
| AW1 | s3, s9 | methodological_framing | commentary_in_substantive_block | Same cause |
| AW1 | s7 | literature_synthesis | claim_mismatch | **Wrong** — s7 is topically bound and a literature-synthesis block is exactly its role |
| AW4 | s7 (×2) | critique / literature_synthesis | **unrelated_legal_area** | **Wrong** — constitutional-proportionality article vs constitutional block; area tags disagree spuriously |
| AW4 | s2 | doctrinal_background | insufficient_authority_for_claim_category | Correct (Knesset committee doc, no body) |
| AW4 | s6, s5, s9 | various | claim_mismatch / commentary_in_substantive_block | Correct (bib-only stubs) |
| AW7 | **s5** | critique_or_counterposition | **unrelated_legal_area** | **Wrong** — the single most on-point source in the run |
| AW7 | s8 (בג"ץ 5658/23) | critique_or_counterposition | insufficient_authority_for_claim_category | Correct (no judgment body) |
| AW8 | s5, s9 | theoretical_explanation | commentary_in_substantive_block | Mixed — s5 is a judgment excerpt (correct); s9 is bib-only (costly) |
| AW8 | s6, s3, s4, s1 | theoretical/literature/background | claim_mismatch | **Wrong for s6** — "כגודל הציפייה" is the on-point administrative-promise article |
| AW8 | s7, s8, s14 | doctrinal_background | insufficient_authority_for_claim_category | Defensible (bib-only) |

Two systematic defects:

1. **Rule D (`unrelated_legal_area`) misfires in academic mode.** It compares a block-level `legal_area` tag with a source-level tag; for constitutional/administrative overlap (מידתיות / סבירות / ביקורת שיפוטית) the two tags disagree even when the source is a direct verdict on the same question. It fires *before* the academic subject-fit check that would have passed the source.
2. **Rule B (`commentary_in_substantive_block`) is gated on `prof.doctrinal_authority`, which requires an acquired substantive body.** Bibliography-only journal articles therefore can never be cited — even in a genre (literature synthesis, reading-list framing) where citing a bibliographic reference is exactly what an academic draft should do.

A third, non-CSM defect: **`claim_mismatch` after rebinding** still drops direct on-topic sources (AW8 s6, AW4 s5) whose rebinding decision came back `unbound` — the rebinder's term-overlap scorer fails on Hebrew morphology for these titles/bodies.

## 4. Source-role coverage vs answer structure

| Role | AW1 | AW4 | AW7 | AW8 |
|------|-----|-----|-----|-----|
| primary_legal_anchor | filled | filled | **missing** | **missing** |
| doctrinal_background_source | filled | filled | filled | filled |
| theoretical_normative_source | **missing** (s9 available) | **missing** (s7 available) | filled | filled |
| literature_synthesis_source | filled | filled | — | filled |
| critique_or_counterposition_source | **missing** | filled | filled | filled |
| implementation_or_example_source | **missing** | filled | filled | filled |

Every "missing" role above except AW7/AW8's primary anchor had a matching source **already in the pack**. This is a utilization gap, not a supply gap.

## 5. Enrichment need assessment

- **AW1** — supply adequate for a framing chapter; the one irreplaceable source (Barak, סעדים חוקתיים) is a stub whose re-acquisition returned empty. Needs *acquisition* help, not more discovery.
- **AW4** — supply fully adequate. Pure utilization loss.
- **AW7** — supply adequate on the secondary side (two direct 16k articles) but zero primary; only 2 bodies acquired out of 25 candidates because the court host reset connections. Needs both utilization fix and acquisition resilience.
- **AW8** — supply excellent (15 usable, 8 with full bodies). Cited 2. Pure utilization loss.

## 6. Pre-enrichment decision

**Do not open a source-enrichment / retrieval track yet.**

A richer, better-sourced answer is achievable from the sources already acquired in all four runs. Ranked by expected gain:

1. **Fix Rule D in academic mode** — skip or demote `unrelated_legal_area` when the ref is a direct-verdict doctrinal secondary that passes `academicTopicalFit`. Directly restores AW7's only citations and AW4's best theoretical source.
2. **Allow bibliography-only academic sources in literature/framing blocks** — permit `literature_synthesis` / `academic_framing` / `methodological_framing` blocks to cite a bib-only journal article as a reading reference, while keeping substantive doctrinal claims body-gated.
3. **Harden the rebinder for Hebrew morphology on titles** — the `claim_mismatch → unbound` path is still dropping direct on-topic articles (AW8 s6, AW4 s5).
4. **Drafter ref coverage** — with 8–15 pack sources the drafter emits refs for only 2–14 and cites 2; the academic prompt should require at least one ref per substantive block when an eligible pack source exists for that role.
5. **Only then** consider acquisition resilience for court hosts (AW7) and stub rescue for legal-journal PDFs (AW1 Barak).

Recommended next track: `academic_utilization_stabilization_v1` (items 1–4), read-only enrichment deferred.
