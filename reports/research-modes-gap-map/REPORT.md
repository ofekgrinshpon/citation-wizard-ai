# Research Modes Gap Map — design diagnostic

Date: 2026-07-28. **Diagnostic only.** No code, prompt, retrieval, allowlist or dictionary changes were made.
Grounded in the current merged state of `supabase/functions/legal-research-v1/` (analyzer, planner, `localRetrieval`, `perplexityRetrieval`/`perplexityHygiene`, `candidatePool`, `verifier`, `requiredAnchors`, `statuteSectionDetection`, `docketDetection`, `sourceSufficiency`, `drafterV2`).

---

## 0. What the pipeline actually has today (mode-relevant control surfaces)

| Control surface | Where | Values it can take | Mode-awareness |
|---|---|---|---|
| `answer_intent.output_shape` | `claimAnalyzer.ts` (LLM) | quote, definition, list, timeline, case_holding, analysis, comparison, unknown | **This is the de-facto mode field.** It is a *formatting* hint by design, not a research-strategy field. |
| Shape override (bidirectional) | `drafterV2` + `statuteSectionDetection` | forces `definition` for "מה קובע סעיף X", demotes wrong `quote`/`definition` | Deterministic, statute-section only |
| Required anchors | `requiredAnchors.ts` (docket + statute section) | satisfied / missing | Only for dockets and statute sections |
| Deterministic drafter branches | `drafterV2.ts` | `canonical_quote_registry`, `canonical_quote_verified`, `statute_section_quote_refusal`, `statute_section_limitation`, `docket_limitation`, `insufficient_sources_limitation` | 6 branches, all anchored to shape |
| `lead_ref` | `drafterV2.selectLeadRef` | enabled only for `case_holding`, `definition`, `quote` | Explicitly disabled for analysis/comparison/list/timeline |
| Sufficiency gate | `sourceSufficiency.ts` | categories `case_law_synthesis`, `doctrine`, `practical_list`, `not_applicable` | Lexical topicality only; no authority tier, no URL reality |
| Planner | `queryPlanner.ts` | role ∈ {primary_statute, regulation, binding_case_law, persuasive_case_law, scholarship, factual_report, government_report}, targets ∈ {local_db, perplexity} | **Receives no shape/mode at all** — `plannerUserMessage` passes only question, legal_area, answer_type, claims, interpretation_note |

**Single most important structural fact:** the pipeline already has a mode-ish signal (`output_shape`) but it is consumed **only downstream of retrieval** (drafter + sufficiency). The planner and both retrieval lanes are mode-blind. Every mode below fails in the same place for the same reason.

---

## 1. Mode-by-mode gap map

### Mode 1 — `specific_case_holding`
*"מה נקבע בע״א 6821/93?"*

| | |
|---|---|
| **A. Current handling** | Analyzer sets `case_holding` reliably. `buildDocketAnchors` extracts the docket; `buildRequiredAnchorQueries` injects an exact-docket query. `lead_ref` enabled. Missing anchor → `docket_limitation` refusal + upload invitation. |
| **B. Expected pack** | The judgment itself (or an authoritative report of it) as lead; parallel/subsequent citing cases as support; commentary last. |
| **C. Can retrieval produce it?** | Only when the judgment is in the local corpus or a clean web copy exists. There is no "find the judgment text anywhere" escalation: docket queries go through the same generic FTS/vector lanes plus one exact-authority lookup. |
| **D. Failure points** | *Local retrieval* (corpus gaps → no judgment); *pool* (`normUrl` strips query strings, so paginated court-portal listings collapse to one `dup_url` key); *verifier* is fine. Analyzer/planner/drafter are **not** the problem. |
| **E. Smallest general change** | Give the planner the anchor: when a required anchor exists, plan a **dedicated anchor-hunting lane** (multi-phrasing of the docket, both targets, no role cap) instead of relying on one exact-authority probe. Generic, no case hardcoding. |
| **Verdict** | **Structurally the healthiest mode.** Refusal is correct and stable; the ceiling is corpus coverage. |

### Mode 2 — `statute_section_definition`
*"מה קובע סעיף 12 לחוק החוזים?"*

| | |
|---|---|
| **A.** | `statuteSectionDetection` forces `definition`; statute-section anchor required with `verified_support: direct`; secondary-only pack → `statute_section_limitation` refusal. `lead_ref` enabled with a source-type veto (scholarship cannot lead). |
| **B.** | Verbatim section text from an official publication; then leading interpretation. |
| **C.** | Partially. Section-snippet enrichment exists in `localRetrieval` (centres the snippet on the section marker) and 1200-char snippets for anchor-grade hits. Web statute text depends on Perplexity typing, which historically mislabels Nevo/Knesset PDFs as `other`. |
| **D.** | *Perplexity routing/typing* (statute PDFs typed `other` → excluded from `STATUTE_TYPES` in the gate and from lead eligibility); *local retrieval* (FTS atomizes the section reference). Drafter/verifier are correct. |
| **E.** | Make source **typing** a first-class deterministic step (URL/structure-based classification into statute/case/scholarship) instead of trusting the model's `source_type`. Generic — no allowlist needed, just structural typing rules. |
| **Verdict** | Correct-by-refusal, under-retrieving. Refuses more than it should. |

