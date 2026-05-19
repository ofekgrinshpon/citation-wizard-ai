## Problem

In academic writing mode, the "העתק" button on the final paper (and on each chapter checkpoint when copying the whole paper) currently copies only chapter bodies. Footnotes are dropped because each `ChapterData` stores only `content` and `footnotesCount` — the actual `Footnote[]` array is never persisted per chapter, so `handleCopy` has nothing to append.

Body text still contains the superscript markers (¹²³…), but the citations themselves (the "הערות שוליים" list) are lost.

## Fix

Persist footnotes per chapter, then append a combined footnotes section to the clipboard payload.

### 1. `src/components/LegalQAChat.tsx` — `ChapterData` (≈line 140)

Add an optional field:
```ts
interface ChapterData {
  title: string;
  content: string | null;
  paperMemoryDelta?: unknown;
  footnotesCount?: number;
  footnotes?: Footnote[]; // NEW — saved per chapter for full-paper copy
}
```

No DB migration needed — `academic_sessions.chapters` is already stored as JSON.

### 2. Save footnotes when a chapter finishes (≈line 1681)

In the `updatedChapters[currentChapter] = { … }` block, also store:
```ts
footnotes: qaResult.footnotes ?? [],
```

### 3. Update `handleCopy` academic branch (≈line 2082)

Build the full paper as body + a single combined footnotes block. Backend already uses continuous global numbering, so we just concatenate each chapter's footnotes in display order (de-duped by `number` as a safety net):

```ts
if (taskMode === "academic_writing" && chapters.some(ch => ch.content)) {
  const written = chapters.filter(ch => ch.content);

  const bodyPlain = written
    .map(ch => `**${ch.title}**\n\n${ch.content}`)
    .join("\n\n---\n\n");

  // Combine footnotes across chapters (already globally numbered)
  const seen = new Set<number>();
  const allFootnotes: Footnote[] = [];
  for (const ch of written) {
    for (const fn of ch.footnotes ?? []) {
      if (seen.has(fn.number)) continue;
      seen.add(fn.number);
      allFootnotes.push(fn);
    }
  }
  allFootnotes.sort((a, b) => a.number - b.number);

  const footnotesPlain = allFootnotes.length
    ? `\n\nהערות שוליים:\n` + allFootnotes.map(f => `${f.number}. ${f.citation}`).join("\n")
    : "";

  const fullPaperPlain = bodyPlain + footnotesPlain;

  const bodyHtml = bodyPlain
    .replace(/^#{1,4}\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");

  const footnotesHtml = allFootnotes.length
    ? `<br><br><div style="font-size: 10pt;"><strong>הערות שוליים:</strong><br>` +
      allFootnotes.map(f => `<span>${f.number}. ${f.citation}</span>`).join("<br>") +
      `</div>`
    : "";

  const richHtml = `<div dir="rtl" style="font-family: ${DAVID_FONT}; font-size: 12pt; line-height: 2; text-align: justify; direction: rtl;">${bodyHtml}${footnotesHtml}</div>`;

  copyRichText(richHtml, fullPaperPlain);
  toast.success("העבודה הועתקה ללוח (כולל הערות שוליים)");
  return;
}
```

### 4. Backward compatibility

Sessions written before this change won't have `footnotes` saved on existing chapters. The copy will still work — they just won't include footnotes from those older chapters until they are rewritten. No migration step required.

## Out of scope

- No changes to the per-chapter checkpoint copy of a single chapter (it already goes through the regular `result.footnotes` branch).
- No changes to numbering, backend, or DB schema.
- No change to credit costs or generation logic.

## Verification

1. Run an academic paper with at least 2 chapters that produce footnotes.
2. Click "העתק את כל העבודה" on the done screen.
3. Paste into Word — body chapters appear with superscripts, and a single "הערות שוליים" list with continuous numbering appears at the end.
