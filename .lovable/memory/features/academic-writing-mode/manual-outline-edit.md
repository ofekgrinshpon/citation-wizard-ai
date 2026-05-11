---
name: Manual Outline Edit
description: User can rename/reorder/add/delete body chapters before approving the outline
type: feature
---

After `propose_outline` returns, `OutlineReport` shows three CTAs: **אשר מתווה והתחל כתיבה**, **ערוך רשימת פרקים**, **חזרה לעריכה**.

The editor (`OutlineChapterEditor`) operates only on body-chapter titles parsed from the outline. Special chapters (תקציר / מבוא / סיכום ומסקנות) are **not** editable — they are always force-injected by `approveOutline()` in the canonical display order.

`approveOutline(editedBodyTitles?: string[])` accepts an optional edited list. When provided, it skips the regex parse and uses the user's titles directly, still filtering out any names that resolve to a special chapter via `chapterRole()`.

No backend / DB changes. Edits live in React state until the user confirms; the canonical scaffold is then written to `chapters` exactly as before.
