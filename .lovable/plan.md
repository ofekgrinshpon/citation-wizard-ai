## Make cited sources clickable to their PDF/source link

Each footnote in the QA result already carries a `url` field (populated from local DB hits, Perplexity citations, and uploaded documents). Today the footnote list just renders the citation text — the URL is invisible. We'll surface it as a click target so the user can jump straight to the PDF / source page.

### Scope (frontend only)

1. **Footnotes list in `LegalQAChat.tsx`** (around line 2989)
   - When `fn.url` exists, wrap the citation text in an `<a target="_blank" rel="noopener noreferrer">` with a subtle underline + hover color (use `text-primary hover:underline`).
   - Append a small external-link icon (`ExternalLink` from lucide) after the citation so it's visually obvious the row is clickable.
   - When no `url`, render as today (plain text).
   - Tooltip on hover shows the hostname (e.g. `nevo.co.il`, `supremedecisions.court.gov.il`).

2. **Inline superscripts in the answer body**
   - The superscript numbers (¹²³) currently scroll to the footnote via `legalqa-footnote-{n}` anchor. Keep that behavior on plain click.
   - Add **Ctrl/Cmd-click** (or a small ↗ affordance in the footnote row) to open the URL directly. Keeping the default click as "scroll to footnote" preserves the current UX; the link lives in the footnote row itself.

3. **Citation review mini-cards** (`CitationReviewCard.tsx`)
   - Already receives `url`. Add the same external-link chip there so the user can verify the source while reviewing.

4. **Copy-to-Word / rich text export**
   - In `copyContent` and the academic export paths, wrap the citation in an `<a href="...">` inside the HTML payload so Word preserves the hyperlink when pasted. Plain-text copy stays unchanged (URL is not appended to avoid polluting Bluebook formatting).

### Out of scope

- No backend changes. We rely on the `url` already attached to each footnote.
- No change to citation text formatting (Uniform Citation Rules unchanged — the URL is metadata, not part of the citation string).
- Historical answers stored in `qa_logs` that lack `url` simply stay non-clickable.

### Files to edit

- `src/components/LegalQAChat.tsx` — footnote `<li>` renderer + rich-text export
- `src/components/legal-qa/CitationReviewCard.tsx` — add link chip
- (optional) `src/components/FootnotesSection.tsx` if it's reused elsewhere

### Validation

- Run a Deep query that returns a mix of local DB sources (with `url`) and Perplexity sources; confirm clickable footnotes open the correct PDF/landing page in a new tab.
- Confirm footnotes without a `url` still render as plain text (no broken `<a>`).
- Copy the answer to Word; confirm the hyperlink is preserved on paste.
