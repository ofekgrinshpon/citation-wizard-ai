---
name: Topic Reality Check + Multi-round Regeneration
description: suggest_topics pipeline (planner→hybrid retrieval→Perplexity), and multi-round "+ הצע 3 שאלות נוספות" with dedup and exhausted state
type: feature
---

**Topic Reality Check (B1)** — `suggest_topics` runs planner (`gpt-5-mini`) → hybrid local retrieval (text+vector via `match_legal_chunks`) → Perplexity `sonar` fallback when local hits < `TOPIC_REALITY_MIN_HITS`. Results returned as `topicCoverage`. If no sources → `noCoverage:true`. Telemetry in `qa_logs.metadata.topic_reality_check`. Flags: `TOPIC_REALITY_CHECK_ENABLED`, `TOPIC_REALITY_PPLX_ENABLED`, `TOPIC_REALITY_MIN_HITS`.

**Multi-round regeneration (B1.1)** — UI keeps every round of suggested questions visible and clickable. "+ הצע 3 שאלות נוספות" button calls `suggest_topics` again with `previousQuestions: string[]` and `round: number`. Backend (`getAcademicSubModePrompt`) prepends a "previously shown — must be entirely new" block. Frontend dedups returned questions vs all previous via token-Jaccard ≥ 0.75; if fewer than 2 fresh remain → `exhausted=true` round shown with a destructive-styled "couldn't find more" card + clickable "נסה נושא אחר" / "יש לי שאלת מחקר משלי" buttons. Hard cap: `MAX_ROUNDS=3` (= 9 questions). State: `suggestionRounds: Array<{questions, coverage, exhausted}>`. Per-round coverage badges and sources accordion preserved.
