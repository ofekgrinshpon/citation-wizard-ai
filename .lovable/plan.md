## Problem

Clicking a history item crashes with `Cannot read properties of undefined (reading 'split')` at `RenderBold` (`src/components/LegalQAChat.tsx:453`). Old `qa_logs.footnotes` rows contain entries where `citation` is `undefined`/missing, and `RenderBold` is called with `fn.citation` (lines 2838, 3088). `text.split(...)` then throws and the ErrorBoundary takes over.

## Fix (UI only, no backend changes)

**`src/components/LegalQAChat.tsx`**

1. **Harden `RenderBold`** (~line 452): coerce `text` to string and bail on empty:
   ```ts
   function RenderBold({ text }: { text?: string | null }) {
     const safe = typeof text === "string" ? text : "";
     const parts = safe.split(/\*\*(.*?)\*\*/g);
     ...
   }
   ```
   Also harden `RenderMarkdown` / `RenderMarkdownLine` the same way (any `.split("\n")` on `text`/`line`).

2. **Sanitize footnotes when loading history** — in `QAHistorySidebar.handleClick` (`src/components/QAHistorySidebar.tsx`, ~line 108), map array footnotes to ensure each item has string `citation`, numeric `number`, and string `source_type`:
   ```ts
   footnotes: Array.isArray(fn)
     ? fn.map((f: any, i: number) => ({
         number: typeof f?.number === "number" ? f.number : i + 1,
         citation: typeof f?.citation === "string" ? f.citation : "",
         source_type: typeof f?.source_type === "string" ? f.source_type : "unknown",
         url: typeof f?.url === "string" ? f.url : undefined,
         source: f?.source,
       }))
     : [],
   ```

## Out of scope
- Trash-can behavior, Enter-to-send, and any other unrelated UI work.
- Backfilling old `qa_logs` rows.
