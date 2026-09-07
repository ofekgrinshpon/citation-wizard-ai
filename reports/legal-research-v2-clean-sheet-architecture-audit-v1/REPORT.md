# legal_research_v2_clean_sheet_architecture_audit_v1 — READ-ONLY

No code changed. Evidence base: full module map of
`supabase/functions/legal-research-v1` (index.ts 4,256 LOC; 112 files under
`stages/`, 16 under `lib/`; ~55k LOC total), infrastructure audit of
`supabase/functions/*`, `tools/court-egress-relay`, DB migrations, plus
`reports/pipeline-architecture-diagnosis/REPORT.md` and the last ~15 acceptance
reports (direct-authority survival, dedupe, literature richness, PDF
extraction).

Guiding test applied to every component: **"if the repo did not exist, would we
build this?"** If no → do not carry it.

---

## 1. Clean-sheet V2 architecture

Six components. Nothing else.

```text
  user question
        |
   [1] Intake            deterministic: mode-free normalisation, docket/statute
        |                 detection, attachment text, budget + credits
        v
   [2] Research Agent    ONE tool-using LLM loop (stopWhen ~40 steps)
        |   tools: search / fetch / corpus
        |   emits: research memo = ordered claims, each with
        |          {proposition, source_id[], quoted spans, page/section}
        v
   [3] Evidence Store    append-only per-run store of fetched documents:
        |                 url, fetch status, bytes, extracted text, hash,
        |                 identity fields parsed from the text itself
        v
   [4] Verifier          ONE deterministic pass + ONE LLM support pass:
        |                 identity check, body-read check, span check,
        |                 support check → verified evidence pack
        v
   [5] Drafter           sees ONLY the verified pack; emits structured blocks
        |                 with source_ids, never citation markup
        v
   [6] Citation Renderer deterministic: markers, numbering, footnote text,
                          Hebrew citation format, invariant check
```

### Why each component exists

| # | Component | Justification (why it cannot be removed) |
|---|---|---|
| 1 | Intake | Auth, credits, job row, attachment text, and the two deterministic facts a language model reliably mis-reads: an explicit docket number and an explicit statute section. Everything else it does today is deleted. |
| 2 | Research Agent | The single decision-maker. Replaces analyzer + facet expansion + query planner + nomination + mode/router + budget shaping + rescue loops. A tool-using model decides what to look for, reads results, and decides what to look for next — that is exactly the loop V1 hard-codes across ~40 stages. |
| 3 | Evidence Store | Verification requires an immutable record of *what bytes we actually received*. Without it "the model says it read the judgment" is unfalsifiable. It is a table + a fetch cache, not a pipeline stage. |
| 4 | Verifier | The product's whole value: **the LLM decides what to research; ReLex decides what may be cited.** One gate, four checks. |
| 5 | Drafter | Turning verified evidence into Hebrew legal prose is a genuine generation task. It is separated from the agent so it physically cannot cite anything the verifier rejected. |
| 6 | Citation Renderer | Citation format is a rule system (Uniform Citation Rules), not a judgement call. Deterministic code gets it right 100% of the time; models do not. Also enforces the footnote invariant (no orphan markers, no dangling notes). |

Everything in V1 that is not one of these six is either a compensation for a
weakness introduced by another V1 stage, or a heuristic substituting for an
agent decision.

---

## 2. Components V2 does NOT need

Verdicts, one concrete reason each.

