---
name: Legal QA Anchored Partial Citations
description: Footnote retention rules — anchored sources keep partial citations with [חסר: שדה] markers; unanchored notes with markers are dropped via placeholder_dominant
type: feature
---

In `supabase/functions/legal-qa/index.ts`, the post-processing footnote filter uses `hasAnchor(fn)` to decide whether to retain partial citations:

- **Anchor proof** = `fn.url` present, OR `fn.source` is a real provenance string (`"local"`, `"perplexity"`, verified-source provenance). The literal value `"unverified"` is NOT an anchor.
- The `[חסר: שדה]` marker is **never** an anchor on its own — the AI cannot bypass the filter by sprinkling markers without a real source behind them.

**Filter thresholds (`reasonFor`):**
- `url_only` — hard fail always
- `placeholder_dominant` — **NEW**: unanchored + contains `[חסר: ...]` marker → drop (regardless of length). Catches AI-fabricated skeletons like `פס"ד שפירא [חסר: מספר תיק] [חסר: פרטי פרסום]`.
- Anchored: `min length 12`, `missing_parties` allowed (partial citation with markers permitted)
- Non-anchored: `min length 25`, `missing_parties` rejected

**Preserved markers:** The placeholder cleanup regex (`/\[missing:...\]|\[פרט חסר...\]/g`) intentionally does NOT strip `[חסר: ...]` — it's part of the intended UI rendering (`MessageBubble` styles them) for *anchored* notes that survive the filter.

**Orphan superscript cleanup:** After renumbering, any superscript `¹²³` in the body that doesn't map to a valid footnote number is stripped, plus stray space-before-punctuation cleanup.

**Prompt reinforcement (~line 1771):** Explicit rule forbids generating any footnote without a real anchor, and clarifies that `[חסר: ...]` is not a "cover" for absent sources — only a partial-field marker on top of a real source.

**Logging:** `Dropped footnote #N [reason, anchored=bool, has_marker=bool]` exposes attempted bypass cases including `placeholder_dominant`.
