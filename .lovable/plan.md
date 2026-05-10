**Plan**

I found the previous client-side guard is present, but the current symptom still points to the academic submit flow being too dependent on the hidden `question` textarea state.

**What I will change**

1. **Make academic generated chapters independent of the question box**
   - For `write_conclusion`, `write_introduction`, and abstract generation, compute the request question from the saved `researchQuestion`, not from the visible textarea.
   - Keep the textarea requirement only for the early steps where the user actually types text: topic suggestions, question validation, and outline creation.

2. **Add a specific conclusion preflight check**
   - Before sending `write_conclusion`, verify there are completed body chapters.
   - If none are available, show a clear Hebrew message explaining that the conclusion can only be written after body chapters exist.

3. **Stop treating intro/conclusion like Deep streamed chapter writes**
   - Keep body chapter writing as the streamed Deep flow.
   - Send intro/conclusion/abstract as normal synthesis requests, because the backend already routes them through the light paper-level synthesis path.
   - This reduces the chance of UI waiting/parsing issues and matches the intended behavior.

4. **Preserve the intended logic**
   - The conclusion will synthesize the written body chapters.
   - The introduction will be written after the conclusion and can use the conclusion draft.
   - No backend prompt, billing, styling, or wizard-order changes unless the inspected failure requires a very small defensive backend check.