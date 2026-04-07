

# Update App Icon + Visual Upgrade Suggestions

## Current State
- Favicon: `public/relex-icon.svg` (teal chat bubble)
- Word Add-in: `public/relex-icon.png` (same bubble)
- Uploaded image: R¹ with a teal curved arrow — clean concept but could be refined

## Plan

### 1. Copy uploaded image as the new icon
- Copy `user-uploads://image-4.png` to `public/relex-icon.png` (replaces current)
- Update `index.html` favicon link from SVG to PNG: `<link rel="icon" type="image/png" href="/relex-icon.png">`
- Delete `public/favicon.ico` to prevent browser override
- The Word add-in manifest already points to `relex-icon.png`, so no manifest change needed

### 2. Generate a refined SVG version using AI image generation
Create an upgraded version with these improvements:
- **Flatten the 3D effect** — the current icon has a glossy/3D look that feels dated; a flat design matches the app's modern geometric aesthetic
- **Match brand colors exactly** — use the app's teal (#36b7ad) for the arrow and blue (#3ea3d3) for the "R", instead of the current lighter/off-brand tones
- **Clean up the superscript "1"** — make it lighter weight, matching the app's Heebo/Inter typography style
- **Add subtle geometric accent** — a thin geometric border or rounded-square background in line with the app's glassmorphism theme
- **Remove the white/gray background** — make it transparent for versatility

I'll generate a refined version using AI image generation, save it alongside the original, and let you compare before replacing.

### 3. Update references
- Update `public/relex-icon.svg` with the refined version
- Update `ReLexIcon` component if needed

## Summary of changes
- `public/relex-icon.png` — replaced with uploaded image (immediate)
- `public/favicon.ico` — deleted
- `index.html` — favicon reference updated to PNG
- AI-generated refined icon — created for your review

