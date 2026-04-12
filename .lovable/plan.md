

## "העוזר המשפטי" (V2) — Major Component Overhaul

This is a significant transformation of the Legal QA module into a professional legal workspace that serves as the primary view after login.

### Overview

Rename "שאלה משפטית" to "העוזר המשפטי", make it the default/first tab, redesign the output from chat-style to a structured legal memo format, add file upload support (PDF/DOCX) for document-grounded Q&A, and add a task mode selector.

---

### 1. Make "העוזר המשפטי" the default first tab

**File: `src/pages/Index.tsx`**
- Change the default `mode` state from `"freetext"` to `"legalqa"`
- Reorder the `MODES` array so `legalqa` is first:
  ```
  [העוזר המשפטי ⚖️] [טקסט חופשי ✨] [הערות שוליים 📑] [ביבליוגרפיה 📚]
  ```
- Rename the label from "שאלה משפטית" to "העוזר המשפטי"

### 2. Redesign LegalQAChat to "Professional Workspace" style

**File: `src/components/LegalQAChat.tsx`** — Major rewrite

**Layout changes:**
- Replace the chat-style input bar with a professional query panel at the top
- Add a "Task Mode" selector (toggle group) above the input: `[מחקר משפטי, ניתוח כתב טענה, סיכום פסיקה, ניסוח טיעון]`
- Add a file upload dropzone (PDF/DOCX) next to the textarea input
- Results render as a structured legal memo, not chat bubbles

**Memo output structure:**
- Results displayed in a clean Card with David font
- AI must generate structured sections with headings: **תקציר**, **מסגרת נורמטיבית**, **ניתוח מפורט**, **המלצות מעשיות**
- Footnotes section at the bottom with provenance badges (local vs web)
- Copy and clear buttons in a toolbar above the result

**File upload component:**
- Drag-and-drop zone or click-to-upload for PDF/DOCX files (max 20MB)
- When a file is uploaded, extract text client-side (pdfjs-dist for PDF, or send DOCX to convert-doc edge function) and send it alongside the question
- Visual indicator showing the uploaded file name with a remove button

### 3. Update the `legal-qa` edge function

**File: `supabase/functions/legal-qa/index.ts`**

**New request body:**
```typescript
{ question: string, taskMode?: string, documentText?: string, documentName?: string }
```

**Changes to the system prompt:**
- Add task-mode-specific instructions (e.g., "מחקר משפטי" generates comprehensive research memos; "סיכום פסיקה" focuses on case analysis)
- When `documentText` is provided, inject it as primary context with the label "[מתוך הקובץ שהועלה]" and instruct the AI to ground answers in the uploaded document while cross-referencing with the internal DB
- When no document is uploaded, the existing General Research Mode (internal DB + Perplexity) remains unchanged
- Enforce structured output with sections: תקציר, מסגרת נורמטיבית, ניתוח מפורט, המלצות מעשיות
- Add the `taskMode` to the tool schema output so the AI adapts its response structure

**Source hierarchy enforcement in prompt:**
1. Primary: Internal Database (local matches)
2. Secondary: Perplexity/Scholar for web verification
3. Contextual: Uploaded documents — footnotes from uploaded files labeled `[מתוך הקובץ שהועלה]`

### 4. Storage bucket for uploaded documents

**Database migration:**
- Create a `user-documents` storage bucket (private) for uploaded files
- Add RLS policies so authenticated users can upload/read their own files

### 5. Visual & UX details

- Maintain the existing ReLex minimalist blue/gray palette
- RTL throughout
- Task mode selector uses the existing ToggleGroup component
- File upload uses a dashed-border dropzone with an upload icon
- Empty state shows the ⚖️ icon with "העוזר המשפטי" title and task mode descriptions
- Loading state shows skeleton with section headers

---

### Files changed
- `src/pages/Index.tsx` — reorder tabs, rename, default to legalqa
- `src/components/LegalQAChat.tsx` — major rewrite (workspace layout, file upload, task modes, memo output)
- `supabase/functions/legal-qa/index.ts` — accept documentText/taskMode, structured memo prompt, document-grounded mode
- New migration — create `user-documents` storage bucket with RLS

### Technical notes
- PDF text extraction uses existing `pdfjs-dist` dependency (already in project)
- DOCX text extraction uses the existing `convert-doc` edge function or client-side fflate
- Document text is truncated to ~30,000 chars before sending to the edge function to stay within token limits
- The task mode is passed as a string parameter and shapes the system prompt sections

