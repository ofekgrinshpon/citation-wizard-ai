

## Add Stop/Cancel Button for Legal QA Queries

### Problem
Once a user submits a question in the Legal QA section, there's no way to cancel the in-progress request. The user must wait for the full response or reload the page.

### Solution
Add an `AbortController` to the edge function invocation, and show a "Stop" button while loading.

### Changes

**File: `src/pages/LegalQA.tsx`**

1. Add an `AbortController` ref:
   ```typescript
   const abortControllerRef = useRef<AbortController | null>(null);
   ```

2. In `handleSubmit`, create a new `AbortController` and pass its signal to `supabase.functions.invoke`:
   ```typescript
   const controller = new AbortController();
   abortControllerRef.current = controller;
   // ...
   const { data, error } = await supabase.functions.invoke("legal-qa", {
     body: { question: q },
   }, { signal: controller.signal }); // pass abort signal
   ```
   Note: If `supabase.functions.invoke` doesn't support a signal option directly, we'll use a raw `fetch` call to the edge function URL with the abort signal instead.

3. Add a `handleStop` function:
   ```typescript
   const handleStop = () => {
     abortControllerRef.current?.abort();
     setLoading(false);
     toast.info("העיבוד הופסק");
   };
   ```

4. In the catch block, detect abort errors and skip the error toast for them.

5. Replace the submit button with a stop button while loading:
   ```tsx
   {loading ? (
     <Button variant="destructive" onClick={handleStop} className="gap-2">
       <StopCircle className="w-4 h-4" />
       עצור
     </Button>
   ) : (
     <Button onClick={handleSubmit} disabled={question.trim().length < 5} className="gap-2">
       <Send className="w-4 h-4" />
       שאל שאלה משפטית
     </Button>
   )}
   ```

6. Import `StopCircle` from `lucide-react`.

### Files
- `src/pages/LegalQA.tsx` — add abort controller, stop button, and cancel handling

