# Beta legacy feature dependency audit — סיכום פסיקה & חיפוש מקורות

Track: `beta_legacy_feature_dependency_audit_case_summary_and_source_search_v1`.
READ-ONLY. No code, routing, deployment or data was changed.

---

## PART A — סיכום פסיקה (case_summary)

### 1. Entry point
- Component: `src/components/LegalQAChat.tsx:169` — `TASK_MODES` card
  `{ id: "case_summary", label: "סיכום פסיקה", description: "תמצית: עובדות, שאלה משפטית, הכרעה ורציו" }`.
- Route/mode: `/app` → `AppMode = "legalqa"` (`src/pages/Index.tsx:911` renders `LegalQAChat`).
  It is a task-mode card, not a route.
- Inputs: one free-text field (judgment name or pasted text) + file upload
  (`FILE_RELEVANT_MODES` includes `case_summary`, `LegalQAChat.tsx:164`).
- Credits: 5, +2 when a grounding document is attached
  (`supabase/functions/legal-qa/index.ts:346-360`).
- Accessible in beta: **YES** — fully live, no flag.
- History: appears in `QAHistorySidebar.tsx:42` as "סיכום", envelope marker
  `__case_summary` (`LegalQAChat.tsx:2308`).
- Renderer: `src/components/CaseSummaryReport.tsx` (227 lines, presentation only).

### 2. Full pipeline
```
LegalQAChat.handleSubmit (LegalQAChat.tsx:2236)
  → POST /functions/v1/legal-qa  { question, taskMode:"case_summary", documentText(s), hasDocument }
    → legal-qa/index.ts credit gate (:346-367)  consume_credits 5|7
    → legal-qa/index.ts LIVE PATH 2 (:857-965)
        → POST /functions/v1/verify-case-fulltext  { question, userText }   (20s timeout)
              user text → local legal_documents lookup → external fetch (PDF/DOCX/HTML)
        → refuse + refund if source==="none"   (refundAndPayload "case_summary:no-fulltext")
        → Hebrew-ratio gate ≥5% else refuse + refund
        → getCaseSummaryInstructions() (:115-146) — fixed 7-section Hebrew report prompt
        → Lovable AI Gateway, model google/gemini-2.5-flash, max_tokens 3500, 90s
    → response { answer, case_summary:true, verified_source, case_metadata, source_urls }
  → CaseSummaryReport renders; qa_logs row + history envelope
```
Pipeline version: **legal-qa (legacy V1-era function) + verify-case-fulltext**.
It does **not** touch `legal-research-v1` or `legal-research-v2`.

### 3. Unique work
| Component | Classification |
|---|---|
| `verify-case-fulltext/index.ts` (455 ln): local corpus lookup by docket variants, external judgment fetch, DOCX unzip (`fflate`), PDF magic-byte detect, HTML interstitial fallback, metadata (case_number/parties/court/year) | **A — reusable shared infrastructure** (self-contained; no V1 imports) |
| Strict full-text gate + Hebrew-ratio gate + refund-on-refusal | **B — case-summary-only orchestration** |
| `getCaseSummaryInstructions()` fixed report schema (כותרת/עובדות/טענות/שאלה/דעות השופטים/הכרעה/ההלכה) | **B — case-summary-only** |
| `CaseSummaryReport.tsx` + `__case_summary` history envelope | **C — UI-only** |
| Legacy `pleading_analysis` / offline fallthrough branches in the same file | **D — dead code** |

No deterministic judgment parser beyond metadata regexes; no docket/facts/holding parser —
structure comes from the LLM prompt, not code.

### 4. Dependency check
- Legal Research V2: does **not** import anything from case-summary code (`rg` in
  `supabase/functions/legal-research-v2` → no `case_summary` / `verify-case-fulltext` hits).
- Academic Writing: shares only the `legal-qa` function host (short wizard steps), not
  the case-summary path.
- Uniform Citation / Footnotes / Bibliography: no reference.
- Uploads: `legal-qa` receives already-extracted `documentTexts` from the client; V2
  attachment handling is a **vendored copy** at
  `supabase/functions/legal-research-v2/vendor/attachments.ts` — independent of V1.
- `verify-case-fulltext` is invoked **only** from `legal-qa` case_summary
  (single call site, `legal-qa/index.ts:869`).

