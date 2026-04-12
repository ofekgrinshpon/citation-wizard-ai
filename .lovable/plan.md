

## QA History Sidebar for העוזר המשפטי

### Problem
The citation history sidebar currently shows citation formatting history from `citation_history` table. The Legal QA section needs its own history showing past questions and answers.

### Current State
- `qa_logs` table exists but only stores questions + footnote counts, not answers
- No QA-specific history sidebar exists
- `LegalQAChat` component has no history display

### Plan

**1. Database Migration — Add answer storage to `qa_logs`**
- Add columns: `answer` (text), `footnotes` (jsonb), `task_mode` (text), `project_id` (uuid)
- Add RLS policy for users to read/insert their own rows

**2. Save QA results — `src/components/LegalQAChat.tsx`**
- After a successful response from the edge function, insert a row into `qa_logs` with question, answer, footnotes, task_mode, and user_id
- Requires importing `useAuth` and `useProjects` hooks

**3. New component — `src/components/QAHistorySidebar.tsx`**
- Similar structure to `CitationHistorySidebar` but queries `qa_logs`
- Shows question text (truncated), task mode badge, and timestamp
- Click to re-load a past result into the main view (sets `result` state)
- Search filter across questions
- Fetches last 30 entries, ordered by `created_at` desc

**4. Integrate into Index.tsx**
- When `mode === "legalqa"`, show `QAHistorySidebar` instead of `CitationHistorySidebar`
- Pass a callback to `LegalQAChat` so clicking a history item loads that result

### Files Changed
- `src/components/QAHistorySidebar.tsx` — new file
- `src/components/LegalQAChat.tsx` — save results to DB, accept `onLoadResult` prop
- `src/pages/Index.tsx` — swap sidebar when in legalqa mode
- Database migration — alter `qa_logs` table

