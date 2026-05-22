**Goal**

Fix the regression where retrieval picks unrelated primary regulations over topical secondary sources, and where local secondary sources render as generic labels in footnotes. No query-specific patches, no document-ID hardcoding.

**Scope of changes**

1. **Topical relevance scoring for anchor candidates** (`retrieval.ts`)
   - Add a deterministic, general-purpose scorer applied to the anchor candidate pool before the per-claim reserve picks slots.
   - Inputs: the planner's `factual_anchor_terms` and `concept_anchor_terms` (post-expansion).
   - For each candidate, compute a score from `title + citation + snippet`:
     - Exact phrase match of a full anchor term (e.g. `"דמי חסות"`): strong weight.
     - Multi-token coverage of an anchor term (all tokens present, not necessarily adjacent): medium weight.
     - Single shared token (e.g. `דמי`, `גביית`): weak weight.
     - Title hits weighted higher than citation hits weighted higher than snippet hits.
   - Sort the per-layer anchor pools by this score before `takeFrom` selects reserve slots.
   - Behavioral example (not hardcoded): a row titled `גביית דמי חסות` outranks `תקנות הביטוח הלאומי (גביית דמי ביטוח)` when the anchor term is `דמי חסות`.

2. **Preserve primary-law hierarchy intelligently** (`retrieval.ts`)
   - Keep `needPrimary` for claims that require binding law (`statute_section`, `regulation`, `binding_caselaw`).
   - Change the gate so it is conditional on topical fit:
     - If a primary candidate has only a weak/generic topical score (single shared token or no anchor-term coverage), do NOT use it to displace a directly topical secondary candidate (strong/medium score).
     - If a primary candidate is itself directly topical, primary still wins.
   - This is recall only; verifier/ledger remain the final arbiters.
   - Telemetry: record `anchor_primary_displaced_for_topical_secondary` per claim in the existing per-claim anchor telemetry block.

3. **Local metadata wins over web/weak metadata** (`retrieval.ts` — existing local-DB override block)
   - The local-DB override already swaps `title/citation/source_type` when an approved_web URL matches a `legal_documents` row. Extend it:
     - Also carry through `metadata` (author/year/publication_date/publication_year/volume/journal/etc.) onto the candidate as `metadata.local_doc_meta`.
     - Apply the override to ANY candidate whose `document_id` is set (not only `approved_web`), so a local hit always carries authoritative DB metadata downstream.
   - This makes the local row authoritative for downstream citation building.

4. **Local secondary passthrough quality** (`citations.ts`, passthrough path only)
   - For local `journal_article` / `knesset_research` / `scholarship` / `book` / `policy_paper` / `government_report` (i.e. `declared_type === "none"` with a local title), the passthrough citation must keep the concrete local title/citation and add explicit placeholders for missing bibliographic fields.
   - Use `metadata.local_doc_meta` (from step 3) to:
     - Prefer `metadata.citation` when present; else build from `authors/author + " " + title + " (" + publication + " " + publication_year + ")"`.
     - Insert `[חסר: מחבר]`, `[חסר: שנה]`, `[חסר: כרך]`, `[חסר: כתב עת]` for each missing field instead of dropping it.
   - Never collapse to a generic label like `המשפטים (מאמר אקדמי)` when a concrete title exists in the local row.
   - Keep the journal-pipe-artifact gate and bare-reporter gate untouched.
   - Mark `citation_quality = "partial"` and add a `local_secondary_passthrough` error tag when placeholders are emitted, so the existing rescue path in `citation_quality.ts` keeps them.

**Validation on the same query**

- `חוק העונשין` (or relevant penal-law section) appears if verified as relevant — not hardcoded.
- MMM `דמי חסות` rows survive into the candidate set and, when verified, into footnotes.
- The article footnote reads as the concrete title `סעד החובה לחוקק: הצעה למתווה הדרגתי` (with `[חסר: …]` placeholders for any missing field), not `המשפטים (מאמר אקדמי)`.
- No unrelated `דמי ביטוח` regulation is selected as the factual statutory anchor.
- `qa_logs.metadata.core.retrieval.anchor_slots_used_per_claim[*]` shows the new topical scoring telemetry.
- No query-specific terms, no document IDs, no migrations.

**Files touched**

- `supabase/functions/legal-qa/core/retrieval.ts` — scorer, primary-vs-topical-secondary gate, metadata carry-through.
- `supabase/functions/legal-qa/core/citations.ts` — local-secondary passthrough with placeholders.

**Files not touched**

- DB schema / migrations
- UI components
- Drafter prompt
- Verifier prompt
- Ledger
- Footnote builder
- Citation engine internals (the change in `citations.ts` is confined to the passthrough branch for local secondary types)
