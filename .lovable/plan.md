# Fix: הערות שוליים (batch footnotes) quality

## How it works today

Yes — the footnotes section calls the same engine as אזכור אחיד (the `citation-chat` backend function), one call per row. But it calls it through a **separate, much thinner client path**, so it does not get most of what makes the single-citation wizard accurate.

Flow today (`src/components/BatchFootnoteBuilder.tsx`):

```text
row input -> normalizeAbbreviations -> detectSourceType -> engine hint prefix
          -> citation-chat (single user message, no history)
          -> regex check for "[חסר:" / "⚠️" -> valid | warning
all rows fired at once via Promise.allSettled
then: review cards -> repeat-citation rules (שם / לעיל ה"ש / Rule 37.5) -> history, bibliography, integrity card
```

What the wizard (`src/pages/Index.tsx`) does that the batch path **skips** (each verified by reading both files):

1. **Input validation** (`validateCitationInput`) — batch sends anything, including junk or half-sentences.
2. **Verified-source lookup first** (`findVerifiedSourceMatch` / `findSimilarVerifiedSource`) — the wizard returns the stored, human-verified citation instead of re-generating it. Batch never checks, so a source that comes out perfect in אזכור אחיד can come out wrong in a footnote row — and it also burns a credit per row for something already verified.
3. **Pinpoint handling** — the wizard detects pinpoint references (סעיף/עמ') and injects the verified master citation as a hint. Batch treats a pinpoint as a whole new source.
4. **Post-response validation** (`validateAIResponse` + `getMissingFieldsSummary`) — the wizard checks the output against the engine rules for the source type and appends a concrete missing-field warning. Batch only greps for markers the model happened to print itself, so incomplete citations are labeled "valid".
5. **Source-type re-classification** after the answer (e.g. database → published when פ"ד appears).
6. **`requestId` and `projectId`** on the call, plus refund handling — batch sends neither, so charges are not idempotent, rows are not attached to the project, and auto-refunds are ignored.
7. **Concurrency** — the wizard is one request at a time; batch fires every row simultaneously. Each `citation-chat` request does grounded web lookups, so a 5–10 row batch reliably hits rate limits / timeouts, and those rows come back empty or truncated. Failures surface as a single generic toast ("N מקורות נכשלו"), with no per-row reason.

That combination — no verified-source reuse, no rule validation, and a parallel burst that gets throttled — is what produces "most citations come out broken".

## The fix

**1. One shared citation pipeline**
Extract the wizard's per-citation logic into a shared module (`src/lib/runCitation.ts`) that both surfaces call:
input validation → verified-source match (exact / similar / pinpoint hint) → engine hint by source type → `citation-chat` with `requestId` + `projectId` → refund handling → source-type re-classification → `validateAIResponse` warning → extracted citation. The wizard keeps its chat-specific UI behavior; the batch builder calls the same function per row.

**2. Bounded, resilient execution**
Replace `Promise.allSettled` over all rows with a queue of at most 2 concurrent rows, plus one automatic retry with backoff on rate-limit / timeout errors. Rows are updated as they complete so progress is visible.

**3. Honest per-row status**
Each failed row keeps its own error reason (credits, rate limit, service error) shown on the card with a "נסה שוב" button, instead of a single toast. Rows that come back empty or shorter than a plausible citation are marked `error`, not `valid`.

**4. Verified rows cost nothing**
When the verified-source lookup matches, the row is filled from the store and marked ✓ verified without calling the engine — same as the wizard — so a 10-row batch of known sources no longer costs 10 credits.

**5. Cleanup**
Remove the dead `parseFootnotes` helper (multi-footnote parsing that is no longer reachable).

Repeat-citation rules, the review/approve phases, bibliography sync, and the publication-integrity card stay exactly as they are.

## Validation

Run a 6-row batch mixing: a verified source already in the store, a pinpoint reference, a published judgment, a bare docket, a book with an editor, and a Knesset decision. Expect: verified row filled from store with no charge, no throttling failures, every incomplete row carrying a specific missing-field warning, and the same output as running each one through אזכור אחיד individually.

## Technical notes

- New: `src/lib/runCitation.ts` (shared pipeline), `src/lib/concurrency.ts` (small bounded-parallel helper).
- Edited: `src/components/BatchFootnoteBuilder.tsx` (uses shared pipeline + queue + per-row errors), `src/pages/Index.tsx` (delegates to the shared pipeline), `src/components/FootnoteReviewCard.tsx` (per-row error + retry).
- No backend changes: `citation-chat` and its rules stay untouched.
