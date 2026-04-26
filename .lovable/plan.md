## Replace favicons: chat-bubble glyph for small, full wordmark for large

Use the green chat-bubble glyph (cropped from the uploaded transparent ReLex logo) for the tiny favicon sizes where the wordmark would be unreadable, and use the full wordmark for the larger apple-touch icon and social card.

### Steps

1. Copy `user-uploads://relex_logo.png` → `/tmp/relex_logo.png` for processing with imagemagick (via `nix run nixpkgs#imagemagick`).
2. Crop the chat-bubble glyph (the green speech bubble) out of the source image into a square transparent PNG at `/tmp/relex_glyph.png`.
3. Generate transparent PNG favicons from the glyph:
   - `public/favicon-16x16.png` — 16×16
   - `public/favicon-32x32.png` — 32×32
   - `public/favicon.ico` — multi-size ICO (16/32/48) so legacy `/favicon.ico` requests also use the new glyph
4. Generate larger icons from the full wordmark (transparent, fit to square with transparent padding):
   - `public/apple-touch-icon.png` — 180×180
5. Leave `index.html` `<link rel="icon">` tags unchanged — they already reference the right filenames.

### Notes

- The current `public/relex-icon.svg` is also linked in `index.html` as the primary SVG icon; I'll leave it as-is unless you want me to swap that too.
- Browsers cache favicons aggressively — a hard refresh (Cmd/Ctrl+Shift+R) may be needed to see the change.
