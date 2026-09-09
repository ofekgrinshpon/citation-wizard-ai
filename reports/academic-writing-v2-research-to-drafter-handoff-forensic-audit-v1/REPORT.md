# academic_writing_v2_research_to_drafter_handoff_forensic_audit_v1

READ-ONLY. No code, prompt, model, budget, verifier, drafter, agent, acquisition change. No deploy. No rerun.

Run `591f9895-56a3-446b-b494-a80116341eae` (persisted row `d81c3e49-91d2-4317-b738-ee67040e3df4`), chapter "מודלים לקודיפיקציה של זהות לאומית במשפט המשווה והשלכותיהם על המקרה הישראלי".

## 1. Research memo as committed (10 claims / 26 evidence pairs)

| claim | imp. | pairs | sources | kind | distinctness |
|---|---|---|---|---|---|
| C1 conceptual typology of identity/constitution (4 relations) | core | 1 | S5 Cambridge | academic | distinct |
| C2 identity as narrative/process | core | 2 | S5 ×2 | academic | two passages, one proposition |
| C3 France 1958 republican-universal model | core | 3+1rej | S1 ×4 | primary (FR) | all Article 2 region; one proposition |
| C4 Spain 1978 preamble pluralist model | core | 2 | S10 ×2 | primary (ES) | same preamble; one proposition |
| C5 Spain preamble as normative programme | supporting | 2 | S10 ×2 | primary (ES) | same preamble again |
| C6 German Grundgesetz 1949 preamble | core | 1+1rej | S11 btg PDF | primary (DE) | single |
| C7 Israeli Nation-State Law 2018 ethno-national codification | core | n+1rej | S7 Wikisource | primary (IL) | single |
| C8 three axes for classifying models | core | 1+3rej | S5, S1, S10, S7 | mixed | synthesis claim, mostly rejected |
| C9 codification is constitutive/selective | core | 3 | S1, S10, S5 | mixed | genuinely cross-source |
| C10 normative inference for Israel | core | 4 | S1, S10, S11, S7 | mixed | genuinely cross-source |

So **26 evidence pairs ≈ 9–10 propositions drawn from 5 documents**. Six pairs are repeat passages inside the same French/Spanish constitutional text supporting the same proposition. The "26" is a passage count, not a knowledge count.

## 2. Verified pack (what survived)

- 26/26 identity verified, 26/26 span verified (deterministic checks lost nothing).
- Support: 1 `supports`, 21 `supports_partially`, 4 `does_not_support` (rejected: C6/S11, C8/S1, C8/S10, C8/S7).
- Verifier output: 8 verified claims / 18 retained source refs.
- **Temporal gate then removed C6 and C7** — the German and the Israeli claims, both `core` — as `temporal_unresolved`. Final pack handed to the drafter: **8 claims, 18 spans, 5 sources, 2 unsupported_claims** (verification/temporalValidity.ts `applyTemporalGate`).

Why the gate fired: `isCurrentStateProposition` matches the cue `/(?:נחקק|תוקן|בוטל|הוחלף)\s/`, and both propositions say "שנחקק ב-1949" / "שנחקק בשנת 2018" — historical statements, read as present-law statements. `isCurrentLawCapable` then requires an **Israeli official host** (`knesset.gov.il`, `gov.il`, `nevo.co.il`, `court.gov.il`…). Wikisource and a German government PDF do not qualify, so `capable.length === 0` and both claims were auto-marked `unresolved` with no model call at all (`temporal_checks_attempted: 0`). One temporal repair round ran and changed nothing.

## 3. What the drafter actually received

`drafting/draft.ts buildDrafterInput` passes, per claim: claim_id, importance, support_status, full proposition, and for every source `source_id | display_title | locator | תמיכה: <verdict>` plus the **full verified_span verbatim**. Nothing is shortened or summarized.

