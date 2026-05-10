## You're right — and that's the real bug

The conclusion prompt itself is correct: it explicitly tells the model to synthesize the body chapters that were just written, **forbids new arguments**, says "no hard footnote quota" and aims for 700–1300 words of prose (`buildConclusionPrompt`, `legal-qa/index.ts:1509`).

But the *pipeline* doesn't match the prompt. Today the routing is:

| Sub-step | Pipeline | Retrieval? | Claim map? | Perplexity? |
|---|---|---|---|---|
| `suggest_topics`, `validate_question`, `propose_outline` | light Gemini Flash path | text-only hint | no | no |
| `write_chapter` + `isAbstract=true` | light Gemini Flash path | **none** | no | no |
| **`write_conclusion`** | **full Deep pipeline** | **yes (vector + Perplexity)** | **yes** | **yes** |
| **`write_introduction`** | **full Deep pipeline** | **yes** | **yes** | **yes** |
| `write_chapter` (real body chapter) | full Deep pipeline | yes | yes | yes |

The gate is `isAcademicChapter` at `legal-qa/index.ts:2036–2080`, which lumps chapter + intro + conclusion together and forces `enableDeepPipeline = true` for all three. So the conclusion synthesis goes through decomposition → vector search across 440k chunks → re-rank → Stage E.5 Perplexity → claim map → structured drafter — even though the prompt has already told the model to invent nothing new and just synthesize.

That's why your last query failed:
- Retrieval hit `match_legal_chunks` `statement timeout` (~50s, no vector index — separate issue, see §3).
- Re-rank kept 0/12 chunks. Perplexity-retry was aborted.
- The function shut down before reaching the `qa_logs` insert. No row, "failed conclusion".

For a synthesis task, none of that retrieval should have happened in the first place.

## What the conclusion (and intro) should actually do

Same shape as the abstract path that already works (`legal-qa/index.ts:2160–2270`):

- **No vector retrieval, no Perplexity, no claim map.** Pure synthesis.
- Prompt context = research question + outline + **all body chapters that were just written** + their existing footnotes (already in the wizard payload via `previousChapters`).
- Footnotes for the conclusion: **only re-use citations that already appear in the body chapters** (via "לעיל ה"ש X" — see the existing `repeated-citations` rule). No new authorities.
- Word range stays Deep-class (700–1300 conclusion, ~800–1400 intro), but enforced via prompt, not via the Deep `wordRangeMin` floor.
- Model: `google/gemini-2.5-flash` (same as abstract), `max_tokens` ~3000 to fit the longer envelope.
- One AI call total. Latency target: <15s.
- `qa_logs` insert happens on the light path (already does for abstract) → run is recorded in the history sidebar, billing ledger gets its 8 credits, the wizard advances cleanly.

The introduction has one extra wrinkle: it's framing, so the user *may* want a thin retrieval pass for, e.g., a constitutional anchor. **Recommended default: skip retrieval there too** and let it draw on the citations already accumulated in the body chapters. We can revisit if the output looks under-anchored after a few real runs.

## Plan of changes

### 1) Reroute conclusion + introduction to the light synthesis path

In `supabase/functions/legal-qa/index.ts`:

- Extend the light-path gate at line 2166–2169 to include `write_introduction` and `write_conclusion`. Concretely, add `isPaperLevelSynthesis = academicStep === "write_introduction" || academicStep === "write_conclusion"` and OR it into the condition.
- Skip retrieval/file-context for paper-level synthesis (treat them like abstract: `if (!isAbstractGeneration && !isPaperLevelSynthesis)` for the local-search and document-text blocks).
- Bump `max_tokens` to 3000 when `isPaperLevelSynthesis`. User content stays "כתוב את פרק הסיכום עכשיו" / "כתוב את המבוא עכשיו".
- Persist to `qa_logs` with `metadata.academic_step` set, mirroring abstract.
- Word-count guard: trim only for abstract — leave intro/conclusion uncapped (the prompt already states 700–1300 / 800–1400).

### 2) Update the gating constants

In `supabase/functions/legal-qa/academicProfiles.ts`:

- Flip `enableDeepPipeline` to `false` for both `introduction` and `conclusion` profiles (currently `true`, lines 137 and 152).
- Same on the `inheritsFrom` field — set to `null`.
- Keep `creditCost: 8` for both (same billing as today).
- The QA-guard fields become moot for these two profiles; either zero them out or leave them untouched (they're only read on the Deep path, so it's harmless).

In `legal-qa/index.ts`, update `isAcademicChapter` (line 2036) so it no longer pulls intro/conclusion into the Deep pipeline. Either:
- Rename it to `isAcademicChapterDeep` and exclude intro/conclusion, or
- Keep the name and make `enableDeepPipeline` honor `academicProfile.enableDeepPipeline` instead of the bare `isAcademicChapter` flag (cleaner — the profile is already the source of truth).

### 3) Separately fix the missing HNSW index (real chapters still need it)

This is unrelated to your conclusion question, but it's the reason every retrieval call has gotten slower since the Supreme Court ingestion. `legal_document_chunks` has 439,443 rows with `embedding`, and the only indexes are PK, `document_id`, FTS GIN, and a partial btree on `created_at WHERE embedding IS NULL`. **There is no HNSW / IVFFlat index on `embedding`** — every vector search does a sequential scan over 440k vectors, which is what tripped Postgres `statement_timeout`.

Migration:

```sql
SET maintenance_work_mem = '1GB';

CREATE INDEX CONCURRENTLY IF NOT EXISTS
  idx_legal_chunks_embedding_hnsw
ON public.legal_document_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

ANALYZE public.legal_document_chunks;
```

This benefits **all** retrieval paths — Fast/Deep research, body-chapter writes, citation-chat, case-law search — not just academic mode.

### Order of execution

1. Reroute conclusion + introduction (steps 1 + 2). Verify by running "write_conclusion" on a finished outline and confirming `qa_logs.metadata.academic_step = "write_conclusion"` lands and latency is single-digit seconds.
2. Apply the HNSW migration. Verify `match_legal_chunks` returns in <2s and re-run a body chapter to confirm the retrieval path is healthy.
3. Update memory `mem://features/academic-writing-mode/intro-conclusion-roles` to reflect that intro/conclusion are now synthesis-only (no retrieval), aligned with the abstract.

### Out of scope

- No changes to `buildConclusionPrompt` / `buildIntroductionPrompt` themselves — they're correct.
- No change to billing (still 8 credits).
- No change to the wizard order (body → conclusion → introduction → abstract).

Approve and I'll implement steps 1–3 in that order.