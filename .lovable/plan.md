## Deliverable 6 — Canonical Citation Builder → Footnote Builder → CitationQualityPass

Three deterministic modules + runner. Drafter is unchanged; it still emits only `[cite:LS#]` markers.

### Scope

In:
- `supabase/functions/legal-qa/core/citations.ts` (new) — canonical builder (Uniform Citation Rules)
- `supabase/functions/legal-qa/core/footnotes.ts` (new) — marker→number + Rule 37 short-form builder
- `supabase/functions/legal-qa/core/citation_quality.ts` (new) — quality gates over both forms
- `supabase/functions/legal-qa/core/types.ts` (edit) — types for the new structs
- `/tmp/run_citations.ts` (runner, not project source) — runs the 3 pilots end-to-end

Out:
- No drafter changes. No edge-function wiring. No DB writes. No UI. No LLM call anywhere.
- Reuse `supabase/functions/_shared/citationResolver.ts` + `citationEngine.ts` for canonicalization. Port Rule 37 logic from `src/components/BatchFootnoteBuilder.tsx#applyRepeatCitationRules` into a small Deno helper (no React imports).

---

### 1. Canonical Citation Builder (`citations.ts`)

Per `LedgerSource` → `LedgerSourceCitation`:

```text
ls_id, source_type, declared_type,
canonical_citation: string,
citation_quality: "ok" | "partial" | "failed",
citation_errors: string[],
placeholders: string[],
engine_used: "resolver" | "passthrough" | "none",
// Rule 37 inputs cached once so footnotes.ts can build short forms
short_form_inputs: {
  is_legislation: boolean,
  law_name?: string,                 // for legislation: e.g. "חוק החוזים (חלק כללי), התשל"ג-1973"
  short_label?: string,              // for caselaw/scholarship: e.g. "עניין אפרופים"
  default_section?: string,          // pulled from pinpoint when present
}
```

Algorithm per LS:
1. Map `LedgerSource.source_type` → `DeclaredType` (`statute` | `caselaw` | none).
2. **Engine path**: call `resolveCitation(ls.citation, declaredType, { titleHint, caseNumberHint, decisionDateHint, party1Hint, party2Hint })`. Hints come ONLY from existing LS fields. **No LLM fallback ever.**
   - `resolved=true, placeholders=[]` → `quality="ok"`.
   - `resolved=true, placeholders=[…]` → `quality="partial"` + `placeholder:<field>` errors.
   - `resolved=false` → `quality="failed"` + `engine:<reason>` + `missing:<field>` errors.
3. **Passthrough path** (scholarship/article/web/protocol/unknown): no template — emit deterministic string from existing LS fields:
   - Prefer `ls.citation` verbatim; append host parenthetical for `approved_web`.
   - Else fallback to `title` + pinpoint (using existing `ס׳` / `בעמ׳` convention).
   - Empty title AND empty citation → `quality="failed"`, error `passthrough_empty`.
   - Otherwise `quality="partial"`, error `passthrough_no_canonical_template`.
4. **Off-domain flag** for `approved_web`: host not in `PRIMARY_HOSTS` (lifted from `ledger.ts`) AND not in a small approved scholarly host list (e.g. `mishpatim.huji.ac.il`, `iyunim.huji.ac.il`, `law.tau.ac.il`, `law.haifa.ac.il`, `idi.org.il`) → add error `off_domain:<host>` (QualityPass decides what to do).
5. Build `short_form_inputs` for Rule 37:
   - `is_legislation` = engine sourceType ∈ {primary_legislation, basic_law, secondary_legislation} OR `LEGISLATION_RE.test(canonical)`.
   - `law_name` = legislation: full law name with year suffix as it appears in `canonical_citation` (extract via the same regex used by `BatchFootnoteBuilder.extractLawNameFromInput`, ported).
   - `short_label` = caselaw: `"עניין <party1>"` from engine fields when available, else first segment of canonical before the comma; scholarship/passthrough: `"<author last name>, לעיל ה"ש N"` style — author lastname extracted by the existing `extractShortSourceLabel` port.
   - `default_section` = parsed from `ls.pinpoint` (matches `סעיף\s+([\dא-ת()./\-–]+)`).

