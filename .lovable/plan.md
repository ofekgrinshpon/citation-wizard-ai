

## Fix: Broken cross-references after renumbering + wrong enrichment year

### Root causes

1. **Step 6b renumbers footnotes but never updates "לעיל ה"ש X" inside footnote text.** The AI writes "לעיל ה"ש 5" based on its original ordering. After renumbering, footnote 5 is a different source entirely. Same issue affects footnotes 1→2, 7→5, 10→7, 11→6, 12→8.

2. **Perplexity enrichment returns 2003 for volume 33.** The model keeps confusing volume numbers with years. Need stronger validation.

### Changes

**File: `supabase/functions/legal-qa/index.ts`**

**A. Update "לעיל ה"ש" references inside footnotes during renumbering (~after line 892)**

After building `reorderMap` (old→new number mapping), scan each footnote's citation text and replace "לעיל ה"ש [old]" with "לעיל ה"ש [new]":

```typescript
// Update cross-references inside footnote citations
for (const fn of reorderedFootnotes) {
  fn.citation = fn.citation.replace(
    /לעיל\s+ה"ש\s+(\d{1,2})/g, 
    (match, num) => {
      const oldNum = parseInt(num, 10);
      const newNum = reorderMap.get(oldNum);
      return newNum ? `לעיל ה"ש ${newNum}` : match;
    }
  );
}
```

**B. Post-processing: validate cross-references (~after Step 7, before final filter)**

After all renumbering is complete, validate each "לעיל ה"ש X" reference by checking if footnote X contains a plausibly matching source. If not, replace the short reference with the full citation text from the current footnote (strip the "לעיל" phrase and keep what remains, or expand from the source card):

```typescript
for (const fn of footnotes) {
  const refMatch = fn.citation.match(/לעיל\s+ה"ש\s+(\d{1,2})/);
  if (refMatch) {
    const targetNum = parseInt(refMatch[1], 10);
    const targetFn = footnotes.find(f => f.number === targetNum);
    if (!targetFn) {
      // Target doesn't exist — remove the reference phrase
      fn.citation = fn.citation.replace(/,?\s*לעיל\s+ה"ש\s+\d{1,2}/, "").trim();
    }
    // Additional check: does this footnote's title appear in the target?
    // Extract the title/name portion before "לעיל"
    // If no match, remove the cross-reference
  }
}
```

**C. Validate Perplexity enrichment year (~line 341)**

Add a sanity check: if the returned year matches the volume number (e.g., year=2003 and volume contains "לג" = 33), reject the year as likely confused:

```typescript
if (yearMatch) {
  const enrichedYear = yearMatch[1];
  // Reject if year looks like it was confused with volume number
  const volNum = vName.match(/\d+/)?.[0];
  const yearLastTwo = enrichedYear.slice(-2);
  if (volNum && (yearLastTwo === volNum || `20${volNum}` === enrichedYear || `19${volNum}` === enrichedYear)) {
    console.log(`Rejected suspicious year ${enrichedYear} (matches volume ${volNum})`);
  } else {
    article.metadata = { ...(article.metadata || {}), year: enrichedYear };
  }
}
```

### Technical details
- All changes in `supabase/functions/legal-qa/index.ts`
- Cross-reference update runs during the existing renumbering step
- Validation runs after renumbering as a safety net
- Year validation prevents volume/year confusion pattern
- Redeploy Edge Function `legal-qa`