| Concept | Verdict | Reason |
|---|---|---|
| Planner (claim analyzer) | **NOT NEEDED** | The agent decomposes as it researches; V1's up-front decomposition is a guess made before any source is seen, and facet expansion on top of it is the main query multiplier behind the 835 s CPU deaths (D3/D5). |
| Query planner | **NOT NEEDED** | A search tool call *is* a query. Planning queries in a separate LLM call, then auditing them with `C1–C5` triggers, is a workaround for not letting the model search. |
| Source nomination | **NOT NEEDED** as a stage | "What sources should exist" is a research hypothesis the agent forms and tests in one step. Keep only the deterministic explicit-docket / explicit-statute-section obligation, inside Intake. |
| Canonical registry | **OPTIONAL — small data asset** | A curated map "doctrine → landmark authority + official URL" is genuinely useful *as a lookup tool the agent may call*. `coreAuthorityRegistry.ts` (791 LOC) as a pipeline stage with discovery, acquisition and survival sub-stages is not. Keep the table, delete the machinery. |
| Source roles | **NOT NEEDED** | Roles exist so downstream slotting/quota code can fill buckets. With no slotting there is nothing to type. The verifier cares about *what the text says*, not its assigned role. |
| Source integrity classification | **PARTLY NEEDED, renamed** | The useful residue is one boolean per document: *is the fetched text the actual legal document, or a listing/portal/paywall/block page?* That is check 1 of the verifier. The 658-LOC taxonomy of citability classes is not needed. |
| Candidate pool | **NOT NEEDED** | A pool exists because V1 retrieves blindly and must then triage 30+ unread hits. An agent fetches what it decides to read; there is no undifferentiated mass to pool. |
| Ranking | **NOT NEEDED** | Ranking is the pool's triage function. The agent's own reading order replaces it. |
| Diversity caps / variety caps | **NOT NEEDED** | Pure pool-shaping. Their entire failure history (`direct_authority_pool_survival`, `direct_authority_variety_cap_survival`, `authority_duplicate_resolution`) is exemptions invented to undo damage the caps themselves caused to the single most relevant authority. Delete cause, delete cure. |
| Doctrine mapping | **NOT NEEDED** as code | A static doctrine list is a prompt hint or a registry row, not a stage. |
| Research modes (7) | **NOT NEEDED** | Modes were introduced to route effort; the diagnosis found the label reaches only the planner. Effort is naturally variable in an agent loop (few tool calls for a statute section, many for a memo). |
| Academic mode | **NOT NEEDED** as a mode; **NEEDED** as a drafting instruction | Nine V1 modules (`academic*`, `naturalLiteratureMode`, `literatureBodyCompleteness`, ~4,000 LOC) exist to force scholarship into a pipeline tuned for judgments. In V2 "cite scholarship, write in review genre" is one line in the agent prompt plus an academic-search tool. |
| Representative selection | **NOT NEEDED** | Only needed because V1 accumulates multiple representations of one authority. If the agent fetched one URL for Bavli, there is one document. Keep a trivial dedupe by document hash in the Evidence Store. |
| Source slotting | **NOT NEEDED** | Quota filling. Same objection as roles. |
| Recovery stages | **NOT NEEDED** | `secondaryBodyAcquisition` being called four times, `sameAuthorityBodyFallback`, `primaryShapeRescue`, `academicLiteratureGateRepair`, `thin pack recovery` are retries around a fixed pipeline order. An agent retries by calling a tool again. |
| Rescue stages | **NOT NEEDED** | Same. |
| Fixed source targets | **NOT NEEDED** | Already abandoned in principle in `academic_literature_richness_without_fixed_source_count_v1`. A question with two good sources should have two footnotes. |
| Richness heuristics | **NOT NEEDED** | Counting footnotes measures nothing about correctness. Replace with one honest report: how many claims are verified, how many are qualified, how many were dropped. |

**Kept from the challenge list: nothing, except a canonical-authority *table*
and the "is this the real document" boolean.**

---

## 3. Minimal agent toolset

Three tools. Not six.

| Tool | Purpose | Input | Output | Why the agent needs it | Israel-specific? |
|---|---|---|---|---|---|
| `search` | Find candidate documents anywhere: web, official court/Knesset sites, the local corpus, academic sources. One tool, one optional `scope` enum (`web` \| `official` \| `corpus` \| `academic`) that only changes which backends are queried. | `{query_he, scope?, limit?}` | `[{result_id, title, url, snippet, origin}]` | Discovery is one cognitive act; splitting it into four tools makes the model choose plumbing instead of research. The `scope` hint keeps the specialised backends reachable without four schemas. | Generic interface, Israel-specific backends (Perplexity IL-tuned queries, `court.gov.il`, Knesset, local corpus). |
| `fetch` | Retrieve and read a document's actual text: HTML, PDF (bounded/chunked), DOCX, official sites via relay. Writes into the Evidence Store and returns an id. | `{url \| result_id, want?: "full" \| "section", locator?}` | `{source_id, title, status, text, truncated, identity: {docket?, section?, court?, date?}}` | Reading is the act that makes a citation legitimate. Returning a `source_id` is what later lets the verifier prove the body was read. | Generic contract; Israel-specific fetch profiles and court relay behind it. |
| `lookup_authority` | Exact resolution of a named Israeli authority: docket → official judgment URL(s); statute name + section → official text. | `{kind: "case" \| "statute", docket? , statute?, section?}` | `[{title, url, confidence, source: "registry" \| "derived" \| "corpus"}]` | The one thing web search reliably fails at in Hebrew: turning `בג"ץ 1000/92` into the official document. Deterministic, high-value, cheap. | **Israel-law-specific by design.** |

