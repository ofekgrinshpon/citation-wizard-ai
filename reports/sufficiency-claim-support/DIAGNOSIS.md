# sufficiency_and_claim_support_failure_diagnosis_v1

Read-only diagnosis. No code changes. Evidence: the five stored runs in
`reports/source-depth/*.json` (candidates, verifier, drafter telemetry), the gate source
`supabase/functions/legal-research-v1/stages/sourceSufficiency.ts`, the discovery/identity source
`stages/officialSourceDiscovery.ts`, and one live row in `verified_legal_sources`.

---

## 0. Headline

Two independent defects explain everything observed:

1. **Retrieval pollution + no judgment bodies.** In every broad run, 17–18 of 30 candidate slots are
   gov.il court-spokesperson **listing pages** (`authority_tier=index_or_listing`,
   `citable_as=not_citable`), and *no* judgment body was acquired
   (`acquisition_success=false`, `usable_judgment_refs=[]` in D1/D3/B8/ACADEMIC).
   The sufficiency gate then behaves exactly as designed: `usable_judgment` basis is unreachable,
   so it refuses. The gate is the *messenger*, not the primary cause — but three of its predicates
   are also demonstrably over-strict (§7 A2–A4).

2. **A poisoned verified-source cache row.** R02 cites, under the title
   `ע"א 6821/93 בנק המזרחי`, the body of a completely different judgment
   (`בג"ץ 8276/05 עדאלה`). Identity validation passed on a name-token fallback, the row was written
   with `identity_validated=true`, and every later run short-circuits to that row on a cache hit.
   This is the single highest-severity finding in this report.

---

## 1. Source pack received by the sufficiency gate

Counts are per run over the 30 admitted candidates (dropped candidates listed separately).

### D1 — מבחני המידתיות בביקורת חוקתית (broad_research, profile `case_law_synthesis`)

