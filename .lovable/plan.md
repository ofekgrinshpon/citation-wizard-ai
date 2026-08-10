# Fix: unverified editor names in book citations (rule 23.7)

## What happened

For `יוסי יונה בזכות ההבדל: הפרויקט הרב-תרבותי בישראל` the system produced:

```text
יוסי יונה בזכות ההבדל: הפרויקט הרב-תרבותי בישראל (יהודה שנהב עורך 2005).
```

Catalog verification (Van Leer publication page, Kotar/CET record 93432610, Bookme) shows:

- The book is authored solely by **יוסי יונה**.
- **No editor credit** appears in any catalog record for this title.
- Publisher/year: מכון ון ליר + הקיבוץ המאוחד, 2005.
- יהודה שנהב is Yona's co-author on a *different* book (`רב־תרבותיות מהי?`) — the model conflated the two.

So `יהודה שנהב עורך` is a fabricated editor slot. Regarding שרה סורני: no source found links her to this title; if she appears in the printed colophon it would be a language/series editor, which rule 23.7 does not cite anyway. The correct citation is:

```text
יוסי יונה **בזכות ההבדל: הפרויקט הרב-תרבותי בישראל** (2005).
```

## Root cause

In `supabase/functions/citation-chat/index.ts`, the book branch cross-checks only the **author** (`authorAppearsInSources` + `verifyBiblioAuthor`, lines ~2914-2940). Every other model-supplied field — including `editor` — is emitted as-is whenever the title anchors, with no grounding check. A hallucinated co-author therefore slides into the editor slot unchallenged.

## Fix

1. **Editor grounding gate (book branch).** Before writing `עורך: ...` into the book hint, require that the editor name appears in the retrieved citations/search results *and* co-occurs with an editor marker (`עורך/עורכת/עורכים/עורכות`) in the same source snippet. If not grounded, clear `editor` and log `[book] editor_dropped`.
2. **Author-collision guard.** If the proposed editor name is a known co-author of the same author on another title, or the same source text lists that person as `מחבר`, never emit it as editor.
3. **Same gate for the article-in-book branch**, which shares the fabrication pattern for the `עורך` field.
4. **Hint wording.** When the editor is dropped or absent, the hint states explicitly that the citation must contain no editor segment (rather than `[חסר: עורך]`), since editor is optional under rule 23.7.
5. **Prompt note.** Add a short rule: a language editor / series editor (עורך לשון, עורך סדרה) is not cited under 23.7 — only the editor of an edited collection.

## Validation

- `יוסי יונה בזכות ההבדל...` → no editor segment, `(2005)`.
- `קתרין מקינון פמיניזם משפטי בתיאוריה ובפרקטיקה` → editor `דפנה ברק-ארז עורכת` is genuine and must survive the gate.
- `אורי אהרונסון, חוק הלאום בראי חוקי־היסוד האחרים` → editors still inside the parentheses (no regression to the 24.11 fix).
- One plain single-author book → unchanged.

## Technical notes

- Changes confined to `supabase/functions/citation-chat/index.ts` (book and article-in-book hint builders) plus a small shared helper next to `authorAppearsInSources`.
- No schema, UI, or shared-validator changes.
