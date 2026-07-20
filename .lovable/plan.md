## Problem
When a user asks about a specific court case and uploads the full ruling as an attachment, the system still emits a `docket_anchored_judgment` required anchor and searches online for the judgment. If the online search fails, the drafter inserts a mandatory caveat: *“פסק הדין לא סופק / לא אותר.”* This happens even though the ruling is already present in the uploaded files.

## Goal
Allow a user-uploaded document to satisfy a docket anchor when its content matches the docket referenced in the query. Remove the false “ruling not provided” caveat in that case.

## Implementation

### 1. Docket-to-upload matching
- After attachments are extracted, scan the chunks of each `UserDocument`.
- If a chunk contains a string that matches any docket variant detected from the query (e.g., `3913/23`, `עה"ס 3913/23`, `Cohen v. Legal Advisor`), mark that document as a `docket_match` for that anchor.

### 2. Satisfy the required anchor from the upload
- In `requiredAnchors.ts`, allow anchor status to become `cited` (or a new `user_supplied` status) when at least one uploaded document chunk matches the docket and passes basic length/relevance checks.
- This is in addition to the existing rule that requires `metadata.docket_match === true` and direct/partial support from a web source.

### 3. Suppress the missing-judgment caveat
- In `drafterV2.ts`, only inject the Hebrew caveat *“לא אותר פסק הדין עצמו…”* when the docket anchor is **not** satisfied by either a web source or a user upload.

### 4. Preserve enough text from the ruling
- The current attachment limit is 12,000 chars per file. For a full court ruling this may truncate important sections.
- When a document is identified as a docket-matched judgment, raise its per-file extraction cap (or keep all chunks that contain the docket string) so the drafter can cite the actual holding.

## Validation
- Re-run the exact query with the three uploaded files.
- Confirm the disclaimer disappears.
- Confirm the critique references the uploaded ruling (e.g., cites paragraphs or legal tests from the file, not just general doctrine).
- Confirm unrelated docket queries still behave normally.

## Out of scope
- No changes to online retrieval.
- No verifier prompt changes.
- No footnote builder changes.
- No broad answer-quality or latency work.