
Goal: stop the endless “Word is still loading” loop in Word Online by switching from timeout-based guessing to capability-based insertion with a real fallback path.

What I found
- The UI now correctly unblocks after timeout, so the click is reaching `insertCitationAsFootnote`.
- The real blocker is still `src/lib/wordInsertion.ts`: both insertion paths ultimately depend on `Office.context.document`, but your latest errors show that in Word Online it never becomes available.
- `Word.run` is present only as a stub in this environment (`executeRichApiRequestAsync` missing), so the Rich API path is not usable there.
- The current fallback is therefore not a true fallback: it still requires `Office.context.document`, so it can never recover from this specific Word Online state.

Implementation plan

1. Replace “document-ready gating” with “try insertion strategies immediately”
- In `src/lib/wordInsertion.ts`, simplify `ensureOfficeReady` so it no longer spends most of its time polling for `Office.context.document`.
- Keep only a short `Office.onReady()` wait to let Office.js settle, then move straight into insertion attempts.
- Reason: readiness probes are not predicting reality in Word Online; the insertion function itself should decide what is usable.

2. Add explicit host capability detection
- Introduce a small helper that records:
  - whether Office exists
  - whether `Office.context.document` exists
  - whether `setSelectedDataAsync` exists
  - whether `Word.run` exists
  - whether the Rich API bridge is actually connected
- Use this for branching and for accurate error messages.
- Important: stop using “has host” as a decisive signal, because your failing state already proves host metadata can be falsey while add-in mode is real.

3. Split insertion into 3 clear strategies
- Strategy A: Rich API footnote insertion via `Word.run` only if an active probe succeeds.
- Strategy B: Common API text insertion via `Office.context.document.setSelectedDataAsync` if document APIs exist.
- Strategy C: graceful “manual copy” fallback when neither API is actually usable in Word Online.
- This means Word Online won’t hang on the same retry loop forever when the environment simply does not expose document APIs.

4. Add a copy-ready fallback result instead of a hard failure
- Change `insertCitationAsFootnote` to return a richer result, not just `"footnote"` or `"inline"`.
- Example shape:
```text
{ mode: "footnote" | "inline" | "manual-copy", text: "...optional plain text..." }
```
- If Word Online cannot expose any document API, return `manual-copy` with the cleaned citation text.
- This gives the app a usable escape hatch instead of repeating “wait a few seconds”.

5. Update batch insertion UX to handle partial success
- In `src/components/BatchFootnoteBuilder.tsx`, handle the new insertion result:
  - `footnote` → success toast
  - `inline` → success toast
  - `manual-copy` → copy the citation to clipboard and show a message like:
    “Word Online didn’t expose insertion APIs, so the citation was copied for manual paste.”
- For “Insert all”, continue processing remaining notes and summarize:
  - inserted as footnotes
  - inserted inline
  - copied for manual paste
  - failed

6. Update single-item insertion UX the same way
- In the single insert button flow, support the same 3 outcomes.
- This keeps behavior consistent between “Insert one” and “Insert all”.

7. Refine `useOffice` so it only controls UI affordance, not truth of insertion
- Keep `isOfficeAddin` for showing Word-specific buttons.
- Keep `hasDocumentAccess`, but treat it as “probably usable” rather than authoritative.
- Since Word Online is inconsistent here, do not let this state decide the final insertion possibility; only the insertion strategies should do that.
- Optionally rename this later to something like `canAttemptInsertion` to better match actual behavior.

Technical details
- Files to update:
  - `src/lib/wordInsertion.ts`
  - `src/components/BatchFootnoteBuilder.tsx`
  - possibly `src/components/MessageBubble.tsx` if any Word insertion remains there
  - optionally `src/hooks/useOffice.tsx` for naming/semantics cleanup
- Core design change:
```text
Before:
UI gate -> long readiness polling -> Word.run fails -> document missing -> user told to wait again

After:
UI gate -> short Office init wait -> try Rich API if bridge works
                                 -> else try Common API if document exists
                                 -> else return manual-copy fallback immediately
```
- This is the safest next step because your current evidence suggests the environment may never expose `Office.context.document` in this Word Online setup, so more waiting/retrying alone is unlikely to fix it.

QA to run after implementation
- Word Online:
  - “Insert all” no longer ends in the same repeated loading message.
  - If APIs are available, insertion works.
  - If APIs are unavailable, citations are copied and the user gets a clear fallback message.
- Word Desktop:
  - footnote insertion still uses the Rich API path.
- Regular web app:
  - no Word-specific regressions.
