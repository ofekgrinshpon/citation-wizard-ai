# source_nomination_grounding_gap_v1 — read-only diagnosis

Status: diagnosis only. No product code changed. Track
`source_nomination_v1_with_verified_source_cache` remains **not accepted**.

Evidence: `qa_logs.metadata.drafter.{source_nomination,query_merge,verified_source_cache,official_source_discovery}`
for the cold-pass runs of 2026-08-24 (D1 `2e597223…`, D3 `d77cd82d…`,
R02 `ac01eee5…`, P02 `7f50f2b6…`, B8 `25fa4118…`).

Telemetry export (goal 2): `/mnt/documents/nomination-validation-5runs-v2-telemetry.md`.
The v1 export omitted the fields because the runner script selects a fixed
field list; the fields **were** written to the database (under
`metadata.drafter`), so all runs are auditable retroactively.

---

## 1. Headline

The grounding failure is **not one bug**. Three independent failures stack:

| # | Failure | Where | Runs affected |
|---|---|---|---|
| A | Nomination returns **zero** candidates — `parse_error: "no tool_call arguments returned"` after escalation to `openai/gpt-5` | `stages/sourceNomination.ts` (model call / tool-args parsing) | D3, R02, P02 (3 of 5) |
| B | Discovery targets are chosen in **list order**, so statutes consume the 2-target cap and the nominated judgment is never attempted | `stages/officialSourceDiscovery.ts:224-228` | D1 |
| C | When every ref is stripped by the gates, the drafter still emits a **substantive answer with 0 citable sources** | `drafterV2` / `metadataOnlyHoldingGate` / `claimSourceMatch` interaction | D3 |

R02 is a fourth, **pre-existing** failure unrelated to this track (body
acquisition for בנק המזרחי), see §4.

---

## 2. Per-run trace

### D1 — proportionality (statute-only answer, 2 footnotes)

| Field | Value |
|---|---|
| nominations produced | 5 (`gpt-5-mini`, 10.7s, no escalation) — 2 statutes, 1 judgment (בג״ץ 1829/91 וינר), 1 Knesset report, 1 scholarship |
| nominations dropped | 3 — רע״א 6841/97 `low_confidence`, בג״ץ 2428/94 `low_confidence`, בג״ץ 6698/95 `total_cap` |
| identifier-bearing | 4 |
| merged queries | 14 final; **4 from nomination**; 0 duplicates; 8 dropped at `total_cap` (planner/facet/judgment_discovery tails) |
| cache lookup attempted | yes, 2 lookups |
| cache result | 2× miss (first-ever run, table empty) |
| official discovery | ran; `targets: 2` |
| targets chosen | N1 חוק יסוד: כבוד האדם וחירותו, N2 חוק יסוד: חופש העיסוק — **both statutes** |
| search queries sent / URLs discovered | none — both attempts ended `not_attempted / no_docket_no_live_lane` in 23ms |
| bodies acquired | 0 · body chars 0 · identity validation not reached |
| cache write | not attempted (nothing acquired) |
| candidate injected | no |
| claim_source_match | 6 refs dropped (`claim_mismatch` ×5, `commentary_in_substantive_block` ×1); 3 unsupported blocks; limitation added |
| footnotes | 2 (both Knesset statute PDFs) |
| citations without body acquired / bodyless judgment citations / metadata-only holdings | 0 / 0 / 0 |
| source available but omitted? | **Yes, structurally**: the one nominated judgment (N4) was kept by nomination and reached query_merge, but was never a discovery target because the cap was spent on statutes. |

**Answers to the specific D1 questions.** Nomination did **not** propose Bank
Mizrahi or Investment Managers (בג״ץ 1715/97) — it proposed בג״ץ 1829/91 וינר
plus two low-confidence dockets that were dropped. So the doctrinal core of
Israeli proportionality was never nominated: this is a **nomination-quality**
gap, on top of the target-ordering bug. Nomination queries did reach
query_merge (4 admitted). Official discovery ran but attempted only statutes,
found no URLs, and acquired no body.

### D3 — HCJ review of rabbinical court property rulings (0 footnotes)

| Field | Value |
|---|---|
| nominations produced | **0** — `gpt-5-mini` returned nothing usable, escalated to `openai/gpt-5`, which returned `no tool_call arguments returned` (31.2s spent, zero output) |
| merged queries | 14 final; 0 from nomination; 6 dropped at cap |
| cache lookup / official discovery | **never ran** — `skip_reason: "no_nominations"` |
| retrieval | 24 candidates; verifier produced 21 model verdicts: 2 direct, 3 partial, 4 tangential, 12 unrelated; **5 usable** |
| metadata_only_holding_gate | applied; `read_in_full: [s3, s4]`, `reference_only: [s1]`, **4 blocks stripped** |
| claim_source_match | 4 drops — `claim_mismatch` ×2, `unrelated_legal_area` ×2 (block area `family_property` vs source area `public_law_hcj`) |
| footnotes / used_sources | 0 / 0 |
| metadata-only holdings remaining | 0 |
| source available but omitted? | **Yes.** Two sources survived as `read_in_full`; they were then stripped from every block by the area/claim mismatch rules, leaving the answer with nothing to cite. |