- 8 verified claims, 5 sources, 18 spans, ≈2,400 characters of quoted evidence.
- Support qualification: yes, per source, in Hebrew ("תמיכה: supports_partially").
- Source metadata: title, locator, no URL (renderer adds it).
- Academic block (`buildProjectContextBlock`): research question, thesis, full outline, chapter index+title, user instructions, prior-chapter summaries, established conclusions, known sources — all present.
- Also passed: 2 temporal advisories ("יש לציין במפורש שהמצב העדכני לא אומת…"), a gap line ("2 נושאים, מתוכם 2 מרכזיים, לא עמדו באימות"), and source-level gap notices.
- Not passed: paper length/page count, "chapter 4 of 6" as a weighting signal (only positional index), rejected propositions (deliberate), evidence bodies beyond the spans.

## 4. Truncation / compression points and whether they fired

| limit | value | fired here |
|---|---|---|
| drafter max claims / sources / spans | **none exist** | – |
| per-span truncation in drafter input | **none** | – |
| verifier support context | 1,200 chars per pair (verify.ts) | yes, verifier-internal only |
| temporal capable sources | `.slice(0, 4)` + 2,500 chars each | not reached (0 capable) |
| project context bounds | outline 30, chapters 8, summary 600, sources 25, instructions 1,200, excerpt 1,500 | none hit |
| gap notices | `slice(0,4)` authorities, `slice(0,3)` sources ×70 chars | not material |
| agent context compaction | 4 recent tool payloads, 240-char digests | 1 compaction, 2,447 chars |

No drafter-side truncation fired. The pack was small because it arrived small.

## 5. Drafter instructions

System prompt is a senior-lawyer legal-answer persona. The only length language is: "התאם את מבנה התשובה ואת מידת פיתוחה לתוצר… פרק… מחייב כתיבה מפותחת ורציפה המנצלת את מלוא החומר המאומת… אין יעד אורך קבוע." The academic guide (`body-v1`) adds argument-led paragraphs, competing views, synthesis, no process reporting. There is **no** "concise/brief/short" instruction, no word/paragraph target, no citation density. The drafter is not instructed toward compression — but it also receives a mandatory clause requiring a limitations paragraph, plus a recommended structure ending in "מגבלות התשובה".

## 6. Scale awareness

The drafter knew: research question, thesis, full outline order, that this is chapter index 1 (fixture ran it as chapter 2, not 4 of 6), and its position-derived role. It did **not** know paper page count, chapter weighting, or expected chapter size. That information never existed upstream — it is not part of `AcademicProjectContext`, so nothing was lost in transit.

## 7. Claim → text utilization

All 8 verified claims appear in the chapter: C1, C2 (framing), C3, C4, C5 (comparative body), C8, C9 (synthesis), C10 (Israeli inference). USED_FULLY: C1, C3, C4, C9, C10. USED_PARTIALLY: C2, C5, C8 (compressed into single sentences). NOT_USED: none.
**100% of verified claims used; 5/5 verified sources cited.** Essentially no verified material was left on the floor.

## 8. Source → text utilization

| src | doc | pairs | claims | cited | left unused |
|---|---|---|---|---|---|
| S5 | Beyond constitutional identity (Cambridge) | 5 | C1, C2, C8, C9 | fn 1 | body far richer than 3 short spans used |
| S1 | French Constitution 1958 | 4 | C3, C9, C10 | fn 2 | rest of the constitution unmined |
| S10 | Spanish Constitution (lamoncloa, title "index") | 4 | C4, C5, C9, C10 | fn 3 | articles beyond preamble unmined |
| S7 | Nation-State Basic Law (Wikisource) | 2 | C10 | fn 4 | **C7 gated out — its substance survives only inside C10** |
| S11 | German Grundgesetz PDF (btg) | 2 | C10 | fn 5 | **C6 gated + one pair `does_not_support`** |
| S8 | HCJ 5555/18 (toledano.co.il) | readable, **never submitted as evidence** | 0 | no | fully unused |
| S9 | South African Constitution (gov.za) | readable, **never submitted** | 0 | no | fully unused |
| S2, S3, S4, S6 | SA PDF, BOE Spanish, gesetze-im-internet GG, Australian OAPEN | discovered, never fetched | – | no | – |

