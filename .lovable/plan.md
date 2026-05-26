## Goal
In the legal research loading state, replace the two stacked ghost cards (answer + footnotes) with a single ghost card whose blurred lines appear progressively over time, giving the impression that text is being "written in real time."

## File
`src/components/LegalResearchV1Panel.tsx` — only the `GhostAnswer` component (~lines 666–693) and its usage at line 427.

## Changes

### 1. Single card, progressive reveal
Rewrite `GhostAnswer` so it renders one card with:
- A small title bar (blurred).
- A list of ~10 blurred lines of varied widths.
- An internal `useState` counter (`visibleCount`) that increments via `setInterval` every ~600–900ms (slight jitter for natural feel), capped at the total number of lines.
- Each newly revealed line uses a short fade/slide-in (existing `animate-fade-in` utility) so it visibly appears rather than just popping.
- When all lines are revealed, restart from a smaller subset (e.g., wrap-around or just stop and keep gently pulsing) so a long-running job still feels alive. Decision: stop adding lines once full, but keep the existing `animate-pulse` shimmer on all rendered lines.
- Cleanup the interval on unmount.

### 2. Remove the second card
Delete the footnotes ghost card block. Only the single answer card remains under the progress checklist.

### 3. Visual polish (kept minimal)
- Keep current blur/`bg-muted`/rounded styling so it matches the rest of the UI.
- RTL-safe: widths via Tailwind `w-*` classes already work in RTL.
- `aria-hidden` retained.

## Out of scope
- No changes to the progress checklist, timing copy, cancel button, or any pipeline/backend logic.
- No new dependencies; pure React state + Tailwind.

## Acceptance
- Only one ghost card is visible during loading.
- Lines appear one-by-one over time (not all at once), looking like text being written.
- No console errors; interval is cleared on unmount.
- Existing loading checklist, elapsed timer, and cancel button are unchanged.