### Mode 3 — `case_law_synthesis`
*"מה הפסיקה אומרת על X?"* (tested with הלכת השיתוף; **no case hardcoded**)

| | |
|---|---|
| **A.** | Analyzer → `analysis`; claim decomposition is actually good (definition → founding caselaw → scope → limits → practice). `lead_ref` **disabled** for `analysis`. Sufficiency category = `case_law_synthesis` (≥2 topical + ≥1 topical authority). |
| **B.** | Leading authority → applying cases → limiting/distinguishing cases → statutory background → commentary last. A *layered* pack, not a flat one. |
| **C. Can retrieval produce it?** | **No.** Nothing in the pipeline models "layers of authority". The planner emits one flat query per (claim, role); there is no notion of "find the leading case first, then find what cites it". Caselaw roles are routinely routed to `local_db` only, so when the corpus lacks that court's judgments the lane is structurally dead. No `primary_statute` query is generated unless the *user* named a section. |
| **D.** | *Planner* (no synthesis-shaped strategy, no statutory-background role, caselaw locked to local_db) → *local retrieval* (corpus gap) → *source integrity* (fabricated/placeholder Perplexity URLs admitted at 0.75) → *pool* (`dup_url` artifact destroys applying/limiting lower-court cases) → *sufficiency* (passes on topicality alone, counted a non-existent article as an "authority") → *drafter* (promotes a peripheral judgment to leading authority, no `lead_ref` discipline available for this shape). **Every stage contributes.** |
| **E.** | Two general changes, in order: (1) planner receives the mode and, for synthesis, is required to emit a **role-complete query set** (statutory background + binding + persuasive + scholarship) with **both targets** for caselaw roles; (2) sufficiency counts **authority tier**, not just topicality, and rejects sources whose URLs fail a reality check. |
| **Verdict** | **The weakest mode and the one users will judge the product on.** |

### Mode 4 — `doctrine_explanation`
*"מהי חובת תום הלב במשא ומתן?"*

| | |
|---|---|
| **A.** | Also `analysis`; sufficiency category `doctrine` (≥1 topical authority). No shape-specific planning, no `lead_ref`. Indistinguishable from mode 3 upstream — the only separator is a regex on "פסיקה/הלכה/בית המשפט" inside `classifySufficiencyCategory`. |
| **B.** | One directly-explanatory anchor (statute, leading case, or serious doctrinal writing) + a small supporting set. Narrower than mode 3. |
| **C.** | Usually yes — this mode tolerates scholarship as lead, and Perplexity is good at scholarship. |
| **D.** | *Sufficiency* is the main risk in the other direction: `DOCTRINAL_TYPES` accepts `journal_article`, so a single fabricated article can satisfy the gate. Secondary: drafter over-cites because there is no lead discipline. |
| **E.** | Same URL-reality/source-integrity fix as mode 3, plus extending `lead_ref` (already built) to `analysis` with a doctrine-appropriate priority order. Low risk, high yield. |
| **Verdict** | Adequate today, but **only because its bar is low** — and the bar is satisfiable by a hallucinated citation. |

### Mode 5 — `practical_legal_steps`
*"מה עושים אם המשכיר לא מחזיר פיקדון?"*

| | |
|---|---|
| **A.** | Analyzer → `list`; sufficiency category `practical_list` (≥1 topical source, else `insufficient_sources_limitation`). Working as designed: E-class queries refuse rather than emit generic procedure. |
| **B.** | Domain-specific substantive source (the governing statute / sector regulation) **first**, then procedure/remedy sources. |
| **C.** | Partially. The planner's claim decomposition for practical questions skews procedural, so the pack fills with court-procedure boilerplate and the domain source is the thing that is missing. |
| **D.** | *Planner* (procedural bias) and *pool/verifier* (generic-procedure pages are topical-adjacent and survive). Sufficiency currently catches the worst case and refuses — correct but blunt. |
| **E.** | Mode-aware planning again: for practical modes require at least one **substantive-law** query (the governing statute/regulation for the described situation) before any procedure query. |
| **Verdict** | Safe-but-thin. Refuses correctly; rarely excellent. |

### Mode 6 — `canonical_quote`
*"צטט את סעיף 1 לחוק-יסוד: כבוד האדם וחירותו"*

| | |
|---|---|
| **A.** | Fully deterministic: canonical registry with synthetic source, branch priority above statute-section limitation, `lead_ref` enabled, verbatim output, no LLM drafting. |
| **B.** | Exactly the official text plus an official citation. |
| **C.** | Yes for registry entries; for anything outside the registry it degrades to `statute_section_quote_refusal`. |
| **D.** | None in-pipeline. The only limit is **registry coverage**, which is deliberately narrow (you froze broadening it). |
| **E.** | Nothing urgent. If broadened later, do it by **ingesting official texts into the corpus**, not by growing a hand-written registry. |
| **Verdict** | **Solved.** Highest-trust path in the product. |

