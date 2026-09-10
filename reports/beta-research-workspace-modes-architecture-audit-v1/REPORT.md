# beta_research_workspace_modes_architecture_audit_v1

READ-ONLY. No code changed, nothing deployed, nothing deleted, no migration.

## 1. Executive recommendation

- Collapse the three top-level cards into ONE "מחקר משפטי" workspace with an intent selector: מענה לשאלה משפטית / חיפוש מקורות / סיכום פסק דין.
- Unified UX, three separate backends. Do NOT force one pipeline.
  - Answer → V2 (as today).
  - Source search → V2 agent + verifier + **source renderer instead of drafter**. Retire the V1 `sources_only` path.
  - Case summary → keep the targeted pipeline (`verify-case-fulltext` → structured summary model). Do NOT run the Research Agent.
- The only V1 code exclusively serving source search is `lib/sourcesOnly.ts`; its product concepts (display grouping, per-source reason, tiering, URL liveness) are worth porting, its plumbing is not.

## 2. Current V1 Source Search architecture

UI: `LegalQAChat.tsx` mode `legal_source_search` (label "חיפוש מקורות", placeholder "הזן שאלה משפטית או נושא למחקר…") → renders `LegalSourceSearchPanel.tsx`.
Panel: single free-text input, no options/filters; async invoke of `legal-research-v1` with `mode:"sources_only"`, `task_mode:"legal_source_search"`; polls `legal_research_jobs` every 2s; 5 stage labels (analyzer / planner / retrieval / verifier / ranking); soft "still working" notices at 120s and 240s; up to 5 turns persisted in sessionStorage per project; resume key `legal-source-search:active_job`.
Result: two lists — "מומלצים" and "מקורות נוספים לבדיקה" — grouped into 7 display groups (חקיקה ראשית ותקנות, פסיקה מחייבת, פסיקה משכנעת, ספרות אקדמית, הליכי חקיקה, דוחות ממשלתיים, אחר). Each card exposes title, group, role label, origin (מאגר מקומי / רשת), support (direct/partial), reason text, snippet, display_citation when present, external link, and a URL-liveness marker. No score is shown; ordering is group order → support → role_match → origin.
Credits: 5, same as full research (`CREDIT_COSTS.research`). Charge is kept because `pipelineDelivered = true` on the sources-only exit; failures refund.
Backend path executed (v1 `index.ts`): intake → router profile → analyzer (claims) → planner (queries) → retrieval (corpus lexical + vector + exact-authority lookup + Perplexity/web discovery) → candidate pool + admission/classification → body acquisition/extraction → identity checks → LLM verifier (per-claim verdicts, usable/dropped) → **short-circuit at `is_sources_only`** → `buildSourcesOnlyPayload` → telemetry row with `footnotes:[{__sources_only:true,payload}]`, `task_mode:"legal_source_search"` → response. Only the drafter, footnote/citation rendering and post-draft stages are skipped: the entire expensive front half (planner + retrieval + acquisition + LLM verifier) runs in full.

Stage-by-stage vs V2 equivalence:
| V1 stage | Contribution | Essential for a source list | V2 equivalent |
|---|---|---|---|
| analyzer (claims) | claim decomposition for verifier | no (only because verifier needs claims) | agent reasoning |
| planner (queries) | multi-query plan | partly | agent-issued `search()` calls |
| corpus lexical | local statute/caselaw hits | yes | `search({scope:"corpus"})` |
| vector search | semantic corpus recall | optional | not present in V2 (lexical only) |
| exact-authority lookup | docket/statute resolution | yes | `lookup_authority()` |
| Perplexity/web | discovery | yes | `search({scope:web/official/academic})` |
| candidate pool/admission | class filters, caps, variety | no (V1-specific complexity) | none (deliberately) |
| acquisition + extraction | readable body | yes | `fetch()` + evidence store |
| identity verification | right document | yes | verifier check 1 |
| LLM verifier verdicts | relevance + reason text | yes-ish | support check + agent judgment |
| ranking/dedup | grouping and ordering | yes | none — must be added as renderer logic |

## 3. `lib/sourcesOnly.ts` in detail

Input `BuildSourcesOnlyInput`: `{question, run_id, candidates, usable, verdicts, candidates_verified/usable/dropped, perplexityDropped?, verifierDropped?}`.
Output `SourcesOnlyPayload`: `{mode, question, run_id, sources[], groups{7 keys}, additional_sources[], additional_groups, summary}`; each `SourceResult` = `{rank,title,url,source_type,role,origin(local_db|perplexity),support(direct|partial),role_match,reason,supported_claim_ids,snippet,display_citation,tier,url_validation_state,url_status,url_unreachable}`.

