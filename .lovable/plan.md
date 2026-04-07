

# Integrate Legal QA as a Mode in the Main Page

## What Changes
Instead of navigating to a separate full-screen `/legal-qa` page, the "שאלה משפטית" feature becomes a fourth mode inside the existing Index page — just like "טקסט חופשי", "הערות שוליים", and "ביבליוגרפיה". The chat-like input/output layout mirrors the freetext section.

## Changes

### 1. `src/pages/Index.tsx`
- Add `"legalqa"` to the `AppMode` type union
- Add it to the `MODES` array: `{ id: "legalqa", label: "שאלה משפטית", icon: "⚖️" }`
- Remove the separate navigate button for legal-qa from the tab bar
- In the main content area, add a `mode === "legalqa"` branch that renders an inline Legal QA chat component
- The Legal QA section will have:
  - A disclaimer alert at the top (compact)
  - A scrollable area showing the answer result (David font, 12pt, justified) with footnotes — same as current LegalQA page output
  - A bottom input bar with textarea + send button, matching the freetext input bar style
  - State: `legalQAQuestion`, `legalQAResult`, `legalQALoading`

### 2. `src/pages/LegalQA.tsx`
- Keep the file but it will no longer be the primary entry point; the logic moves inline or into a reusable component

### 3. `src/components/LegalQAChat.tsx` (new)
- Extract the Legal QA logic (question submission, result display, footnotes) into a standalone component
- Props: none (self-contained, uses `useAuth` and supabase internally)
- Layout: scrollable content area + sticky bottom input bar, same structure as freetext mode
- Includes: disclaimer, answer with David font rendering, footnotes section, copy button

### 4. `src/App.tsx`
- Keep the `/legal-qa` route as a fallback/redirect, or remove it

## Result
Users switch to "שאלה משפטית" via the same tab bar and stay on the same page with sidebar and citation history visible, matching the compact chat layout of the freetext mode.