### Mode 7 — `unknown_or_misframed_doctrine`
*"מה הפסיקה אומרת על הלכת יורש אחר יורש?"*

| | |
|---|---|
| **A.** | No detection at all. Handled incidentally: the sufficiency gate refuses when no topical authority survives. |
| **B.** | Do not invent the doctrine; name the closest real legal institution (here: the statutory arrangement in the inheritance law) and say the framing is non-standard. |
| **C.** | Only accidentally. Recent retrieval improvements now surface real inheritance-law sources → the gate returns `sufficient: true` → the system answers substantively **without ever telling the user the premise was misframed**. |
| **D.** | *Analyzer* (no "the premise may be wrong" signal exists in the schema); *sufficiency* (topicality is not the same as "the named doctrine exists"); *drafter* (no reframing instruction). |
| **E.** | Add one boolean-ish analyzer field, e.g. `premise_confidence` / `named_doctrine_recognized`, and one drafter rule: when retrieval finds the *area* but never the *named* doctrine, open by correcting the framing. **Fully general — no doctrine dictionary; the signal is "the named phrase never appears in any surviving authority".** That signal already exists inside `sourceSufficiency` (`topic_phrases` vs `topical_authority_refs`) and is currently discarded. |
| **Verdict** | **Currently a silent-failure mode.** It degraded as retrieval improved. |

---

## 2. Cross-mode summary table

| Mode | Analyzer | Planner | Local retr. | Perplexity | Source integrity | Pool | Verifier | Sufficiency | Drafter |
|---|---|---|---|---|---|---|---|---|---|
| 1 specific_case_holding | ok | weak | **fail** (corpus) | ok | ok | **weak** (dup_url) | ok | bypassed by anchor | ok |
| 2 statute_section_definition | ok | ok | weak | **weak** (typing) | weak | ok | ok | bypassed by anchor | ok |
| 3 case_law_synthesis | ok-ish | **fail** | **fail** | **fail** (routing+fabrication) | **fail** | **fail** | ok | **weak** | weak |
| 4 doctrine_explanation | ok | weak | ok | ok | **weak** | ok | ok | **weak** | weak |
| 5 practical_legal_steps | ok | **weak** | ok | ok | ok | ok | weak | ok | ok |
| 6 canonical_quote | ok | n/a | n/a | n/a | n/a | n/a | n/a | n/a | ok |
| 7 unknown_or_misframed | **fail** | n/a | n/a | n/a | n/a | n/a | ok | **fail** | **fail** |

Verifier is not the bottleneck for any mode. Analyzer is only a bottleneck for mode 7.

---

## 3. Recommendation — which product-level improvement is next

Ranked, with the reasoning:

**1st — better planner strategy by mode.**
This is the single highest-leverage change and it is *general by construction*. The planner is currently mode-blind: `plannerUserMessage` never sees `output_shape`, so it plans the same flat (claim × role) grid for a docket lookup, a synthesis question and a practical checklist. Modes 3 and 5 fail primarily here, and mode 1 partially. The change is: pass the mode, and define per-mode **role and target obligations** (e.g. synthesis ⇒ statutory-background query required + caselaw roles must include `perplexity`; practical ⇒ at least one substantive-law query before procedure). No doctrine names, no case names, no allowlists.

**2nd — better source integrity.**
Fabricated Perplexity URLs (`jstor.org/stable/sample`, literal-ellipsis SSRN links) currently enter footnotes *and* satisfy the sufficiency gate. This is the highest-severity trust defect in the product, and it is cheap to fix generically: structural URL/type validation at admission + deterministic source typing (which also repairs mode 2). It is 2nd only because fixing integrity on an empty pack does not produce good answers — planning has to feed it.

**3rd — better source-pack sufficiency (authority tier).**
Once 1 and 2 land, upgrade the gate from "topical" to "topical **and** of adequate authority tier for the mode", and surface the mode-7 signal (named phrase never appears in any surviving authority → reframe, don't answer).

**Not next — mode classification.** `output_shape` already covers 6 of your 7 modes accurately; only mode 7 needs a new analyzer signal, and that is a one-field addition rather than a classification overhaul.

**Not next — drafting.** The drafter-prompt track has demonstrably plateaued: with a good pack (modes 1, 2, 6) the output is already product-grade; with a bad pack no prompt rescues it. Drafting improvements should be re-opened only after a mode receives a correctly-layered pack and still writes it up badly.

**Suggested sequencing:** mode-aware planner → source integrity → tiered sufficiency → (re-evaluate drafting). Modes 3 and 7 are the acceptance tests; modes 1, 2, 6 are the regression guards.