### 5. Product overlap
V2 Legal Research can answer "סכם את פסק הדין", "מה העובדות", "מה נקבע", "מה ההלכה",
"האם הייתה דעת מיעוט" — its Research Agent has `search`/`fetch`/`lookup_authority`
plus the corpus, and it produces cited, span-verified prose.
Materially better in the standalone feature:
- **Structure**: guaranteed 7-section report; V2 output is free-form prose.
- **Cost/latency**: ~5 credits and a single 90s Gemini Flash call vs V2's ~5–8 credits
  and 200–350s agent loop.
- **Grounding discipline**: refuses unless the true full text is in hand; V2 will answer
  from partial evidence with disclosure.
- **Upload path**: user can paste/upload a judgment PDF — V2 has no upload route
  (attachments still fall back to V1, `src/config/researchPipeline.ts:19`).

### 6. Deletion readiness — case summary
**KEEP (with HIDE_ONLY as the fallback).**
It is cheap, fast, deterministic in shape, does not keep V1 alive, and covers the only
"upload a judgment" path in the product. If beta must be narrowed to four capabilities,
`HIDE_ONLY` — remove the card, keep `legal-qa` case path + `verify-case-fulltext` intact.
`DELETE_FULLY` is wrong: `verify-case-fulltext` is genuinely useful judgment-text
acquisition infrastructure V2 currently lacks.

---

## PART B — חיפוש מקורות (legal_source_search)

### 7. Entry point
- Card: `LegalQAChat.tsx:168` — `{ id: "legal_source_search", label: "חיפוש מקורות" }`.
- Owned panel: `src/components/LegalSourceSearchPanel.tsx` (829 ln), rendered at
  `LegalQAChat.tsx:3199`; the main submit handler explicitly bails for this mode
  (`LegalQAChat.tsx:2176`).
- Input: one question/topic text field, per-project turn history in sessionStorage
  (`legal-source-search:turns:<projectId>`, max 5 turns / ~1 MB).
- Output: ranked source list grouped into 7 buckets (חקיקה ראשית ותקנות, פסיקה מחייבת,
  פסיקה משכנעת, ספרות אקדמית, הליכי חקיקה, דוחות ממשלתיים, אחר), plus a secondary
  "additional sources" tier, with URL-liveness badges and a summary counter block.
- Credits: **5** (`legal-research-v1/index.ts:439` `RESEARCH_COST = 5`); charge is kept
  on success (`index.ts:2609` "sources_only mode delivers a curated source list → keep the charge").
- Accessible in beta: **YES**, live, no flag.

### 8. Full pipeline
```
LegalSourceSearchPanel.submit (:396-405)
  → supabase.functions.invoke("legal-research-v1", { question, project_id, mode:"sources_only" })
    → legal-research-v1/index.ts  pipeline_mode = "sources_only" (:371-380)
       consume_credits 5 (:469)
       full V1 stage chain runs: analyzer → router profiles → planner → nomination →
       candidate pool → corpus RPCs (search_legal_chunks_*, match_legal_chunks) →
       vector retrieval → Perplexity/web discovery → source scoring → verifier
       (fast-lane paths are disabled for sources_only, :2354/:2424)
       → exit at :2543 buildSourcesOnlyPayload()  — drafter SKIPPED
       → persisted as legal_research_jobs row; footnotes:[{ __sources_only:true, payload }],
         qa_logs task_mode "legal_source_search" (:1164)
  → panel polls the job (2s), 5 fake progress stages, renders groups
```
Version: **legal-research-v1, unmodified, minus the drafter.**

### 9. Actual behavior
- Returns a **list only** — no answer text, no explanations beyond a per-source `reason`.
- Ranks by V1 relevance scoring; groups by role; two tiers (recommended / additional).
- Runs **identity/role verification** through the V1 verifier (`support: direct|partial`,
  `role_match`) and URL-liveness checks for perplexity-origin URLs.
- Searches: local legal corpus (statutes + case law chunks), vector retrieval,
  Perplexity web discovery, academic material via the V1 academic scopes.
- Does **not** produce verified verbatim spans, does not run V2's four-check verifier,
  does not draft or cite.