Selection/ordering:
- Main list = exactly `verifier.usable` (verified + relevant). Nothing unverified is promoted.
- `classifyDisplayGroup()` re-classifies each source by URL host/path + title regex + source_type, independent of the planner's requested role (a חוק stays under חקיקה, an IDI paper never lands under חקיקה). Hosts: supreme/court.gov.il, knesset, mevaker, gov.il, IDI, HeinOnline/JSTOR/SSRN, `.ac.il`.
- Sort inside group: `support` (direct<partial) → `role_match` → `origin` (local_db<perplexity). `rank` is then assigned sequentially across groups in fixed group order — i.e. rank is a presentation index, not a score.
- Dedup: `dedupKey` = normalized host+path, else normalized title.
- Reason: taken from the best LLM verdict (`pickBestVerdict`: direct>partial>tangential>unrelated, then role_match, then longest reason). Snippet comes from the candidate.
- Additional tier (cap 15): admissible perplexity drops (`discovery_only`, `class_unknown/academic/publisher_not_admitted_*`) plus verifier `tangential` drops; Wikipedia excluded; raw drop-reason codes never surfaced — mapped to sanitized Hebrew labels.
- URL liveness: perplexity-origin URLs only, HEAD then ranged GET, 8-way concurrency, 4s per-request / 6s global budget; 401/403 = "paywalled" but OK; 404/410 = unreachable.

Verdict: the *product logic* (display grouping, two-tier recommended/additional, sanitized reasons, dedup, URL liveness, renderer-ready fields) is worth porting to V2. The *inputs* (V1 candidate/verdict/dropped structures) are not.

## 4. What is good and must be preserved conceptually

Fast "just give me sources" intent; grouped source list by legal source type; direct working links (with liveness check); short human reason per source; snippet; local-vs-web origin badge; two-tier recommended/additional so the user still sees leads that failed strict admission; sanitized user-facing language; per-project turn history; async job + progress + resume.

## 5. What is bad / legacy

Whole V1 front half runs (analyzer, planner, pool admission, LLM verifier) for a list; latency of a full research run; identical 5-credit price as a complete answer; V1 candidate-pool/variety-cap complexity that is being retired; vector-search dependency; claim-based verification is an awkward proxy for "is this source relevant to my topic"; `rank` is not a real relevance ordering; two verification philosophies to maintain.

## 6. Can source search be built cleanly on V2?

Yes, and it is mostly a **different terminal renderer**, not a new pipeline.
Already exists: `search()` (web/official/academic/corpus), `fetch()` + append-only SHA-256 evidence store with `identity_fields`, `is_actual_document`, `text_length`, `origin`, `title`, `url`; `lookup_authority()`; acquisition ledger with verified authority binding; verifier checks 1–4 (identity, body-read, span, support) + temporal; per-run telemetry/funnel; jobs, progress, credits, refunds, resumable chunks.
Missing: (a) a `deliverable`/output-mode switch that stops before `drafting/draft.ts` and calls a source renderer; (b) a source-list prompt contract (the agent must emit per-source relevance + ordering, not claims/prose); (c) the display-group classifier + URL liveness (portable from `sourcesOnly.ts`); (d) a lighter budget profile.
No new large pipeline is needed. No new verifier.

## 7. Smallest clean V2 source-search deliverable

Intake `{output_mode:"sources"}` → agent runs with a source-scouting contract → evidence store → verifier runs identity + body-read (+ span only where the agent supplied an excerpt) → **SourceRenderer** replaces the drafter.

Object reaching the renderer, per source:
`{source_id, canonical_title, source_type (statute/regulation/judgment/scholarship/legislative/report/other), display_group, jurisdiction, authority_id (docket or statute+section), url, origin, relevance_note (one Hebrew sentence, agent-written), excerpt (verbatim, span-verified when present), related_topic/claim, state: verified_readable | identified_unread | lead_only, url_state, order_rank (agent-assigned)}`.

## 8. Ranking

Signals already present in V2: search-provider order (Perplexity), corpus lexical score (post rank-before-truncation fix), evidence support verdicts, authority type/host officialness, readability, agent judgment.
Recommendation: let the **Research Agent emit the final ordering** over the verified set, with only two deterministic guards applied afterwards: (1) `verified_readable` outranks `identified_unread` outranks `lead_only`; (2) stable grouping by source type for display. No V1-style numeric scoring framework.

