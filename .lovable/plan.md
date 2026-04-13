

## Fix Textarea Not Using Full Width

### Problem
The textarea in "אזכור אחיד" wraps to the next line prematurely because it has `flex-1` in its class but its parent (`<div className="relative flex-1 min-w-0">`) is not a flex container — so `flex-1` has no effect and the textarea defaults to its intrinsic width.

### Fix
**`src/pages/Index.tsx` — line 1127**: Add `w-full` to the textarea's className:

```
className="w-full flex-1 bg-transparent border-none outline-none focus:outline-none focus:ring-0 px-2.5 sm:px-3.5 py-2.5 sm:py-3 text-foreground text-sm leading-relaxed font-sans resize-none"
```

One line change, one file.

