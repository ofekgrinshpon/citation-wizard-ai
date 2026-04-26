## Fix WhatsApp link-preview: use white-background square thumbnail

The WhatsApp preview shows the logo on a transparent (checkered) background because WhatsApp/iMessage prefer the small square `apple-touch-icon.png` for chat thumbnails — and our current `apple-touch-icon.png` is transparent (RGBA). The wide social card (`relex-social-card.png`) already has a white background and stays as-is for Twitter/Facebook large-card previews.

### Changes

1. **Generate a new white-background square `apple-touch-icon.png`** (180×180)
   - Take the existing transparent ReLex chat-bubble icon and composite it onto a solid white background with comfortable padding (~12% margin around the glyph).
   - Save as opaque RGB PNG (no alpha channel) at `public/apple-touch-icon.png` (overwriting the transparent one).
   - This is the file WhatsApp, iMessage, Slack, and Telegram pick up for square chat thumbnails.

2. **Add a dedicated WhatsApp/square OG image** as a second `og:image` tag
   - Generate `public/relex-og-square.png` (1024×1024, white background, centered ReLex wordmark + chat-bubble glyph).
   - In `index.html`, add a second `<meta property="og:image">` pointing to the square version, listed *after* the wide card so platforms that prefer square get one and platforms that prefer wide still get the wide card. WhatsApp specifically tends to pick the last suitable square image.
   ```html
   <meta property="og:image" content="https://relexlm.com/relex-og-square.png" />
   <meta property="og:image:width" content="1024" />
   <meta property="og:image:height" content="1024" />
   ```

3. **Keep favicons unchanged**
   - `favicon-16x16.png`, `favicon-32x32.png`, `favicon.ico`, and `relex-icon.svg` stay transparent — that's correct for browser tabs (which sit on light or dark UI).
   - Only the social/share-preview images get the white background.

### Notes

- Hard refresh and re-share the link after deploy. WhatsApp aggressively caches link previews; testing with a fresh URL parameter (e.g. `relexlm.com/?v=2`) is the easiest way to force a re-fetch.
- Since `og:image` URLs are absolute (`https://relexlm.com/...`), the new square image only takes effect on the **published** site, not the preview URL.
