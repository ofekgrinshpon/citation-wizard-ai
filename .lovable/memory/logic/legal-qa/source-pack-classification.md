---
name: source-pack-classification
description: Milestone A.5 source-pack promotion rules — caselaw trusted from DB, knesset_research/journal_article promoted to core only with relevance_score >= 0.55 + anchored + substantive + local provenance.
type: feature
---

# Source-pack classification (Milestone A.5)

`assembleSourcePack` in `supabase/functions/legal-qa/legalSourcePack.ts` decides which retrieved sources land in the `core` bucket the structured drafter sees as authoritative.

## Promotion rules

**Always `core`** (primary authority):
- `authorityClass === "primary_legislation"` (חוקים, חוקי-יסוד, פקודות, תקנות, `israeli_law`)
- `authorityClass === "primary_caselaw"` — derived from DB `source_type === "caselaw"` (or labeled "פסיקה"). `classifyAuthority` in `index.ts` no longer requires the citation regex to match `בג"ץ`/`פ"ד`; it trusts the DB.
- `authorityClass === "user_document"` (uploaded PDF/DOCX)

**Promoted to `core` only when ALL four hold** (`secondary_official` = knesset_research, `secondary_academic` = journal_article):
1. `provenanceInternal === "local"` (not Perplexity, not document)
2. `anchorPresent === true`
3. `usableForAnalysis === true` (excerpt > 300 chars)
4. **`relevanceScore >= 0.55`** — retrieval similarity carried from `match_legal_chunks` / `search_legal_chunks_text` through `SourceCard.relevance_score` → `SourcePackEntry.relevance_score` → `LegalSourcePackItem.relevanceScore`

If 1–3 pass but relevance is below the gate, the item stays in `supporting`. Threshold mirrors the rerank floor — anything below 0.55 wouldn't be in the candidate set.

**Always `secondary`**: external_reference, unknown, anything Perplexity-derived (`provenanceInternal !== "local"`).

## Provenance hardening

`relevanceScore` is INTERNAL — listed in `BANNED_KEYS` (contracts.ts), so `sanitizeResponse` strips it from the user-facing payload. Same treatment as `provenanceInternal`.

## Diagnostics

`qa_logs.metadata.source_type_counts` (added in Milestone A.5) emits `{caselaw, israeli_law, knesset_research, journal_article, perplexity, document, other, promoted_to_core}`. Lets us answer "did the model receive enough core authority?" in one SQL query instead of inferring from indirect signals.

## Why this fixes `core=0` without over-promoting

Production sample before A.5 showed every retrieved chunk landing in `supporting` even at sim=0.85, because `secondary_official`/`secondary_academic` were unconditionally bucketed as supporting. With the relevance gate, a sim=0.78 + 600-char journal hit promotes to `core`, while a sim=0.51 passing-mention chunk stays in `supporting`.
