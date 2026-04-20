

## Goal
Rename the "ניתוח כתב טענה" mode to **"מבקר מסמכים משפטיים"** and replace its AI prompt with the full Senior Legal Document Auditor protocol you provided.

## Scope decision
Keep the internal `taskMode` ID as `pleading_analysis` (don't rename to e.g. `document_audit`). Reasons:
- Avoids breaking historical `qa_logs` rows (sidebar, resume, search history would lose old entries otherwise).
- Avoids touching `Index.tsx` type unions, the `qaExternalResult` state, and academic-resume routing.
- Only labels and the prompt are user-visible.

## Changes

### 1. `src/components/LegalQAChat.tsx` (line 65)
Update the visible card for that mode:
- **label**: `"מבקר מסמכים משפטיים"`
- **description**: `"ביקורת משפטית: דיוק אזכורים, סתירות לוגיות, ניתוח אדוורסרי"`
- **placeholder**: `"הדביקו או העלו מסמך משפטי (כתב טענה, חוזה, חוות דעת) לביקורת מקיפה..."`
- Icon stays `FileSearch` (fits an auditor).

### 2. `src/components/QAHistorySidebar.tsx` (line 37)
Update history label: `pleading_analysis: { label: "ביקורת מסמך", icon: FileSearch }` (short form for the sidebar chip).

### 3. `supabase/functions/legal-qa/index.ts` (lines 212-219)
Replace the `pleading_analysis` case body with the full audit protocol, faithfully translated from your spec into Hebrew and adapted to fit the existing `legal-qa` architecture (which already injects `[Verified]` local DB sources and `[External]` Perplexity results into the context). Key adaptations:
- Keep the existing footnote/citation-rule contract from the surrounding system prompt — but instruct the auditor that the report itself uses the structured headings below, not the standard memo template.
- Honor the **functional source split** by referencing the existing `[Verified]` / `[External]` markers used elsewhere in the prompt.
- Enforce the 150-word minimum guard (refuse cleanly if input too short).

The new prompt will produce output structured as:
- **סיכום ביצועי** — 1–2 lines describing the document type and overall risk.
- **🔴 ממצאים קריטיים** (Protocol A citation-surgery errors, repealed statutes, fabricated section numbers, timeline contradictions, numerical mismatches) — formatted as `**בעיה:** … | **מיקום:** … | **תיקון מוצע:** …`
- **🟡 הערות והמלצות** (counter-arguments, weak evidence, non-uniform citations) — formatted as `**הצעה:** … | **נימוק:** …`
- **🟢 חוזקות אסטרטגיות**
- **טיעוני נגד צפויים** — at least 3 adversarial counter-arguments (Protocol C).
- **בדיקה פורמלית** — only when document is a pleading: ID numbers, addresses for service, jurisdictional statements, סעדים, exhibit tracking.

The prompt will explicitly state:
- `[Verified]` is the sole source of truth for substantive law; flag user claims that contradict it as Critical (🔴).
- `[External]` may be used only for bibliographic metadata.
- Never fabricate section numbers or years — use `[חסר]` and prompt the user.
- If document < 150 words, return one sentence requesting more context and stop.

### Out of scope
- DB / `qa_logs` schema (internal ID unchanged).
- `case_summary`, `research`, `academic_writing` modes.
- UI layout / icons beyond label text.

## Files touched
- `src/components/LegalQAChat.tsx`
- `src/components/QAHistorySidebar.tsx`
- `supabase/functions/legal-qa/index.ts` (+ redeploy)

## Expected outcome
The mode card now reads **"מבקר מסמכים משפטיים"**. Submitting a document runs the new audit protocol and returns a structured red/yellow/green findings report with adversarial counter-arguments, citation surgery, and timeline/numerical consistency checks — grounded strictly in `[Verified]` local sources for substantive content.

