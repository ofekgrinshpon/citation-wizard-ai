## WhatsApp link-preview: white-bg square thumbnail

WhatsApp/iMessage were showing the ReLex logo on a transparent (checkered) background because the chat-thumbnail picker prefers the small square `apple-touch-icon.png`, which was a transparent RGBA PNG.

### Changes

1. **Replaced `public/apple-touch-icon.png`** (180×180): re-rendered with a solid white background and the full ReLex wordmark + chat-bubble glyph (cropped tightly from `public/relex-logo.png`, ~8% margin), saved as opaque RGB PNG (no alpha).
2. **Added `public/relex-og-square.png`** (1024×1024): white-background square OG image for chat apps that prefer square previews.
3. **Updated `index.html`**: added a second `<meta property="og:image">` pointing to the new square image, listed *after* the wide social card so wide-card platforms (Twitter, Facebook) still pick the wide one and chat apps can grab the square.
4. Favicons (`favicon-16/32.png`, `favicon.ico`, `relex-icon.svg`) left untransparent — they sit on browser-chrome and need to blend with light/dark.

### Notes

- WhatsApp aggressively caches link previews. Forced re-fetch trick: share with `?v=2` appended, or use Facebook's Sharing Debugger / WhatsApp's chat-preview cache reset.
- Absolute `og:image` URLs only resolve on the published domain, not on the lovable preview URL.