Rejected as separate tools: `local corpus` (a `search` scope), `academic
search` (a `search` scope), `quote/extract` (part of `fetch`), `verify` (never
an agent tool — the agent must not be able to bless its own evidence).

---

## 4. Minimum verifier

One pass, four checks, run over the agent's memo. No overlapping gates.

**1. Identity — is this document the authority it claims to be?**
Deterministic, from the *fetched text*, not from the URL or the search snippet:
the docket string / statute name+section the claim relies on must appear in the
stored body (normalised Hebrew). Mismatch → reject the source for that claim.
This subsumes V1's `judgmentIdentity`, `specificCaseIdentity`,
`exactAuthorityGuard`, `explicitDocketGuard`.

**2. Body — did we actually read it?**
Evidence Store row must exist with `status=ok`, extracted text over a minimum
length, and not classified as listing/portal/paywall/block page (one boolean,
one small classifier reusing V1's block-page signatures). No body → the source
may appear in a "for further reading" list, never in a footnote. This subsumes
`metadataOnlyHoldingGate`, `sourceIntegrity`, `bodyDerivedRole`,
`webLegalSourceClassifier`, `perplexityHygiene`, `localCaselawListingGate`.

**3. Span — is the cited text really in the document?**
The agent must return, per claim-source pair, a verbatim span it relies on.
Deterministic substring/near-match against the stored body. This is the single
strongest anti-hallucination control in the whole design and V1 does not have
it. Fails → source dropped for that claim.

**4. Support — does the span actually support the proposition?**
One LLM call, batched over all claim-source pairs, returning
`supports | supports_partially | does_not_support` plus a one-line reason.
Only this check is model-based, and it runs on text we have proven exists.
Subsumes `verifier` + `claimSourceMatch` + `claimSourceRebinding` +
`topicAwareAlignment` + `nonAcademicBinding` + `academicAuthorityAlignment`.

**Sufficient evidence** = checks 1–3 pass and check 4 returns `supports` (cite
plainly) or `supports_partially` (cite with a hedge the drafter must keep).

**Refuse / qualify** when, and only when:
- an explicit docket or statute section in the question has no verified body →
  say so, name what could not be retrieved, do not answer around it;
- zero claims survive → refuse with the list of what was searched;
- some claims survive → answer those, and state plainly which parts are
  unsupported. No generic "מגבלת ביסוס" boilerplate on otherwise sound answers.

Everything else V1 calls a gate is deleted.

---

## 5. Minimal drafter + citation layer

**The drafter sees only:** the question, and the verified evidence pack —
`[{source_id, display_title, claim_text, verified_spans[], support_level}]`.
It does **not** see rejected sources, raw search results, the agent's
scratchpad, roles, scores, or URLs. This makes miscitation structurally
impossible rather than gate-corrected.

**Output:** structured blocks (`heading | paragraph | list_item`) with
`source_ids[]` per block. The drafter never emits `[1]`, superscripts, or
footnote text — V1's `structuredValidation.ts` already proves this contract
works and should be kept.

**Deterministic footnote rendering: YES, keep it.** It is one of the few V1
inventions that is right on the merits: Hebrew citation format is rule-based,
numbering/renumbering after a dropped source is bookkeeping, and the footnote
invariant (no orphan marker, no dangling note) is only enforceable in code.

**LLM vs code split**

| Code | LLM |
|---|---|
| citation format, numbering, marker placement, dedupe of repeated citations, invariant check, title hygiene | prose, structure, legal reasoning, hedging language, which verified source supports which sentence |

Per-occurrence marker placement (V1's `perOccurrenceFootnotes`) is worth
keeping as a small pure helper; per-sentence spans already come from check 3.

---

## 6. V1 reuse matrix

A = as-is · B = data/primitive only · C = wrap thinly · D = reimplement · E = do not reuse

| V2 capability | V1 code | Class | Note |
|---|---|---|---|
| `fetch` — PDF extraction | `lib/largePdfChunkedExtract.ts` | **A** | Zero repo imports, only `unpdf`. Solves the CPU-quota death. Best asset in the repo. |
| `fetch` — DOCX/HTML/text | `lib/attachments.ts` (`extractPdf/extractDocx/extractDocumentText`) | **B** | Core extractors are portable; the attachment/docket-priority logic and `@ts-nocheck` are not. Lift the three functions. |
| `fetch` — official sites | `lib/officialFetch.ts` | **C** | Correct hard-won behaviour (UA profiles, backoff, block-page detection) but tangled with V1 ledgers. Wrap as a generic client, drop the ledger types. |
| `fetch` — court relay | `tools/court-egress-relay/*`, `lib/courtEgress.ts` | **A** (relay) / **C** (client) | Relay is a standalone Node service, already deployed, allowlisted, token-gated. Client needs a thin re-wrap. |
| `search` — corpus scope | RPCs `match_legal_chunks`, `search_legal_chunks_text` | **A** | Clean SQL RPCs, perf defect already fixed in migration. |
| `search` — corpus query building | `stages/hebrewFts.ts`, `stages/hebrewTopicTerms.ts` | **B** | Hebrew normalisation/tokenisation is real domain value; call as pure helpers. |
| `search` — corpus stage | `stages/localRetrieval.ts` (1,039) | **E** | Claim/query/role-coupled. |
| `search` — web scope | `stages/perplexityRetrieval.ts` (1,049) | **D** | Keep the API-call knowledge (~80 LOC); the admission/hygiene/classification bulk dies. |
| `lookup_authority` — case | `stages/courtFileUrls.ts`, `lib/judgmentUrlEligibility.ts`, `stages/docketDetection.ts` | **A/B** | Small, pure, tested, genuinely Israel-specific. The highest-value domain knowledge in V1. |
| `lookup_authority` — statute | `stages/statuteSectionDetection.ts` | **B** | Pure detection helper. |
| `lookup_authority` — registry | `stages/coreAuthorityRegistry.ts` | **B** | Extract the doctrine→authority rows as data; discard the stage. |
| Evidence Store — cache | `stages/verifiedSourceCache.ts` | **C** | Table + cache idea is sound; identity-purge logic learned the hard way. Rebuild around `source_id`. |
| Verifier check 1 (identity) | `stages/judgmentIdentity.ts`, `specificCaseIdentity.ts`, `explicitDocketGuard.ts` | **B** | Reuse the Hebrew docket-normalisation predicates only. |
| Verifier check 2 (body) | `stages/sourceIntegrity.ts`, `webLegalSourceClassifier.ts`, `discoveryPrecision.ts`, `localCaselawListingGate.ts` | **B** | Harvest the block-page / listing-page signature strings into one ~60-LOC classifier. Discard the taxonomies. |
| Verifier check 3 (span) | — | **new** | V1 has no span check. |
| Verifier check 4 (support) | `stages/verifier.ts` (1,136) | **D** | The batched claim×source LLM idea is right; the implementation carries roles, verdict tiers and pool assumptions. |
| Drafter contract | `stages/structuredValidation.ts` (185) | **A** | Clean, pure, correct: forbids model-emitted markers. Keep verbatim. |
| Drafter | `stages/drafterV2.ts` (2,792 LOC, 31 sibling imports) | **E** | The most coupled file in the repo; mostly compensation for upstream noise. |
| Footnote rendering | `stages/footnoteBuilder.ts` (851), `perOccurrenceFootnotes.ts` (98) | **C** / **A** | Renumbering + invariant logic is valuable; strip its dependence on roles/pack shapes. Per-occurrence helper is pure — keep. |
| Citation formatting rules | `src/lib/citationUtils.ts`, `.lovable/memory/logic/citation-rules/*` | **B** | The Hebrew citation-rule knowledge is a durable asset independent of both architectures. |
| Title hygiene | `stages/displayTitleHygiene.ts` (462), `sourceLabelQuality.ts` | **C** | Keep a much smaller version; a lot of it cleans up mess V2 will not create. |
| Jobs | table `legal_research_jobs` | **A** (table) / **D** (polling) | Schema is generic and correct; the polling code lives inside `index.ts`. |
| Credits/refunds | `consume_credits`, `refund_credits*` RPCs | **A** | Idempotent, ledger-keyed, security-definer. Reuse unchanged. |
| Auth/RLS | per-function JWT + `user_roles`/`has_role` | **A** | Pattern is consistent; factor into `_shared/` when writing V2. |
| Telemetry | table `qa_logs` | **A** (table) / **D** (writer) | Writer is V1-typed. Note the standing governance flag: `qa_logs.metadata` can embed user-document excerpts. |
| Upload/storage | `user-documents` bucket usage | **B** | Path-ownership + MIME allowlist pattern is good. Known gap: **uploaded files are never deleted** (no retention job) — unrelated to V2 but open. |
| Everything else under `stages/` (~80 files) | — | **E** | Pool shaping, roles, slotting, modes, academic machinery, recovery/rescue, sufficiency, richness. |

Rough arithmetic: of ~55k LOC, roughly **4–6k is worth carrying** (extraction,
fetch/relay, Hebrew + docket/statute primitives, structured validation,
footnote rendering, registry data), and the rest is V1 orchestration.

---

## 7. Sunk-cost traps

Components whose only real claim on V2 is the effort already spent.

| Component | Why it is tempting | Does V2 need the concept? | Recommendation |
|---|---|---|---|
| `drafterV2.ts` (2,792 LOC) | Months of prompt tuning; produces the current answers. | The *structured-block contract* yes; the file no. Most of its bulk handles source-plan compliance, roles, deterministic branches and pack noise that V2 does not generate. | **Replace**, keep the contract and the best 3–4 prompt paragraphs. |
| `verifier.ts` (1,136 LOC) | It is literally called "the verifier". | The idea yes; this implementation is a claim×candidate matrix over an unread pool. | **Replace** with checks 1–4. |
| Candidate pool + all cap/exemption work (`candidatePool`, `directAuthoritySurvival`, `duplicateRepresentative`, `urlCollisionGuard`, `docketAwareUrlKey`, `representativeSourceSelection`) | Five consecutive hard-won tracks; each acceptance report is a genuine engineering win. | **No.** Every one of those tracks fixed damage caused by the pool + caps. The Bavli saga (found → dedupe → cap → exemption → still died at body acquisition) is the proof. | **Remove the whole cluster.** Keep only hash/URL dedupe in the Evidence Store. |
| Academic/literature stack (~9 modules, ~4k LOC) | Very recent, very expensive, many tracks. | No — as a *mode*. Yes — as a drafting genre + an academic search scope. | **Remove**, re-express as prompt + `scope:"academic"`. |
| Research modes + router profiles | Felt like the architectural answer in the last diagnosis. | No. An agent's loop length is naturally adaptive; the diagnosis itself found the mode label barely propagates. | **Remove.** |
| Claim facet expansion | Elegant, and improved doctrinal coverage in its own validation. | No. It is the main query multiplier behind the CPU-quota deaths, and it front-loads decomposition before any source is read. | **Remove.** |
| Sufficiency / richness / doctrinal-sufficiency stack | Encodes real editorial judgement about thin answers. | Partly: keep *honest reporting* of unsupported claims. Drop *counting*. | **Replace** with a 30-LOC coverage report. |
| `officialSourceDiscovery.ts` (1,978 LOC) | Contains the only working knowledge of how Israeli official sites behave. | The *knowledge* yes, the stage no. | **Extract** the URL patterns and fetch profiles into `lookup_authority` + `fetch`; delete the rest. |
| The 200+ acceptance reports and eval fixtures | Enormous accumulated evaluation effort. | **Yes — genuinely.** The fixtures, gold anchors, and the 18Q/L-series questions are architecture-independent. | **Keep**, and run V2 against them from day one. |

---

## 8. Do not carry into V2

Explicit kill list. Each of these mostly compensates for another V1 stage.

1. Claim analyzer + facet expansion + query planner as separate LLM stages.
2. Source nomination, source-use intent, claim-source planning/rebinding.
3. Research modes, router profiles, source-depth policy, retrieval governor.
4. Candidate pool, ranking, diversity caps, variety caps, direct-authority
   survival exemptions, doctrinal candidate stabilization, source hierarchy,
   authority source priority, last-mile funnel.
5. Source roles, role maps, slotting, admission quotas, body-derived roles.
6. The integrity/citability taxonomy (keep one boolean).
7. Sufficiency, richness, doctrinal sufficiency, completeness scoring, fixed
   source targets.
8. All recovery/rescue/repair stages, including the four-call
   `secondaryBodyAcquisition`, `sameAuthorityBodyFallback`,
   `primaryShapeRescue`, `academicLiteratureGateRepair`, thin-pack recovery.
9. The academic-mode stack as a mode (9 modules).
10. Representative selection and duplicate-representative resolution.
11. `drafterV2.ts` and legacy `drafter.ts`.
12. `index.ts` orchestration (4,256 lines) in any form.
13. Generic "מגבלת ביסוס" caveat boilerplate — replaced by specific, truthful
    statements about what was not retrieved.

---

## 9. True reusable infrastructure (verified, not assumed)

| Asset | Status | Caveat |
|---|---|---|
| Legal corpus tables + `match_legal_chunks` / `search_legal_chunks_text` RPCs | **Solid, reuse** | — |
| Embedding ingestion `embed-legal-source` | **Defective** | Generates a pseudo-embedding by asking a chat model for 768 floats, while query-side uses real `text-embedding-3-small`. Vector space may be mismatched for anything ingested through this path. Must be resolved before V2 trusts corpus vector search. |
| `largePdfChunkedExtract.ts` | **Solid, reuse as-is** | — |
| `extractPdf/extractDocx/extractDocumentText` | **Reuse (lift out)** | File is `@ts-nocheck`; mammoth Deno shim workaround must come along. |
| `officialFetch.ts` fetch profiles/backoff | **Reuse via thin wrap** | Coupled to V1 ledger types. |
| Court egress relay service | **Solid, reuse as-is** | Standalone Node service, allowlisted to `*.court.gov.il`, token-gated; documented curl-vs-undici and raw-query-string fixes. |
| `legal_research_jobs` table | **Solid, reuse** | Polling logic is inside V1 `index.ts`; rewrite. |
| Credits: `consume_credits` / `refund_credits` RPCs | **Solid, reuse as-is** | Idempotent via `(user_id, request_id, event_type)` unique index. |
| Auth + RLS pattern | **Solid** | Duplicated per function; no `_shared/auth.ts` — worth creating for V2. |
| Storage `user-documents` | **Reuse pattern** | Open gap: uploaded files are never deleted (no retention job). |
| `qa_logs` telemetry table | **Reuse table** | Governance flag: metadata can embed user-document excerpts and full prompt/answer text visible to admins. |
| Eval fixtures, gold anchors, 18Q/L-series, harness scripts | **Solid, reuse** | Architecture-independent; the main safeguard against V2 regressing. |
| Hebrew citation rules (`src/lib/citationUtils.ts`, memory rules) | **Solid, reuse** | Durable domain asset. |
| Frontend (chat UI, jobs, credits, footnote rendering) | **Untouched** | V2 is a new edge function behind the same response contract. |

---

## 10. Smallest prototype

Goal: answer real Israeli legal questions end to end, agentically, in a few
days. New edge function `legal-research-v2`, no frontend work, no billing
changes, one optional migration.

**Files to create** (target ≈1,500 LOC total):

```text
supabase/functions/legal-research-v2/
  index.ts               ~250  auth, credits, job row, request/response contract,
                               invokes the agent loop, writes telemetry
  agent.ts               ~200  AI SDK streamText + tools + stopWhen(stepCountIs(40)),
                               system prompt, memo output schema
  tools/search.ts        ~180  scope: web | corpus | official | academic
  tools/fetch.ts         ~200  fetch → extract → Evidence Store → source_id
  tools/lookupAuthority.ts ~150 docket → official URL; statute+section → text
  evidence.ts            ~120  in-run store: put/get/hash/dedupe/identity fields
  verify.ts              ~250  checks 1–3 deterministic + check 4 batched LLM
  draft.ts               ~150  verified pack → structured blocks (contract only)
  render.ts              ~150  markers, numbering, Hebrew footnotes, invariant
```

**V1 code the prototype may call/copy** (import by path or copy verbatim; no
V1 stage may be imported transitively):

- `lib/largePdfChunkedExtract.ts` — as-is
- `lib/attachments.ts` → copy `extractPdf`, `extractDocx`, `extractDocumentText`
- `lib/officialFetch.ts`, `lib/courtEgress.ts` → thin re-wrap
- `lib/judgmentUrlEligibility.ts`, `stages/courtFileUrls.ts`,
  `stages/docketDetection.ts`, `stages/statuteSectionDetection.ts`,
  `stages/hebrewFts.ts`, `stages/hebrewTopicTerms.ts` → pure helpers
- `stages/structuredValidation.ts` — as-is
- `stages/perOccurrenceFootnotes.ts` — as-is
- `stages/coreAuthorityRegistry.ts` → data rows only
- RPCs `match_legal_chunks`, `search_legal_chunks_text`, `consume_credits`,
  `refund_credits`; tables `legal_research_jobs`, `qa_logs`
- relay service unchanged

**Must not be imported, at any depth:** `index.ts`, `claimAnalyzer`,
`queryPlanner`, `claimFacetExpansion`, `sourceNomination`, `researchMode`,
`routerProfiles`, `sourceDepthPolicy`, `retrievalBudget`, `candidatePool`,
`directAuthoritySurvival`, `duplicateRepresentative`,
`representativeSourceSelection`, `sourceHierarchy`, `sourceIntegrity`,
`sourceSufficiency`, `claimSourceMatch/Planning/Rebinding`,
`topicAwareAlignment`, `verifier`, `drafter`, `drafterV2`, `footnoteBuilder`,
every `academic*`, `literature*`, `*Recovery/Rescue/Repair`,
`officialSourceDiscovery`, `judgmentTextAcquisition`,
`secondaryBodyAcquisition`, `canonical*`.

**Optional migration** (only one, and only if the run must survive a restart):
`v2_evidence` table `(run_id, source_id, url, status, sha256, title, text,
identity jsonb, created_at)` with owner-scoped RLS. The prototype can keep the
store in memory for day one.

**Acceptance for the prototype:** run the existing 18Q set plus L1–L5 and the
divorce/property question that V1 has failed across six tracks. Success is not
footnote count — it is: every footnote survives checks 1–3, the Bavli-class
authority is either cited with a verified span or explicitly reported as
unretrievable, and no run dies of CPU quota.

---

## 11. GO / NO-GO

**GO** — build V2 as a new, separate edge function, keep V1 deployed and
untouched until V2 beats it on the existing eval set.

Reasoning:
- The last six tracks all followed the same shape: the right authority is found,
  then killed by a V1 stage, then a narrow exemption is added, then it dies at
  the next stage. That is the signature of an architecture fighting itself, not
  of remaining bugs.
- Roughly 90% of the 55k LOC exists to compensate for the blind-retrieval →
  pool → triage design. An agent that decides what to read deletes the cause.
- The genuinely valuable assets — extraction, relay, Hebrew/docket primitives,
  corpus RPCs, citation rules, credits/jobs/auth, and the eval corpus — are all
  outside that 90% and survive intact.
- Cost of being wrong is low: V2 is additive, V1 keeps serving users, and the
  eval set is the referee.

**Preconditions before writing V2 code:** resolve the `embed-legal-source`
pseudo-embedding defect (or accept corpus vector search as unreliable and lean
on `search_legal_chunks_text` for the prototype).

**Answer to the most important question**, applied across the audit: for the
candidate pool, ranking, caps, roles, slotting, modes, nomination, planners,
sufficiency, richness, recovery and rescue stages — no, we would not build them
today. They are not carried into V2.
