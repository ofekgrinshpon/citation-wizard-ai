# sufficiency_false_negatives_and_topical_matching_v1 — Phase 1 (read-only diagnosis)

Track opened after closing `metadata_only_holding_gate_v1` (stable-initial / monitor).
No code changes in this phase. Evidence: `reports/golden-audit-post-specific-case/*.json`,
`reports/metadata-only-holding-gate/*.json`, and the current source of
`stages/sourceSufficiency.ts`, `stages/requiredAnchors.ts`,
`stages/statuteSectionDetection.ts`, `stages/drafterV2.ts`.

---

## 1. G07 — מבחן ההשתלבות (case-law synthesis refusal)

| # | Field | Value |
|---|---|---|
| 1 | Query | מה הפסיקה אומרת על מבחן ההשתלבות לקביעת יחסי עובד-מעביד? |
| 2 | Mode / shape | `case_law_synthesis` / `analysis` |
| 3 | Branch | `insufficient_sources_limitation` (drafted=false) |
| 4 | Pool | 30 admitted — official_primary 11, secondary_commentary 10, statute_mirror 4, primary_mirror 3, index 2; judgment_documents 1, judgments_with_holding_text 1 |
| 5 | Verifier | direct 3, partial 12, tangential 7, unrelated 8 |
| 6 | Primary authority present | Yes — 7 primary_statute, 9 binding_case_law role-tagged |
| 7 | Body-acquired judgments | 1 (דמ"ר 26126-06-11, substantive_excerpt) |
| 8 | Statutes | חוק הביטוח הלאומי present, metadata_only-heavy (21/30 metadata_only) |
| 9 | Topical refs counted | 0 |
| 10 | Why nothing counted | `profile=case_law_synthesis` requires `usableJudgments ≥ 1 AND (topical ≥ 1 OR directJudgment ≥ 1)`. `isTopical` only inspects `title + snippet`; the phrase "מבחן ההשתלבות" never appears in the judgment's title (`פסק-דין בתיק דמ"ר 26126-06-11`) and the drafter-visible snippet is a truncated body slice. The judgment's verifier verdict was not `direct`, so the direct-judgment escape hatch did not fire either. Result: authority exists, sufficiency cannot see it. |
| 11 | Still justified post-gate? | **No.** The metadata gate is irrelevant here — the pack contains a body-acquired judgment plus primary statutes. This is a pure topical-matching false negative. |
| 12 | Minimal fix candidate | (a) run `isTopical` over the **acquired body text**, not just title+snippet; (b) accept a body-acquired, domain-matched judgment with verifier `direct` **or** `partial` as topical grounding for case_law_synthesis. Both stay inside the "body-acquired primary authority" allowance. |

### G07 vs G17 (same doctrine, opposite outcome)
G17 (`כתוב סקירת פסיקה על מבחן ההשתלבות בדיני עבודה`) resolved to
`doctrine_explanation` → still `profile=case_law_synthesis`, and it **passed** with 12 used
sources. Decisive difference: G17's pool surfaced the *same* psakdin judgment
(דמ"ר 26126-06-11, `secondary_commentary` tier, `substantive_excerpt`) **with a snippet that
carried the doctrine phrase**, so `topical ≥ 1`. Nothing legal distinguishes the two runs —
the outcome turned on whether a doctrine phrase happened to survive snippet truncation.
That is the core defect of this track.

---

## 2. G08 — מבחני המידתיות (refusal → now drafts)

| # | Field | Value |
|---|---|---|
| 1 | Query | מה הפסיקה אומרת על מבחני המידתיות בביקורת חוקתית? |
| 2 | Mode / shape | `case_law_synthesis` / `analysis` |
| 3 | Branch (golden run) | `insufficient_sources_limitation`; **post-gate run (job 9a21a306 / run 8c4d1ef2): drafted, no branch** |
| 4 | Pool (golden) | 26 admitted — secondary_commentary 16, official_primary 3, index 3, mirrors 4; judgment_documents 3, with holding text 1 |
| 5 | Verifier (golden) | direct 7, partial 12, tangential 3, unrelated 4 |
| 6 | Primary authority | 10 binding_case_law, 4 persuasive_case_law, 2 primary_statute |
| 7 | Body-acquired judgments | golden 1; post-gate run **2** (בג"ץ 6732/20 + gov.il judgment), both `read_in_full` |
| 8 | Statutes | חוק-יסוד: כבוד האדם וחירותו present, thin |
| 9 | Topical refs counted (golden) | 0 |
| 10 | Why | Same mechanism as G07 plus a stemming artifact: `stemHebrew("מידתיות")` strips the `ה` prefix and the `יות` suffix → `ידת`, which does not intersect source stems. Seven `direct` verdicts existed but none was attached to a source that also passed `isUsableJudgment` **and** phrase-topicality in the golden draw. |
| 11 | Still justified post-gate? | **No** — and it is already self-correcting: the post-gate rerun drafted 2,928 chars, 4 used sources, 2 body-acquired judgments cited, `metadata_only_cited = 0`, `metadata_only_holdings_remaining = 0`, s4/s6 correctly demoted to reference-only. |
| 12 | Minimal fix candidate | Fix `stemHebrew` prefix-stripping so it does not strip `ה`/`מ` when the residue drops below the lexical core (guard on stem length ≥ 4 for suffix+prefix double-strip), and count verifier-`direct` body-acquired judgments as topical. No retrieval change needed — the sources were already there. |

### G08 vs its own passing run
Outcome variance is retrieval-draw variance, not legal grounding. Sufficiency must not be the
component that converts a draw difference into a refusal.

---

## 3. G11 — סעיף 6 לחוק החברות (statute-section refusal)

| # | Field | Value |
|---|---|---|
| 1 | Query | מה קובע סעיף 6 לחוק החברות, תשנ"ט-1999 בעניין הרמת מסך? |
| 2 | Mode / shape | `statute_section_definition` / `definition` |
| 3 | Branch | `statute_section_limitation` (drafted=false, 1 footnote) |
| 4 | Pool | 21 admitted — official_primary 8, secondary_commentary 8, index 3, mirrors 2; 0 judgments |
| 5 | Verifier | direct 1, partial 6, tangential 4, unrelated 10 |
| 6 | Primary authority | 11 primary_statute — including the official gov.il full Companies Law PDF |
| 7 | Body-acquired judgments | 0 (not required for this shape) |
| 8 | Statutes | The governing statute **was retrieved** but is `metadata_only` (see `used_sources[0]`, usability `metadata_only`) |
| 9 | Topical refs | n/a — sufficiency never ran (`sufficiency_profile = null`); the anchor guard fired first |
| 10 | Why | `pickAnchorsRequiringDrafterLimitation` demands `verified_support === "direct"` for definition/quote shapes, and `candidateHasDirectStatuteSectionText` reads only `title + snippet`. The statute PDF's body was never extracted — `judgmentTextAcquisition` acquires **judgment** bodies only; there is no statute-body acquisition path. So a `direct` verdict is normalized down to `partial` and the limitation branch fires. |
| 11 | Still justified post-gate? | **Partly.** Refusing to quote section text we never read is correct. Refusing to say anything at all about ס' 6 while holding the official statute source is over-refusal. |
| 12 | Minimal fix candidate | Statute-section **visibility** fix: allow a bounded statute-body acquisition for the anchor's official/primary statute source (reuse the existing bounded/chunked `postExtract` path, no new retrieval queries), and re-evaluate `candidateHasDirectStatuteSectionText` against the acquired body. If acquisition fails, keep the refusal but make the wording source-scoped ("לא אותר נוסח מלא", already the case). |

### G11 vs G10
G10 (`סעיף 8א לחוק הירושה`) drafted because it resolved to `doctrine_explanation` →
`statutory_institution` profile, where a domain-matched statute is enough and no verbatim
section text is required. Identical evidentiary posture, different mode classification →
different outcome. Mode-consistent sufficiency profiles are therefore in scope.

---

## 4. G12 — פסקת ההגבלה, ס' 8 חוק-יסוד (quote refusal)

| # | Field | Value |
|---|---|---|
| 1 | Query | מהו הנוסח המדויק של סעיף 8 לחוק יסוד: כבוד האדם וחירותו (פסקת ההגבלה)? |
| 2 | Mode / shape | `canonical_quote` / `quote` |
| 3 | Branch | `statute_section_quote_refusal` |
| 4 | Pool | 14 admitted — official_primary 6, secondary_commentary 6, mirror 1, index 1 |
| 5 | Verifier | direct 2, partial 8, tangential 3, unrelated 1 |
| 6 | Primary authority | 12 primary_statute, incl. the Knesset official PDF `yesod3.pdf` |
| 7 | Body-acquired judgments | 0 (n/a) |
| 8 | Statutes | Official Knesset PDF retrieved, `metadata_only` |
| 9 | Topical refs | n/a — quote shape bypasses sufficiency |
| 10 | Why | `STATUTE_SECTION_CANONICAL_TEXT` registers exactly one entry: `basic_law_dignity-s1`. Section 8 of the same statute is unregistered, so `getStatuteSectionCanonicalText` returns null and the deterministic quote path refuses by design. |
| 11 | Still justified post-gate? | **Justified as a safety posture, wrong as a product outcome.** The user asked for the verbatim text of the most-quoted provision in Israeli constitutional law, and we hold the official source that contains it. |
| 12 | Minimal fix candidate | Additive registry entry for `basic_law_dignity-s8` with vetted official wording and `official_source_url = yesod3.pdf` — exactly the mechanism that makes B8 byte-identical today. Zero logic change, zero regression surface. Optionally the same for other high-frequency sections, one at a time, human-vetted. |

### G12 vs B8
B8 (`צטטו את סעיף 1 לחוק יסוד: כבוד האדם וחירותו`) succeeds through
`canonical_quote_registry` with byte-identical text. The only difference between B8 and G12
is registry coverage.

---

## 5. Cross-cutting conclusions

1. **Two distinct failure families, not one.**
   - *Topical-matching blindness* (G07, G08): authority is present and body-acquired, but
     `isTopical` inspects only `title + snippet`, and Hebrew stemming over-truncates
     (`מידתיות → ידת`). Refusal is a matching artifact.
   - *Statute-text visibility* (G11, G12): the governing statute source is in hand but its
     text was never acquired (G11) or never registered (G12). Refusal is a coverage artifact.
2. **Mode classification, not legal grounding, decides outcomes.** G07 vs G17 and G11 vs G10
   are the same legal questions with different phrasings and opposite results.
3. **No retrieval expansion is required.** In all four cases the needed source was already in
   the admitted pool. This satisfies the track's "no retrieval expansion unless diagnosis
   proves otherwise" constraint — diagnosis proves the opposite.
4. **The metadata-only gate is not the cause of any of these refusals** and must not be
   loosened: G08's passing run cites 2 body-acquired judgments with 2 metadata-only sources
   correctly demoted to reference-only.

## 6. Proposed minimal fix set (for approval — not implemented)

| # | Fix | Targets | Risk |
|---|---|---|---|
| F1 | Extend `isTopical` / `domainMatch` to the acquired body text, not only title+snippet | G07, G08 | Low; body-acquired only, no commentary widening |
| F2 | Accept body-acquired, domain-matched judgment with verifier `direct` (and `partial` when a statute anchor is also domain-matched) as topical grounding | G07, G08 | Low; still forbids metadata-only and commentary-only |
| F3 | Guard `stemHebrew` against over-stripping (`מידתיות → ידת`) | G08 and Hebrew queries generally | Low; domain matching only, never dockets/quotes/anchors |
| F4 | Mode-consistent profile: `statute_section_definition` where the section text was **not** acquired falls back to the `statutory_institution` contract (explain the institution, refuse verbatim quoting) instead of a full refusal | G11 | Medium; needs explicit "no verbatim section text" contract |
| F5 | Bounded statute-body acquisition for the anchor's official statute source, reusing `postExtract` | G11 | Medium; CPU-bounded path already exists and is proven |
| F6 | Additive canonical registry entry for `basic_law_dignity-s8` | G12 | Very low |

**Explicitly out of scope / forbidden and untouched by F1–F6:** commentary-only sufficiency,
metadata-only holding support, specific_case identity, fake-docket handling, drafter
prompt/model changes, retrieval expansion.

## 7. Validation plan once a fix set is approved

Run G07, G08, G11, G12, G13, G15, G17, R02, P02, B8 sequentially (CONC=1, poll by `job_id`,
terminal status only). Acceptance as stated in the track brief.