## 9. Current Case Summary architecture

Path A (name/docket): `LegalQAChat` card "סיכום פסיקה" → POST `legal-qa` `taskMode:"case_summary"` → credit gate 5 (+2 with grounding text) → `verify-case-fulltext` (20s timeout) → refuse+refund if `source==="none"` → defence-in-depth Hebrew-ratio gate (<5% ⇒ refuse+refund) → header hints from metadata → Lovable AI `google/gemini-2.5-flash`, `max_tokens:3500`, full text truncated to 50,000 chars → response `{answer, footnotes:[], source_urls, case_summary:true, verified_source, case_metadata}` → `CaseSummaryReport.tsx`.
Path B (upload): PDF/DOCX extracted **client-side** in `LegalQAChat.tsx` (pdf.js / mammoth), sent as `documentTexts`/`documentText`; `verify-case-fulltext` returns `source:"user"` immediately if ≥1500 chars, skipping all retrieval. Same prompt and renderer afterwards. No V1, no V2 involvement in either path.

## 10. `verify-case-fulltext` in detail

Inputs `{question, userText}`; auth required. Order of resolution:
1. **User text** ≥1500 chars → `source:"user"`, metadata only carries a docket parsed from the question.
2. **Local corpus** — `extractCaseNumber` handles `בג"ץ/ע"א/ע"פ/רע"א/דנ"א/בש"פ/עע"מ/תפ"ח…` prefixed dockets, bare `1234/05`, and hyphenated `18225-06-25`; `caseNumberVariants` expands slash/hyphen forms; queries `legal_documents` filtered to `caselaw|case_law|case_law_database`; fallback ilike on title/citation picking the longest body; requires ≥3000 chars → `source:"local"` with full metadata (title, citation, court, decision_date, case_number, parties, year, source_url).
3. **External** — Perplexity `sonar` with `search_domain_filter` = nevo, supreme(.decisions).court.gov.il, takdin/lite.takdin, psakdin, din.org.il, prompted to return only JSON `{case_number,parties,court,year,source_url}`; then fetch the URL with browser-like headers, magic-byte sniffing (PK ⇒ DOCX via fflate `word/document.xml`; `%PDF-` ⇒ ConvertAPI pdf→txt; else HTML strip); ≥3000 chars AND Hebrew ratio ≥5% → `source:"external"`, text capped at 60,000 chars.
4. Otherwise `source:"none"` + a fixed Hebrew refusal telling the user to upload or paste.

Genuinely valuable shared infrastructure: docket normalization/variants, the caselaw-domain discovery list, magic-byte-based DOCX/PDF/HTML extraction with ConvertAPI fallback, and the Hebrew-ratio full-text gate. All four are reusable by V2 acquisition and by attachments; V2 currently has weaker Israeli-judgment discovery than this service.

## 11. Current 7-section prompt (verbatim structure)

Mode line: "מצב עבודה: סיכום פסיקה — דו״ח מובנה ומחייב."
Iron rule: the summary rests **only** on the supplied judgment text; adding, completing, inferring or imagining anything is forbidden; a missing detail must be written as "(לא צוין בפסק הדין)".
Ban: no footnotes, no `[N]`, no superscripts — this is a standalone report, not an opinion.
Sections, in this exact order with bold headings:
1. **כותרת** — one line: docket | party names | (year).
2. **עובדות** — concise relevant facts only, no legal citations.
3. **טענות הצדדים** — a dedicated paragraph per side (plaintiff/petitioner/appellant vs defendant/respondent).
4. **השאלה המשפטית** — the central legal question in 1–2 sentences.
5. **דעות השופטים** — a separate paragraph per judge (majority, minority, reasoned concurrence): name, position, normative framework relied on, tests applied.
6. **הכרעה** — one line: accepted / rejected / partly accepted, including the relief actually granted.
7. **ההלכה** — the binding rule from the majority, phrased as a standalone normative statement.
Closing instruction: "צור עכשיו את הדו״ח לפי המבנה המחייב. ללא הערות שוליים. ללא [N]. ללא ציטוט מקורות חיצוניים."
Note: procedural history and precedential significance are NOT explicitly requested (significance is implicit in ההלכה). Otherwise the prompt is strong — grounded-only, uncertainty-explicit, judge-by-judge — and is worth reusing conceptually, with an optional added "הליך דיוני" section.

