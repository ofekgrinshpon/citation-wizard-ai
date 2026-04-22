---
name: Legal QA Anchored Partial Citations
description: Footnote retention rules — anchored sources keep partial citations with [חסר: שדה] markers; the marker itself is NOT proof of an anchor
type: feature
---

In `supabase/functions/legal-qa/index.ts`, the post-processing footnote filter uses `hasAnchor(fn)` to decide whether to retain partial citations:

- **Anchor proof** = `fn.url` present, OR `fn.source` is a real provenance string (`"local"`, `"perplexity"`, verified-source provenance). The literal value `"unverified"` is NOT an anchor.
- The `[חסר: שדה]` marker is **never** an anchor on its own — the AI cannot bypass the filter by sprinkling markers without a real source behind them.

**Filter thresholds:**
- Anchored: `min length 12`, `missing_parties` allowed
- Non-anchored: `min length 25`, `missing_parties` rejected
- `url_only` is always a hard fail

**Preserved markers:** The placeholder cleanup regex (`/\[missing:...\]|\[פרט חסר...\]/g`) intentionally does NOT strip `[חסר: ...]` — it's part of the intended UI rendering (`MessageBubble` styles them).

**Orphan superscript cleanup:** After renumbering, any superscript `¹²³` in the body that doesn't map to a valid footnote number is stripped, plus stray space-before-punctuation cleanup.

**Logging:** `Dropped footnote #N [reason, anchored=bool, has_marker=bool]` exposes attempted bypass cases.
