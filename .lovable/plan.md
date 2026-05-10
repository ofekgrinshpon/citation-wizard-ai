**Plan**

1. **Remove the generic typed-text toast from the academic submit path**
   - Keep typed-input validation on the visible topic/question buttons via their existing disabled states and step-specific checks.
   - Replace the remaining `toast.error("יש להזין טקסט.")` branch with step-specific messages only for early wizard actions, so a chapter action can never show that message again.

2. **Make “write current chapter” use a dedicated chapter dispatcher**
   - Add a small `getAcademicWriteStepForChapter(title, isAbstract)` helper.
   - `סיכום ומסקנות` will map directly to `write_conclusion`, independent of any stale UI state or input text.
   - The dispatcher will pass `chapterTitle`, `chapterIndex`, and the saved `researchQuestion` explicitly.

3. **Fix the likely stale-session cause**
   - When restoring an academic session, normalize legacy/saved chapter state so special chapters are recognized consistently (`תקציר`, `מבוא`, `סיכום ומסקנות`).
   - Clamp `currentChapter` to a valid index and, if it points to an invalid/empty legacy entry, land on the next writable chapter.

4. **Harden buttons against accidental submits**
   - Add `type="button"` to the chapter write button, wizard stepper buttons, outline approval buttons, and academic action buttons that currently rely on default button behavior.

5. **Validate the fix**
   - Search to confirm the exact toast no longer exists in a path reachable from `write_conclusion`.
   - Confirm the only possible conclusion-blocking message is: `ניתן לכתוב סיכום רק לאחר שנכתב לפחות פרק גוף אחד.`