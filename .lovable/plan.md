

## Tweak: Reset/Warn File Upload on Mode Change

### What happens now
When the user switches task mode, the uploaded file stays silently attached — even if it's irrelevant to the new mode (e.g., a pleading PDF stays when switching to "מחקר משפטי").

### Change

**`src/components/LegalQAChat.tsx`**

1. **Define file-relevant modes**: Mark which modes typically need a file upload — `pleading_analysis` and `case_summary` are file-relevant; `research` and `argument_draft` are not (though files can still be useful).

2. **Add mode-change handler**: Replace the inline `onValueChange` on the ToggleGroup (line 286) with a handler that:
   - Sets the new mode
   - If a file is currently uploaded AND the new mode is NOT file-relevant → show a toast warning: `"שימו לב: הקובץ שהועלה עדיין מצורף. ניתן להסיר אותו אם אינו רלוונטי למצב הנוכחי."` with an action button "הסר קובץ" that calls `removeFile()`.
   - Does NOT auto-remove the file (user might still want it).

3. **Visual indicator**: When a file is attached and the current mode is NOT file-relevant, add a subtle amber/warning border tint to the file upload zone (instead of the normal `border-primary/40`) to visually signal potential irrelevance.

### Files
- `src/components/LegalQAChat.tsx` — only file changed

### Why warn instead of auto-reset
Auto-removing a file the user just uploaded would be frustrating. A toast with a one-click remove action respects user intent while preventing accidental irrelevant context being sent to the AI.