## 9. Academic-literature funnel

discovered 2 (S5, S6) → fetched 1 → readable 1 → submitted 1 → admitted 1 → used 1.
Four academic searches produced exactly **one** usable paper. Classification: **A — research failed to acquire more scholarship.** Not B/C/D: the single paper passed everything and was used.

## 10. The 21 `supports_partially` pairs

They are fully available to the drafter, with the verdict label attached, and claims built only from them are marked `partially_supported`. There is no instruction telling the drafter to hedge or use them sparingly — but the label plus the "לא להוסיף מעבר לחומר" rule discourages extrapolation. Most partials are the same constitutional passage supporting a broader interpretive proposition. So yes: **26 pairs materially overstates richness** — it is ~9 propositions over 5 documents, most only partially supported.

## 11. Origin of the closing process paragraph

Deterministic, not model whim. `applyTemporalGate` emitted two advisories ("לא ניתן היה לאמת את מצב הדין הנוכחי בעניין … יש לציין במפורש שהמצב העדכני לא אומת"), injected under "הנחיות מחייבות לניסוח"; the base drafter system prompt independently requires a dedicated paragraph for unverified parts and recommends ending with "מגבלות התשובה". The chapter's final paragraph is the literal execution of both. Root cause is the temporal misclassification in §2, not the writing guide.

## 12. Footnote titles

- "index" — S10's stored title was already `index`, taken from `.../Paginas/index.aspx`. `formatCitation` drops filename-like and bare-institution titles, but "index" passes both tests. Never acquired better; not lost downstream.
- "מקור ללא כותרת" — S11 (btg PDF) had no extractable title; `formatCitation`'s fallback fired. The true title (Basic Law for the Federal Republic of Germany) existed in the document body/search result but was never captured as `title`.

## 13. Counterfactual

**PARTIALLY.** A stronger drafter could have gotten somewhat more from the same pack: the S5 typology (four identity relations) is used once and could carry a full analytic framework applied to each system; the Spanish preamble's normative programme (C5) is reduced to one sentence; the Israeli implications could have been a separate developed section rather than one paragraph. But the ceiling is real: three constitutional texts, one scholarly article, no case law, no competing scholarly positions. There is no material in the pack for doctrinal tension or a literature debate, and the two national claims that mattered most were gated out.

## 14. Earliest bottleneck

**G (mixed), earliest = A — RESEARCH ACQUISITION**, with a second, independently material loss at the temporal gate (D-side, post-verification pack reduction).

- A: 24 steps but **12 consecutive no-op fetch turns** (turns 6–22, `tool_ms 0–1`, `added_evidence:false`), consuming ~230k of the 290k prompt tokens; 4 academic searches yielded 1 paper; 2 readable bodies (HCJ 5555/18, SA Constitution) never made it into the memo.
- Then: the temporal gate deleted the German and Israeli core claims for a reason that cannot be satisfied by any comparative-law source.
- Not C (26/26 passed identity and span), not D-as-truncation (no drafter limits fired), not E/F (no compression instruction; 100% of the pack was used).

## 15. Single narrowest component worth changing next

`verification/temporalValidity.ts` — the current-state classification. The cue `/(?:נחקק|תוקן|בוטל|הוחלף)\s/` fires on plainly historical sentences ("שנחקק ב-1949"), and `isCurrentLawCapable`'s Israel-only host list makes any foreign or comparative claim structurally impossible to clear, so it is auto-gated with zero checks. That one component removed two core claims and produced the process paragraph in §11.

## 16. Do NOT change

Verifier checks 1–3 (identity/body/span — 26/26 clean), the support verifier and its three verdicts, drafter prompt or academic `body-v1` guide (no compression instruction found), drafter input shape (full spans, no truncation), project-context bounds (none hit), renderer/citation logic, models, budgets, V1, acquisition ledger. No length targets, quotas or source counts.