Returns `Map<LedgerSourceId, LedgerSourceCitation>`.

---

### 2. Footnote Builder (`footnotes.ts`) — REVISED for Rule 37

**Key change:** every marker occurrence gets its OWN footnote number in first-appearance order. Repeated uses do NOT share a number; instead the footnote TEXT switches to a Rule-37 short form.

```text
buildFootnotes(answer, citations, ledger) →
{
  rendered_answer: string,
  footnotes: Footnote[],
  marker_to_footnote: Array<{ occurrence_index, ls_id, footnote_number, is_repeated, first_footnote_number? }>,
}

Footnote:
{
  number: number,
  ls_id: LedgerSourceId,
  text: string,                       // full canonical OR Rule 37 short form
  is_repeated: boolean,
  first_footnote_number?: number,     // present iff is_repeated=true
  repeated_citation_text?: string,    // mirror of text when is_repeated=true, for clarity
  source_type: string,
  url?: string,
}
```

Algorithm:
1. Scan `answer` left→right for `[cite:LS#]`. Assign sequential `N = 1, 2, 3, …` to **every** occurrence.
2. Track `seenLs: Map<ls_id, { first_footnote_number, prev_footnote_number, citation }>`.
3. For each occurrence:
   - If `ls_id` not in `seenLs` → **first use**: footnote text = `citations[ls_id].canonical_citation`. `is_repeated=false`. Record in `seenLs`.
   - If already seen → **repeated use**: build text via `buildRule37Short(citation, prior, isAdjacent)`:
     - `isAdjacent` = the **immediately preceding marker occurrence** in the answer points to the same `ls_id` (this matches the BatchFootnoteBuilder convention — adjacency is over markers, not over arbitrary text distance).
     - Legislation (Rule 37.5 — never `לעיל ה"ש` for legislation):
       - adjacent → `שם, בס' <section>.` (or `שם.` if no section in pinpoint).
       - non-adjacent → `ס' <section> ל<law_name>.` if both known; else `<law_name>, לעיל ה"ש <first_footnote_number>.` ; else `שם.`.
     - Caselaw / scholarship / passthrough:
       - adjacent → `שם, <pinpoint-with-bet-prefix>.` (or `שם.`).
       - non-adjacent → `<short_label>, לעיל ה"ש <first_footnote_number>[ , <pinpoint-with-bet-prefix>].`.
   - Update `prev_footnote_number` for the LS and `prev_ls_id` overall.