## 12. `CaseSummaryReport.tsx`

Input: `{answer: string, metadata?: CaseMetadata, verifiedSource?: "user"|"local"|"external"}` — i.e. plain Hebrew markdown-ish text, not structured JSON. `parseSections()` splits on heading-only `**...**` markers, drops any preamble, and treats a leading `כותרת` section as the centred header line (falling back to `case_number | parties | (year)` from metadata). Renders David/David Libre serif, RTL, justified 12pt body, 13pt bold section headings, a provenance badge (הועלה ע"י המשתמש / מאגר מקומי / אוחזר חיצונית), a "מקור הטקסט המלא" link, plus Copy (rich HTML + plain) and Print (standalone print window). Coupling to the model is loose: any backend emitting `**heading**` blocks renders correctly, and the component degrades to a single "סיכום" section otherwise. It can serve a new backend with essentially no change; only a structured-JSON backend would need a thin adapter.

## 13. Named-case path: A (full V2) vs B (targeted)

| | A. Full V2 agent | B. Targeted acquisition + summary model |
|---|---|---|
| Latency | 200–350s (observed V2 runs) | 10–40s |
| Cost | ~$0.3–0.6/run, many agent turns | one flash call + one fetch |
| Reliability | agent may wander, budget exhaustion | deterministic |
| Completeness | partial spans only; V2 verifier admits *quotes*, not whole judgments | whole 50k-char text in context ⇒ complete sections |
| Hallucination risk | low but drafter is prose-oriented | low: grounded-only prompt, no external citation allowed |
| Finding the right judgment | V2 web/official search is weaker for Israeli judgment DBs | `verify-case-fulltext` docket variants + caselaw-domain filter is better today |

**Recommendation: B.** Summarizing one known judgment is an extraction task, not a research task. Optionally borrow one V2 concept: if `verify-case-fulltext` fails, offer a single V2-assisted locate step, not a full research run.

## 14. Uploaded-judgment path

No reason to run a Research Agent at all. Correct pipeline: upload → extract full text → validate (length + Hebrew ratio + docket/title identity if the user named a case) → structured summary model → renderer. Keep client-side pdf.js/mammoth extraction for now (fast, free, no egress, works while the user watches); plan to move extraction server-side later so the same extractor serves case summary, V2 attachments and future batch upload, and so 40MB+/scanned files with OCR are handled uniformly. `verify-case-fulltext`'s magic-byte + ConvertAPI path is the natural server-side home.

## 15. Verifier role in case summary

Running the full four-check V2 verifier on one known judgment adds little: span verification of a summary against its own source is redundant and would reject legitimate paraphrase. Reuse only three concepts, cheaply:
1. identity — docket/title present in the body (V1/V2 `normalizeDocketText` already does this);
2. meaningful full text — length + Hebrew-ratio gate (already implemented);
3. grounded quotations — if the summary quotes verbatim or cites a paragraph number, check that string exists in the body (V2 `spanMatch.ts` is directly reusable).
Do not run support/temporal verification here.

## 16. Unified workspace UX

The proposed navigation (מחקר משפטי / אזכור אחיד / הערות שוליים / ביבליוגרפיה / כתיבה אקדמית — בקרוב) is cleaner than three sibling research cards: today the user must decide between "מחקר משפטי", "חיפוש מקורות" and "סיכום פסיקה" before knowing what the system can do, and the difference between the first two is not explainable in one line. One workspace + intent = one mental model, one history, one credit story.

## 17. Intent selector

`LegalQAChat.tsx` already renders a mode-card row above a single composer. Smallest good fit: a **segmented control directly above the input** (3 items, RTL, persists per session, switches placeholder). A menu attached to the input hides the capabilities; three large cards recreate today's problem.

| Intent | Hebrew label | One-line description | Placeholder |
|---|---|---|---|
| answer | מענה לשאלה משפטית | תשובה מנומקת עם מקורות מאומתים והערות שוליים | "מהי אחריות נושא משרה בחדלות פירעון?" |
| sources | חיפוש מקורות | רשימת מקורות מדורגת, ללא תשובה מלאה | "מצא מקורות בנושא אחריות נושאי משרה בחדלות פירעון" |
| case summary | סיכום פסק דין | דו״ח מובנה על פסק דין לפי שם, מספר תיק או קובץ | "סכם את בע\"מ 919/15 — או העלה את פסק הדין" |

## 18. Shared history

Yes — one left-side research history for all three. Metadata already exists in practice (`task_mode` = `research` / `legal_source_search` / `case_summary`, plus the `__sources_only` and `__case_summary` sentinels in `footnotes`). Add only a small icon/badge per row (📄 תשובה / 🔎 מקורות / ⚖️ סיכום) and optional filtering. No data migration needed — existing rows already carry `task_mode`.

## 19. Recommended backend per intent

| Intent | Backend |
|---|---|
| מענה לשאלה משפטית | V2 Research Agent → Evidence Store → Verifier → Drafter → deterministic citation renderer (unchanged) |
| חיפוש מקורות | V2 Research Agent (source-scouting contract, lighter budgets) → Evidence Store → Verifier (identity + body-read, span where excerpt given) → **Source Renderer**, no drafter |
| סיכום פסק דין — named case | `verify-case-fulltext` (docket variants → local corpus → caselaw-domain discovery → DOCX/PDF/HTML extraction) → validation gates → structured summary model → `CaseSummaryReport` |
| סיכום פסק דין — uploaded | extract (client now, server later) → validation gates → same summary model → same renderer; no agent |

## 20. Reuse map

| Item | Classification |
|---|---|
| `LegalSourceSearchPanel.tsx` | REPLACE (rebuild as a renderer inside the unified workspace; keep its grouping/labels/card design) |
| `lib/sourcesOnly.ts` | REUSE / ADAPT — port `classifyDisplayGroup`, dedup keys, sanitized reason labels, two-tier logic, URL liveness; drop V1-typed I/O |
| V1 `sources_only` branch in `legal-research-v1/index.ts` | DELETE LATER (only after V2 source mode ships) |
| V2 Research Agent tools (`search`/`fetch`/`lookup_authority`, ledger, corroboration) | KEEP AS-IS |
| V2 verifier | KEEP AS-IS (subset-invoked for source mode) |
| `verify-case-fulltext` | KEEP AS-IS, and elevate to shared acquisition/extraction infrastructure |
| Case-summary prompt | REUSE / ADAPT (optionally add הליך דיוני; keep the grounded-only iron rule) |
| `CaseSummaryReport.tsx` | KEEP AS-IS |
| client pdf.js / mammoth extraction | REUSE now, MOVE SERVER-SIDE later |
| credits / jobs / progress / history / refunds | KEEP AS-IS |
| V1 as a whole | KEEP while attachments still route to V1 (`src/config/researchPipeline.ts`) |

## 21. Cost / latency expectations

- Cheapest & fastest: **uploaded case summary** — no search, no fetch, one flash call on ≤50k chars (~10–20s).
- Fast/cheap: **named case summary** — one Perplexity JSON call + one document fetch + one flash call (~20–45s), plus ConvertAPI when the source is a PDF.
- Medium: **source search on V2** — agent turns dominated by `search`/`fetch`; no drafter, no citation rendering, no full support-verification sweep; realistically ~40–60% of a full research run in both tokens and wall time, because prompt growth from repeated reads is the main V2 cost driver and a source list needs shallower reads.
- Heaviest: **full legal answer** — 15–25 agent steps, 150k–300k prompt tokens, 200–350s, plus drafter and verification.
Yes to both questions: stopping before the drafter (and reading less deeply per source) makes source search genuinely cheaper and faster than full research, and case summary stays an order of magnitude faster because it never enters the agent loop. Pricing should follow: case summary and source search should not cost the same 5 credits as a full researched answer.

## Final beta decision

1. Standalone "חיפוש מקורות" — **remove from top-level navigation**.
2. Its use case — **survives** as an intent inside מחקר משפטי.
3. Old V1 implementation — **replace** (port the presentation logic, retire `sources_only`).
4. Standalone "סיכום פסיקה" — **remove from top-level navigation**.
5. Its use case — **survives** as an intent inside מחקר משפטי.
6. Backend — **keep the current targeted pipeline**, hybridized only by reusing V2 identity/span helpers; do not run full V2.
7. Preserve: `verify-case-fulltext`, the case-summary prompt, `CaseSummaryReport.tsx`, all V2 tools/verifier/jobs/credits, and the product logic inside `sourcesOnly.ts`.
8. Eventually deletable: `LegalSourceSearchPanel.tsx`, `lib/sourcesOnly.ts` (after porting), the V1 `sources_only` branch and its guards — only once the V2 source mode is live and attachments no longer require V1.

Confirmation: no code changed, nothing deployed, nothing deleted, no migration performed, no live query run.
