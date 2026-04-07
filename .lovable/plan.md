

# Add "איך זה עובד?" label above the scroll arrow

## Change

**`src/pages/Landing.tsx`** — Update the scroll button at the bottom of the hero section to include a text label above the chevron arrow:

```tsx
<button onClick={scrollToHow} className="absolute bottom-16 md:bottom-8 flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors animate-bounce z-10" aria-label="גלילה למטה">
  <span className="text-sm font-medium">איך זה עובד?</span>
  <ChevronDown className="w-8 h-8" />
</button>
```

Single file, single edit — adds the Hebrew label "איך זה עובד?" directly above the existing bouncing arrow.

