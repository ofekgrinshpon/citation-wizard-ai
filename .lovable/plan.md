

# Clean SVG Favicon — Minimal R¹

## Changes

### 1. `public/relex-icon.svg`
Replace with a hand-crafted SVG: bold "R" in brand blue (#3ea3d3) with a small superscript "1" in teal (#36b7ad), on a transparent background. No arrows, no gradients — just clean typography optimized for 16×16 legibility.

### 2. `index.html`
Switch favicon back to SVG:
```html
<link rel="icon" type="image/svg+xml" href="/relex-icon.svg">
```

### 3. Keep `public/relex-icon.png`
The uploaded PNG stays for the Word add-in manifest (displayed at larger sizes where it looks fine).