4. Replace every `[cite:LS#]` in the answer with the Unicode superscript form of its assigned `N` (`toSuperscript`, e.g. `¹², ²³`).
5. Pinpoint per-occurrence: the drafter's marker carries no pinpoint, so adjacent-repeat uses the LS's own `default_section`/`pinpoint` (we don't invent new pinpoints).

Ported helpers (Deno, no React deps): `extractLawNameFromInput`, `extractShortSourceLabel`, `withBetPrefix` (β-prefix normalization for `עמ' → בעמ'`, `סעיף → בס'`, `פסקה → בפס'`). One small file; ~80 LOC total.

This module performs the transformation; it does NOT call the AI. The drafter still must NOT generate `שם` or `לעיל` itself — if it does, those tokens are just prose (not citations) and live outside `[cite:LS#]` markers. We add a sanity warning if the answer contains `לעיל ה"ש` or starts-of-sentence `שם` outside our generated footnotes.

---

### 3. CitationQualityPass (`citation_quality.ts`)

Two phases.

**Phase A — pre-footnote (filters LS-level citations):**
For each `LedgerSourceCitation`:
- `failed` → `kept=false`, reason `quality_failed:<errors>`.
- `partial` + `off_domain:<host>` + `origin==="approved_web"` → `kept=false`, reason `off_domain`.
- `partial` engine-resolved with placeholders only → `kept=true`, reason `placeholder_accepted` (this matches `mem://logic/legal-qa/anchored-partial-citations`).
- `partial` passthrough with non-empty text → `kept=true`, reason `passthrough_accepted`.
- `ok` → `kept=true`.

**Phase B — drafter-side enforcement:**
1. Strip every `[cite:LS#]` whose LS is `kept=false` from the answer (collapse double spaces). Record `removed_citations[{ls_id, claim_id, reason}]`.
2. Recompute per-claim coverage. A claim "lost all support" if every marker that previously belonged to it was removed AND no other LS marker remains in the body for it.
3. Run **Footnote Builder** on the cleaned answer + filtered citations map.
4. **Validate both citation forms** produced:
   - **Full canonical (first-use footnotes)**: text non-empty; no `(ציטוט חסר)` placeholder; no leftover `[cite:` token inside; if engine path, must equal `canonical_citation`.
   - **Rule 37 short forms (repeated-use footnotes)**: text non-empty; matches one of the allowed shapes (`/^שם(,.*)?\.$/`, `/לעיל ה"ש \d+/`, or `/^ס' .+ ל.+\.$/` for legislation cross-form); never invokes `לעיל ה"ש` for a legislation LS (Rule 37.5); references a `first_footnote_number` that exists and points to the same `ls_id`.
   - Any failure here → mark the footnote `flagged=true` with reason, remove the marker from the answer, regenerate numbering, re-run Footnote Builder once (single fixed-point). If still flagged on second pass → drop the marker.
5. Final structural invariants (assertions; logged on breach):
   - Every superscript in `rendered_answer` resolves to a footnote.
   - No `[cite:` tokens left in `rendered_answer`.
   - Every footnote's `ls_id` ∈ ledger.
   - Every `is_repeated=true` footnote has `first_footnote_number` referencing a `is_repeated=false` footnote for the same `ls_id`.
6. Final status:
   - `claims_lost_all_support.length > 0` AND surviving supported < 2 → `insufficient_verified_sources` + prepend INSUFFICIENT_SENTENCE.
   - Else if `claims_lost_all_support.length > 0` → `needs_review` + append Hebrew note listing the orphaned claim ids.
   - Else → `ok`.

Returns:
```text
{
  status: "ok" | "needs_review" | "insufficient_verified_sources",
  rendered_answer: string,
  footnotes: Footnote[],
  marker_to_footnote: [...],
  removed_citations: [...],
  flagged_footnotes: [{ number, ls_id, reason }],
  claims_lost_all_support: ClaimId[],
  citation_summary: { ok, partial, failed, off_domain, repeated, legislation_supra_blocked }
}
```

---

### Runner (`/tmp/run_citations.ts`)

Reads `/tmp/ledger_run.json` + `/tmp/drafter_run.json`. For each pilot:
- Build citations → Phase A → strip → Footnote Builder → Phase B validations.
- Write `/mnt/documents/citations_run.json` and `/mnt/documents/citations_report.md`.

Per-pilot report:
- final answer text (with superscripts)
- numbered footnotes (full + short forms clearly labeled `[שם]` / `[לעיל]` / `[full]`)
- marker-to-footnote mapping (occurrence_index → number, LS, repeated?)
- removed/flagged citations with reasons
- whether any claim lost all support
- citation quality summary
- manual quality grade (assigned after reading the rendered output)

### Acceptance gates (before any wiring or further deliverables)

- Every superscript resolves to exactly one footnote in first-appearance order.
- Repeated LS produces a NEW footnote number with Rule 37 short text — never reuses a prior number.
- First-use footnote of a given LS always carries the full canonical citation.
- Repeated-use footnote of a given LS always carries a Rule 37 short form (`שם` / `לעיל ה"ש N` / legislation cross-form), never the full canonical.
- Legislation never gets `לעיל ה"ש` (Rule 37.5).
- Zero `(ציטוט חסר)` footnotes.
- No `[cite:` tokens remain in `rendered_answer`.

### Explicitly out of scope

- No drafter retry on Q2/C5.
- No persistence of citations into `qa_logs.metadata`.
- No edge-function deployment.
- No bibliography / `מקורות` list at the end of the answer.
- No GPT/LLM call anywhere in this deliverable.