### 10. Relation to V2
Everything Source Search does is available inside V2 through `search()` (official / web /
academic scopes), `fetch()`, `lookup_authority()` and the corpus RPCs — with *stricter*
verification (identity + span + support + temporal) on top.
Classification: **D — mostly an old UI over V1 search**, with a genuine product
difference in *output shape* (a list, not an answer). It is not more capable than V2;
it is a cheaper, list-shaped exit from a weaker pipeline.

### 11. Legacy dependencies it keeps alive
`lib/sourcesOnly.ts` (672 ln) is the **only** file reachable exclusively from this mode
(`rg sourcesOnly` → `index.ts` + itself). Everything else it uses — analyzer, router
profiles, planner, nomination, candidate pool, vector/corpus retrieval, Perplexity
provider, scoring, verifier, all 112 files in `stages/` and 16 in `lib/` — is **shared
with the V1 answer path, which is still live** because attachments route to V1
(`src/config/researchPipeline.ts:19`).
**Conclusion: removing Source Search would let us delete exactly one file today.**
It does not unlock V1 deletion. V1 deletion is gated by the attachment route, not by
this feature.

### 12. User value
The use case is real ("just give me sources to read myself"). But it is an *output-shape*
preference, not a distinct pipeline need. Natural home: an action/mode inside Legal
Research V2 ("החזר רשימת מקורות בלבד"), reusing the V2 evidence pack and its grouping —
not a fifth card and not a second pipeline charging the same 5 credits for a weaker result.

### 13. Deletion readiness — source search
**MOVE_INTO_LEGAL_RESEARCH** (immediate step: `HIDE_ONLY`).
Hide the card for beta; keep `lib/sourcesOnly.ts` and the V1 path intact — its grouping /
tiering / URL-validation logic is the best available spec for a future V2 "sources only"
output mode.

---

## PART C — shared infrastructure map