**Answers to the specific D3 questions.** Nomination proposed **nothing** — not
Bavli (בג״ץ 1000/92), not סימה אמיר (בג״ץ 8497/00), not חוק יחסי ממון: the
stage returned an empty list, so those authorities were never even attempted.
Yes, sources were dropped by `claim_source_match`, and the dominant reason is
an **area mismatch that is arguably wrong**: the question is precisely about
HCJ review (`public_law_hcj`) of a family-property matter
(`family_property`), so the two areas are the same question, not two topics.
And yes — the answer is **far too substantive for 0 citable sources**: it
states when the HCJ intervenes, which grounds apply and what remedies exist,
with only a generic grounding-limitation notice. That is the most serious
product defect in the set.

### R02 — ע״א 6821/93 בנק המזרחי (docket_limitation)

| Field | Value |
|---|---|
| nominations produced | **0** — same `no tool_call arguments returned` failure after escalation (30.2s) |
| nomination skipped for specific_case? | **No.** `skip_reason: null`, `enabled: true` — the stage ran and failed to parse. (`canonical_quote` is the only mode skip.) |
| merged queries | 12 final; required-anchor queries preserved (2 near/exact duplicates folded into `ע"א 6821/93`) |
| cache lookup attempted | **no** — discovery skipped with `no_nominations` |
| official discovery | never ran |
| exact-body fast lane | ran: `exact_docket_source_found: true`, URL `judgments.org.il/…6821-93…`; `text_acquisition_attempted: true`; method `local_db_docket_lookup`; failures `derived_urls_already_probed_in_fast_lane`, `no_local_document_match`; `acquisition_success: false`, `acquired_text_length: 0` |
| candidate pool | 24 candidates, incl. a correctly-identified `ע"א 6821/93` row from Perplexity — **metadata only, no body** |
| final branch | `exact_docket_no_usable_text` → `docket_limitation` |
| footnotes / metadata-only holdings | 0 / 0 |

**Answers to the specific R02 questions.** The docket query still ends in
`docket_limitation` because **no admissible full text was ever obtained**: the
`type=2` court-archive URLs were already probed and rejected in the fast lane,
the local corpus has no matching document, and the one third-party page that
does carry the judgment (`judgments.org.il`) is not an admissible official
source under the identity rules. Nomination was not skipped — it failed. Cache
lookup never ran, because discovery is gated behind having nominations. Even
if it had run, the cache was empty and the docket would have followed the same
derivation path that already failed. **The refusal is correct behaviour on the
evidence available; the gap is acquisition, not gating.**

### P02 / B8 — controls

Both intact. P02: nomination also failed to parse, discovery skipped, correct
refusal, 0 footnotes. B8: `canonical_quote_registry` branch, nomination not
used, 1 official Knesset footnote, exact statutory text. Neither control is
sensitive to this track.

---

## 3. Where the failure sits, stage by stage

| Stage | Verdict |
|---|---|
| nomination | **Broken in 3 of 5 runs** (empty tool-call args on the `gpt-5` escalation) and **weak in the one run it worked** (D1 missed the canonical proportionality authorities, and dropped two dockets at `low_confidence`) |
| query_merge | **Working.** Dedupe, anchor protection and priority ordering behave as designed. Note: 6-8 tail queries are dropped at `total_cap` per run — acceptable, but it means nomination competes with the planner for slots |
| cache lookup | **Never exercised** — 2 lookups total across 5 runs, both cold misses. Unproven, not broken |
| official discovery | **Mis-targeted.** Targets are `filter(identifier-bearing) → slice(0, cap)` in list order, so statutes (always highest confidence) take both slots and judgments never get a lane |
| body acquisition | **Unchanged and still the binding constraint** for canonical judgments (R02) |
| identity validation | not reached in any run |
| candidate injection | not reached in any run (`injected_candidate_ids: []` everywhere) |
| source_integrity / verifier | working — D3 verifier found 5 usable sources |
| claim_source_match | **Over-strict on adjacent areas** (D3: `public_law_hcj` vs `family_property` treated as unrelated), and its stripping has no floor |
| drafter | **Missing a floor.** When stripping leaves 0 citable sources, the answer is still emitted at full doctrinal confidence |

---

## 4. Recommended single next minimal fix

**`nomination_toolcall_reliability_v1`** — make the nomination stage actually
return candidates.

Rationale for choosing this one: nomination is the head of the chain. While it
returns zero candidates in 60% of runs, discovery, the cache and injection are
all dead code paths, and no amount of downstream tuning can be evaluated. It
is also the cheapest fix and it *removes* cost (the failing `gpt-5` escalation
currently burns 30s per run for nothing).

Scope of that fix, when approved:
1. Diagnose and repair the empty-tool-args path in `callOpenAIJsonTool` for
   `openai/gpt-5` (likely reasoning-model tool-call shape), and fall back to
   the `gpt-5-mini` result instead of discarding it.
2. Do not escalate when the mini call already produced candidates.
3. Treat a parse failure as a stage failure with a bounded, cheap retry — never
   a silent empty list.

Deliberately **not** first:
- discovery target ordering (B) — real, but only observable once nominations exist;
- the D3 zero-source substantive answer (C) — the most serious *product* defect,
  and the natural second fix, but it is a drafter/gate floor change that should
  be validated against a working nomination path;
- R02 body acquisition — a separate track (official corpus access), not a
  nomination problem.

Suggested order: A → C → B → R02 acquisition.
