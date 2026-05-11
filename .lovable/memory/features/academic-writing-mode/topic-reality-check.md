---
name: Topic Reality Check
description: Mini-retrieval verifies real DB/web sources exist before LLM suggests research questions in suggest_topics
type: feature
---

# Topic Reality Check (Feature B1)

In academic_writing `suggest_topics`, before Gemini drafts the 3 research questions, the edge function `legal-qa/index.ts` (~line 2347 onward, inside `academicStep === "suggest_topics"` branch) runs a verification pipeline:

1. **Planner**: `openai/gpt-5-mini` with `reasoning.effort=minimal` and a `plan_queries` tool returns 3–4 retrieval query variations (8s timeout, falls back to `[question]`).
2. **Hybrid local retrieval**: per query, parallel `search_legal_chunks_text` (weight 0.4) + `text-embedding-3-small` (768 dims) → `match_legal_chunks` RPC (threshold 0.55, weight 1.0). Results merged by `document_id`, top 12 kept, scored by sum of weighted similarities. Filters `broken_title` metadata and `^(פרטי מסמך|ללא כותרת)` placeholders.
3. **Perplexity fallback**: only if local hits `< TOPIC_REALITY_MIN_HITS` (default 4) and `PERPLEXITY_API_KEY` present. Calls `sonar` (15s timeout) with `search_domain_filter` (nevo, supremedecisions, lite.takdin, mishpatim, tau, huji) and json_schema `{sources:[{title,source_type,why_relevant}]}`.
4. **Prompt injection**: the verified source pool is appended to `subPrompt` as `=== מקורות שאומתו לנושא ===` block. LLM is constrained to only cite sources from this list, tagged `[מאגר]` / `[חיצוני]`. If total < 3, the LLM is instructed to add `⚠️ כיסוי דל` per question.
5. **No-coverage early exit**: if `local + external === 0`, returns a guidance message (`"לא מצאתי מקורות מספקים..."`) with `noCoverage: true` and no questions.

## Response shape

Returns `topicCoverage: { queries, localHits, externalHits, sources, minCoverageReached, pplxCalled, pplxDurationMs, totalDurationMs }` alongside the standard answer. Persisted in `qa_logs.metadata.topic_reality_check`.

## Frontend (`LegalQAChat.tsx`)

`QAResult` extended with `topicCoverage` and `noCoverage`. Above the proposed questions, badges render: `📚 N במאגר`, `🌐 M מהרשת`, `⚠️ כיסוי דל`, plus a `<details>` accordion listing every verified source (title · source_type · [מאגר/חיצוני], with link if `url`). The `noCoverage` branch renders a destructive-tinted card with a "נסה נושא אחר" button that resets the topic.

## Feature flags (Deno env)

- `TOPIC_REALITY_CHECK_ENABLED` (default `true`) — global kill-switch.
- `TOPIC_REALITY_PPLX_ENABLED` (default `true`) — disables Perplexity fallback only.
- `TOPIC_REALITY_MIN_HITS` (default `4`) — local-hits threshold that triggers Perplexity.

## Out of scope

- Promotion of Perplexity sources into `legal_documents`.
- BM25 hybrid retrieval.
- Per-topic caching.