### 14. Dependency matrix
| Component | Case Summary | Source Search | Legal Research V2 | Uniform Citation | Footnotes | Bibliography | Academic Writing | Uploads/shared |
|---|---|---|---|---|---|---|---|---|
| `legal-qa` edge function | USED | NOT USED | NOT USED | NOT USED | NOT USED | NOT USED | USED (short steps) | SHARED |
| `verify-case-fulltext` | USED (only caller) | NOT USED | NOT USED | NOT USED | NOT USED | NOT USED | NOT USED | LEGACY ONLY (today) |
| `getCaseSummaryInstructions` prompt | USED | NOT USED | NOT USED | NOT USED | NOT USED | NOT USED | NOT USED | feature-only |
| `CaseSummaryReport.tsx` | USED | NOT USED | NOT USED | NOT USED | NOT USED | NOT USED | NOT USED | UI-only |
| `legal-research-v1` (whole function) | NOT USED | USED | NOT USED | NOT USED | NOT USED | NOT USED | NOT USED | SHARED (attachment research) |
| `v1/lib/sourcesOnly.ts` | NOT USED | USED | NOT USED | NOT USED | NOT USED | NOT USED | NOT USED | LEGACY ONLY |
| V1 planner / nomination / candidate pool / scoring | NOT USED | USED | NOT USED | NOT USED | NOT USED | NOT USED | NOT USED | SHARED (V1 answer path) |
| V1 `lib/attachments.ts` (PDF/DOCX extract) | NOT USED | USED (indirect) | NOT USED (vendored copy) | NOT USED | NOT USED | NOT USED | NOT USED | SHARED |
| `v2/vendor/attachments.ts` + vendor/* | NOT USED | NOT USED | USED | NOT USED | NOT USED | NOT USED | USED (via V2) | SHARED |
| Corpus RPCs (`search_legal_chunks_*`, `match_legal_chunks`) | USED (via verify local lookup) | USED | USED | NOT USED | NOT USED | NOT USED | USED (via V2) | SHARED |
| Court egress relay / officialFetch | NOT USED | USED | USED | NOT USED | NOT USED | NOT USED | USED | SHARED |
| Perplexity / web discovery | NOT USED | USED | USED | NOT USED | NOT USED | NOT USED | USED | SHARED |
| Authority resolver / registry | NOT USED | USED | USED | NOT USED | NOT USED | NOT USED | USED | SHARED |
| `citation-chat` + `src/lib/runCitation.ts` | NOT USED | NOT USED | USED (Uniform Citation panel) | USED | USED | USED | NOT USED | SHARED |
| Credits / jobs (`legal_research_jobs`, `consume_credits`, refunds) | USED | USED | USED | USED | NOT USED | NOT USED | USED | SHARED |
| `qa_logs` / history sidebar | USED | USED | USED | NOT USED | NOT USED | NOT USED | USED | SHARED |

### 15. Safe delete boundaries
**סיכום פסיקה**
- User-facing surface (removable): `TASK_MODES` entry `LegalQAChat.tsx:169`,
  `CaseSummaryReport.tsx`, history label `QAHistorySidebar.tsx:42`, Landing chip.
- Feature orchestration (removable with the surface): `legal-qa` LIVE PATH 2 (:857-965),
  `getCaseSummaryInstructions()` (:115-146), the case_summary credit branch (:358).
- Shared infrastructure (must stay): `verify-case-fulltext` (only judgment full-text
  acquisition service in the product), credits/refund plumbing, `qa_logs`.
- Dead code: `pleading_analysis` 503 branch, unreachable fallthrough, dead SSE path
  (`useSseStream = false`, `LegalQAChat.tsx:2217`).

**חיפוש מקורות**
- User-facing surface (removable): `TASK_MODES` entry `LegalQAChat.tsx:168`,
  `LegalSourceSearchPanel.tsx`, render at `:3199`, history label
  `QAHistorySidebar.tsx:41`, Profile label `Profile.tsx:65`.
- Feature orchestration (removable): `lib/sourcesOnly.ts`, the `mode:"sources_only"`
  branch in `legal-research-v1/index.ts` (:371-380, :2543-2612), and the
  `is_sources_only` guards at :886/:1164/:2354/:2424.
- Shared infrastructure (must stay): the entire rest of `legal-research-v1` — still the
  attachment-research pipeline.
- Dead code: none uniquely attributable.

### 16. Beta product recommendation
Intended core: מחקר משפטי · אזכור אחיד · הערות שוליים · ביבליוגרפיה. Academic Writing = בקרוב.
- **סיכום פסיקה — keep visible.** It is the only upload-a-judgment surface, is fast and
  cheap, has a distinct deterministic output, and costs no legacy debt. It is the one
  feature here that genuinely earns a fifth card.
- **חיפוש מקורות — hide.** It charges the same 5 credits as full research for a weaker,
  V1-only result, duplicates V2 retrieval, and confuses positioning ("what's the
  difference between מחקר משפטי and חיפוש מקורות?"). Removing it simplifies onboarding.
- Net effect: 5 visible capabilities (research, case summary, uniform citation,
  footnotes, bibliography) + Academic Writing marked בקרוב.

### 17. Later deletion candidates (do not delete now)
- `src/components/LegalSourceSearchPanel.tsx`
- `supabase/functions/legal-research-v1/lib/sourcesOnly.ts`
- `mode:"sources_only"` branch and `is_sources_only` guards in `legal-research-v1/index.ts`
- `legal_source_search` entries in `LegalQAChat.tsx` (:168, :2176, :3199), `QAHistorySidebar.tsx:41`, `Profile.tsx:65`, `Index.tsx:137-138/:1237-1238`
- Dead-only: `pleading_analysis` branch and unreachable fallthrough in `legal-qa/index.ts`
- (If case summary is ever hidden) `CaseSummaryReport.tsx` + legal-qa LIVE PATH 2

### 18. MUST NOT delete
- `supabase/functions/verify-case-fulltext/**` — sole judgment full-text acquisition service
- `supabase/functions/legal-research-v1/**` except `lib/sourcesOnly.ts` — still serves
  attachment-bearing research (`src/config/researchPipeline.ts:19`)
- `supabase/functions/legal-research-v2/**` including `vendor/**`
- `supabase/functions/citation-chat/**`, `src/lib/runCitation.ts` — Uniform Citation /
  Footnotes / Bibliography
- Corpus RPCs, authority registry, court egress relay, credits/jobs/refund plumbing,
  `qa_logs` history plumbing
- `src/config/researchPipeline.ts` — the V1/V2 rollback switch

### 19. No implementation performed.
No files were deleted, no routing changed, no deployment, no migration, no live query.
