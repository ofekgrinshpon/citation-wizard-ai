## Restyle SVG favicon: neo-grotesque "R" + brand colors

Update `public/relex-icon.svg` to swap the serif Georgia "R" and "1" for a neo-grotesque sans-serif stack, and recolor them to match the app's wordmark blue + teal-green.

### Change

`public/relex-icon.svg`:
- Font: `Georgia, 'Times New Roman', serif` → `Inter, 'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif`
- "R" fill: `#3ea3d3` → `#1E9CE8` (wordmark blue)
- "1" fill: `#36b7ad` → `#2DBF9A` (chat-bubble teal-green)
- "1" weight bumped to `600` and nudged 2px right for better balance with the sans-serif "R"

### Notes

- Browsers cache SVG favicons too — hard refresh after deploy.
- This only touches the SVG favicon (referenced as the primary `<link rel="icon" type="image/svg+xml">` in `index.html`); the PNG/ICO favicons we already swapped to the chat-bubble glyph stay as-is.