| bucket | n | notes |
|---|---|---|
| listing / non-citable | 19 | all `gov.il/…/spokmanship_court?skip=N` pagination pages |
| citable, metadata-only | 6 | חוק-יסוד: כבוד האדם וחירותו (Knesset PDF, 56 meaningful chars); **ע"א 6821/93 mirror** (judgments.org.il, metadata only); 4 proportionality articles (`source_type:"other"`) |
| citable, usable text | 5 | 1 judgment (**ע"א 7594/16 מולכו נ' בנק מזרחי טפחות** — title-collision noise), 2 law-review articles, 1 Knesset research paper (off-topic: biocides), 1 statute (חוק בינוי ופינוי אזורי שיקום — off-topic) |
| dropped | 10 | `bad_source` (Wikipedia), `discovery_only` (Kolzchut, afiklaw), `class_*_not_admitted_for_binding_case_law` |

Identity/integrity: no rejects; the Bank Mizrahi mirror is `text_usability=metadata_only`,
`has_holding_text=false`. Verifier: 22 verdicts — 1 direct, 7 partial, 14 unrelated.
Body acquisition: `acquisition_success=false`, `acquired_text_length=0`.

### D3 — פיטורי עובדת בהיריון (broad_research, profile `statutory_institution`)

| bucket | n | notes |
|---|---|---|
| listing / non-citable | 17 | same gov.il pagination pages |
| citable statutes with text | 7 | **all off-topic**: תקנות הבטיחות בעבודה ×4, תקנות ביטוח בריאות ממלכתי, חוק בינוי ופינוי, תקנות טרקטורים |
| the actually governing statutes | 2 | **חוק עבודת נשים תשי"ד-1954** and the gov.il dismissal-permit service page — both `metadata_only` |
| on-point scholarship | 1 | "פיטורי עובדות הרות וקריטריון הוותק בחוק עבודת נשים" (`journal_article`, full_text) |
| usable judgment | 1 | a Tel-Aviv District decision on an unrelated jurisdictional question |

Verifier: 30 verdicts — 0 direct, 4 partial, 26 unrelated. `usable_judgment_refs=[]`,
`governing_statute_refs=[]`.

### ACADEMIC — סמינריון על עילת הסבירות (academic_research, shape `list` → profile `practical_steps`)

| bucket | n | notes |
|---|---|---|
| listing / non-citable | 17 | gov.il pagination |
| on-topic commentary | 3 | עילת אי-הסבירות במשפט המנהלי; סבירות במשפט המנהלי; הגנת ההסתמכות — **all `source_type:"other"`, `metadata_only`** |
| on-topic scholarship with text | 2–3 | המהפכה החוקתית…; רבע מאה למהפכה החוקתית; עשרים שנה לבנק המזרחי |
| statutes | 4 | חוק-יסוד: כבוד האדם וחירותו (metadata_only), חוק-יסוד: חופש העיסוק (`unknown`), plus 2 off-topic tax/social-security regulations |

`topical_refs=["s4","s5"]` — the gate *did* see two on-topic sources; it still refused.

### B8 — דוקטרינת ההבטחה המנהלית (narrow_doctrine, profile `statutory_institution`)

| bucket | n | notes |
|---|---|---|
| on-topic commentary | 3 | "על ההבטחה המנהלית", "הבטחה מינהלית לציבור", "הגנת ההסתמכות במשפט המנהלי" — `source_type:"other"`, `metadata_only` |
| usable judgments | 2 | בג"ץ 8638/03 סימה אמיר (full_text) and בג"ץ 4252/17 ג'בארין (excerpt) — neither is an administrative-promise case |
| other | rest | Knesset comparative review (excerpt), unrelated corporate/insurance articles, listing pages |

Verifier: 29 verdicts — 3 direct, 11 partial, 15 unrelated. `topical_refs=["s3"]`,
`topical_authority_refs=[]`.

### R02 — ע"א 6821/93 (specific_case)

| bucket | n | notes |
|---|---|---|
| **cited source (s1)** | 1 | title `ע"א 6821/93 בנק המזרחי נ' מגדל כפר שיתופי`, url `supremedecisions.court.gov.il/…fileName=**SB1_1_8276-05.pdf**&type=4`, 100,924 chars, `full_text`, `official_primary`, `docket_match:true`, flags `verified_source_cache_hit`, `specific_case_text_acquired` |
| real Mizrahi mirror | 1 | judgments.org.il — `metadata_only`, listed only under "sources found, body not read" |
| noise | 28 | 15 gov.il listing pages, 6 unrelated HUJI law-review articles, 3 unrelated Supreme Court PDFs, 1 Knesset research page, 1 unrelated ע"א 7594/16 |

---

## 2. Sufficiency-gate decision per run

| run | profile | reason | usable judgments | governing statutes | topical authority | verdict |
|---|---|---|---|---|---|---|
| D1 | `case_law_synthesis` | `no_usable_judgment_authority` | 0 | (not consulted) | 0 | refuse |
| D3 | `statutory_institution` | `no_statutory_caselaw_or_doctrinal_anchor` | 0 | 0 | 0 | refuse |
| ACADEMIC | `practical_steps` | `generic_procedure_only` | 0 | 0 | 0 (2 topical) | refuse |
| B8 | `statutory_institution` | `no_statutory_caselaw_or_doctrinal_anchor` | 0 | 0 | 0 (1 topical) | refuse |
| R02 | n/a | `required_anchor_satisfied` (exact-docket branch) | 1 (wrong body) | — | — | draft |

Per-candidate verdicts, expressed against the gate's predicates
(`isUsableJudgment`, `isGoverningStatuteLike`, `domainMatch`, `topicalAuthority`):

- **Listing pages (17–19 per run)** — excluded correctly: `index_or_listing` / `not_citable`.
  Not a gate bug; a *retrieval* bug. They consume ~60% of the candidate budget.
- **Metadata-only primaries** (חוק-יסוד PDF, Mizrahi mirror, חוק עבודת נשים) — excluded by
  `isUsableJudgment`/`isGoverningStatuteLike`, which reject `text_usability=metadata_only` outside
  `practical_steps`. Correct in principle (no body ⇒ no holding), but it means the *single most
  relevant statute in D3* contributed nothing.
- **On-topic commentary with `source_type:"other"`** (B8 ×3, ACADEMIC ×3) — excluded twice over:
  `"other"` is not in `DOCTRINAL_TYPES` (`sourceSufficiency.ts:127`), so `topicalAuthority` is empty
  even when `topical_refs` is non-empty; and `metadata_only` blocks any body window.
  **This is the cleanest false negative in the corpus.**
- **On-topic scholarship with full text** (D3 "פיטורי עובדות הרות…", ACADEMIC ×2) — never consulted:
  the statutory-institution branch only counts `domainStatutes`, `usableJudgments`,
  `topicalAuthority`; scholarship with a real body but a title that misses the phrase window is lost.
- **D3 חוק עבודת נשים domain-match failure** — question content tokens are
  `פיטורי / עובדת / בהיריון / היקף / ההגנה`; the statute title is `חוק עבודת נשים`. No token or
  conservative stem (`עובד` vs `עבוד`) intersects, so even had the body been acquired the statute
  would have failed `domainMatch`. Lexical domain matching is too literal for Hebrew construct forms.
- **Was case law required too strictly?** Only in D1: `classifySufficiencyCategory` sees
  "בית המשפט העליון" in the question and forces `case_law_synthesis`, where statutes and scholarship
  can *never* satisfy sufficiency by design (`sourceSufficiency.ts:585-600`). With zero judgment
  bodies acquired, refusal was structurally guaranteed.

---

## 3. Claim-source match

- **D1 / D3 / ACADEMIC / B8** — `claim_source_match: null`, `used_sources: []`, 0 footnotes. The
  gate fired before drafting, so no claim was ever matched, dropped or softened. Note the verifier
  had already graded material as usable (D1: 1 direct + 7 partial; B8: 3 direct + 11 partial) —
  i.e. **the verifier and the sufficiency gate disagree**, and the gate wins.
- **R02** — 4 drafted blocks, all attributed to `s1` (the wrong body). `claim_source_match` dropped
  the `s1` ref from blocks 2–4 (`reason: claim_mismatch`, `unsupported_block_count: 3`) and appended
  the standard limitation notice, leaving one footnote on block 1. So CSM worked *structurally*
  (it detected that s1 does not support the ratio/facts/implications claims) but had no way to detect
  that s1 is **not the requested judgment at all**, so it kept footnote ¹ on the summary claim.

---

## 4. R02 special audit

- **Cited body**: `https://supremedecisions.court.gov.il/Home/Download?path=PediVerdicts%5C62%5C1&fileName=SB1_1_8276-05.pdf&type=4`, 100,924 chars.
- **What it actually is**: the opening text is
  `בג"ץ 8276/05, 8338/05, 11426/05 עדאלה … נ' שר הביטחון, פ"ס ב(1)` — the Adalah / Intifada Torts
  Law judgment volume. It is **not** ע"א 6821/93 and contains no Mizrahi party names or docket.
- **Database evidence** (`verified_legal_sources`):
  `normalized_docket=aa:6821/93`, `canonical_title="ע\"א 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי"`,
  `official_url=…SB1_1_8276-05.pdf`, `identity_validated=true`,
  `identity_terms_matched=["aa:6821/93"]`, `status=verified`, `discovery_strategy=retrieved_official_url`,
  written `2026-08-24 21:33:34Z`. R02 in this validation set was a pure `cache_hit`
  (`official_source_discovery.attempts[0].result="cache_hit"`, `urls_attempted: []`) — no fetch, no
  re-validation.
- **How it passed identity**: `validateJudgmentIdentity` (officialSourceDiscovery.ts:344-373) accepts
  a body either when the docket appears in it, or via the fallback "≥2 party/name tokens **plus** a
  court marker or the year". A 100 KB פ"ד volume PDF trivially contains the court marker and two of
  `בנק / המזרחי / מגדל / כפר / שיתופי / מאוחד`. The cache write at line 998 then records
  `identity_terms_matched: identity.docket_match ? [docket] : toks` — the stored value is the docket,
  which **misrepresents a name-token match as a docket match** and destroys the audit trail.
- **Why the answer is contentless / off-subject**: the drafter had 100 KB of an unrelated judgment
  and no Mizrahi text, so it produced placeholder prose ("ההנמקה המרכזית מופיעה בפסק-הדין הרשמי…")
  and, in other runs of the same cache row, substantive content drawn from whatever the wrong PDF
  discusses. Nothing in the pipeline compares the cited body's internal docket against the request
  after a cache hit.
- **Classification**: **(a) wrong source body**, caused by weak identity validation, compounded by
  **(b) metadata/title collision** persisted in the cache. Not (c) hallucination — the drafter faithfully
  hedged. Partly (d): CSM caught 3 of 4 blocks but cannot catch identity errors. Not (e).
  (f) is true for block 1 only.

---

## 5. D1 special audit

- Pack contained: **חוק-יסוד: כבוד האדם וחירותו** (metadata_only), the **ע"א 6821/93 mirror**
  (metadata_only), and 6 proportionality-specific academic pieces
  ("המהפכה החוקתית…", "רבע מאה למהפכה החוקתית", "המידתיות כאמת מידה למימוש זכויות אדם",
  "עליית המידתיות…", "מידתיות חוקתית, סבירות מנהלית", "אחרי עשרים שנה: הרהורים… בשיח המידתיות").
- **No leading proportionality judgment body was acquired.** The only full-text judgment in the pack
  is ע"א 7594/16 מולכו נ' בנק מזרחי טפחות — a name-collision artifact of the "בנק מזרחי" query, and
  legally irrelevant.
- Refusal cause: `profile=case_law_synthesis` ⇒ `usableJudgments.length>=1` is mandatory ⇒ 0 ⇒
  `no_usable_judgment_authority`. Statutes and the six on-point academic sources are **not consulted
  at all** on this branch.
- Was it too strict? For a "what are the tests and how did the court apply them" question, requiring
  a judgment body is defensible for *application* claims but not for the *black-letter test statement*,
  which סעיף 8 לחוק-יסוד plus doctrinal scholarship fully support.
- Recommended posture: allow a **bounded doctrinal answer** — statute + scholarship may state the
  four-limb test and the constitutional anchor, with an explicit limitation that no judgment body was
  read and therefore no application/ratio claims are made. That is strictly safer than today's total
  refusal, which teaches users the corpus is empty when it is not.

---

## 6. Bibliography-only handling (ACADEMIC)

- The request is literally "מצא לי מקורות: חקיקה, פסיקה, מאמרים אקדמיים ודוחות ועדות".
- `output_shape` resolved to `list` → `classifySufficiencyCategory` → `practical_list` →
  `resolveProfile` → **`practical_steps`**, a profile designed for "how do I file X, what is the fee".
  Its gate asks for governing regulations/procedural sources, finds none, and returns
  `generic_procedure_only`.
- So a *source-discovery* request is being judged by a *claim-support* standard. The run had at least
  5 genuinely on-topic reasonableness sources (2 with full text) and returned zero of them to the user.
- Correct behaviour: `academic_research` should be allowed a **bibliography-only output mode** — a
  structured, grouped source list (חקיקה / פסיקה / מאמרים / דוחות) with URLs and an explicit banner
  that these are *reading suggestions, not claim-support citations*, and that no legal proposition is
  being asserted. This needs no gate loosening because no legal claim is made.

---

## 7. Root-cause classification

### Class A — over-refusal / over-strict sufficiency

| # | cause | evidence | runs |
|---|---|---|---|
| A1 | **source not acquired** (dominant): 0 judgment bodies; `acquisition_success=false` | D1/D3/B8/ACADEMIC | all four |
| A2 | **wrong source type bucket**: on-topic commentary carries `source_type:"other"`, absent from `DOCTRINAL_TYPES` ⇒ `topicalAuthority=[]` despite `topical_refs` non-empty | `sourceSufficiency.ts:127`, B8 `topical_refs:["s3"]`, ACADEMIC `["s4","s5"]` | B8, ACADEMIC |
| A3 | **sufficiency too strict**: `case_law_synthesis` refuses even when statute + 6 on-point articles are present | D1 | D1 |
| A4 | **sufficiency too strict (lexical)**: Hebrew construct forms defeat `domainMatch` (`עובדת` vs `עבודת`) | D3 | D3 |
| A5 | **bibliography-only mode missing**: source-discovery request routed to `practical_steps` | ACADEMIC | ACADEMIC |
| A6 | **retrieval pollution**: 17–19/30 candidate slots are gov.il spokesperson pagination pages | all runs | all |
| A7 | verifier↔gate disconnect: verifier `direct`/`partial` verdicts are discarded outside the `case_law_synthesis` direct-judgment carve-out | D1, B8 | D1, B8 |

Not observed: `acquired but source_integrity dropped` (integrity rejected nothing on-topic);
`acquired but verifier dropped`.

### Class B — under-protection / wrong claim support

| # | cause | evidence | run |
|---|---|---|---|
| B1 | **metadata/title collision persisted in cache**: `aa:6821/93` → Adalah PDF, `identity_validated=true` | `verified_legal_sources` row `8a9e614f…` | R02 |
| B2 | **identity validation too weak**: name-token fallback on 100 KB volume PDFs; docket never required for docket-bearing requests | `officialSourceDiscovery.ts:344-373` | R02 |
| B3 | **cache hits bypass re-validation**: `result:"cache_hit"`, `urls_attempted: []` — no post-hoc docket check on the served body | `official_source_discovery.attempts[0]` | R02 |
| B4 | **claim-source-match too weak for identity**: CSM verifies claim↔source topical alignment, never source↔requested-authority identity; footnote ¹ survived on an unsupported summary claim | `claim_source_match` telemetry | R02 |
| B5 | drafter hallucination: **not** present (contentless hedging, not invented holdings) | R02 answer text | — |

Expected safe refusal: none of D1/D3/B8/ACADEMIC qualifies. All four had genuinely relevant,
citable-in-principle material in the pack.

---

## 8. Recommended smallest next implementation

Ordered by risk-weighted value.

1. **E — `source_metadata_identity_hardening_v1` (do first, it is a correctness bug in production data).**
   Scope: (i) purge/quarantine the poisoned `verified_legal_sources` row and any row whose
   `official_url` filename docket contradicts `normalized_docket`; (ii) when a request carries a
   docket, require `docket_in_text` — forbid the name-token fallback for docket-bearing nominations;
   (iii) store the honest `identity_terms_matched` (never relabel a token match as a docket match);
   (iv) re-validate identity on cache hits before injecting the body.
   This alone fixes R02, so **D is subsumed by E and should not be opened separately.**

2. **A — `broad_doctrine_sufficiency_tuning_v1`.** Narrow, telemetry-guarded:
   admit `source_type:"other"` into `DOCTRINAL_TYPES` when `citable_as="commentary"` and the tier is
   real; let `case_law_synthesis` fall back to a **bounded doctrinal answer** (statute + ≥2 on-topic
   scholarship, explicit "no judgment body was read" limitation, no application/ratio claims) instead
   of a full refusal; extend construct-form matching so `עובדת`↔`עבודת` intersect. Keep the hard rule
   that metadata-only sources never carry a holding.

3. **C — `academic_bibliography_output_mode_v1`.** Route `academic_research` (and explicit
   "מצא לי מקורות") to a bibliography-only shape that bypasses the claim-support gate entirely and
   returns a grouped, labelled source list with a no-legal-assertion banner.

Not recommended now: **B** (`claim_source_match_stricter_specific_case_v1`) — CSM already flagged 3/4
R02 blocks; tightening it further without fixing identity would only add noise.
**F** (`drafter_grounding_constraint_v1`) — no hallucination was observed; the drafter hedged correctly.
**G** is not applicable: two real defects are confirmed.

Also worth queuing separately (out of scope for the three above, but the largest single lever on
recall): suppressing `gov.il/…/spokmanship_court?skip=N` pagination pages at retrieval time, which
would return ~60% of the candidate budget to real authority.
