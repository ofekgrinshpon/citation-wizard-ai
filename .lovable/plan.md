

## Goal
Remove the pink Lovable heart icon from the WhatsApp / iMessage / Slack link preview shown in your screenshot, and make sure every chat platform pulls the **ReLex R** icon instead.

---

## Root cause
`index.html` only declares an SVG favicon:
```html
<link rel="icon" type="image/svg+xml" href="/relex-icon.svg">
```
WhatsApp / iMessage / Slack don't read SVG favicons. They look for, in order:
1. `apple-touch-icon.png` (180×180)
2. `favicon.ico` / PNG `favicon`
3. Whatever the host serves as a default — which on `*.lovable.app` and through the Lovable proxy is the **Lovable pink heart**

You already have `public/relex-icon.png` (the square ReLex R). We just need to wire it up under the names link-unfurlers actually look for, plus add the explicit `<link>` tags so every crawler picks it up.

---

## Changes

### 1. `public/` — add icons under the names crawlers expect
Copy the existing `public/relex-icon.png` to:
- `public/apple-touch-icon.png` — what WhatsApp / iMessage / iOS use
- `public/favicon-32x32.png` — generic browser favicon
- `public/favicon-16x16.png` — small fallback
- `public/favicon.ico` — legacy fallback (some old crawlers refuse anything else)

(The actual content can be the same square ReLex `R` icon — what matters is the filename.)

### 2. `index.html` — declare them all explicitly
Add inside `<head>`, alongside the existing SVG icon:
```html
<link rel="icon" type="image/svg+xml" href="/relex-icon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="shortcut icon" href="/favicon.ico">
```

This guarantees WhatsApp, iMessage, Slack, Telegram, Twitter, LinkedIn, and Facebook all resolve to the ReLex icon — none of them will ever fall through to the host's default Lovable heart.

---

## Important: WhatsApp caches previews for ~7 days
The screenshot you sent shows the **cached** preview from before today's fixes. After we ship the icons, the same chat will keep showing the old card (with the heart) until the cache expires.

To force a fresh preview right now:
1. **Add a cache-buster to the link** when you share it next, e.g. `https://relexlm.com/?v=2` — WhatsApp treats this as a new URL and re-fetches metadata immediately.
2. **Or** wait ~7 days and re-share the plain URL.
3. For Twitter / LinkedIn / Facebook, you can force-refresh via:
   - Twitter: `https://cards-dev.twitter.com/validator`
   - LinkedIn: `https://www.linkedin.com/post-inspector/`
   - Facebook: `https://developers.facebook.com/tools/debug/`

Once cleared, every new share unfurls with the ReLex `R` icon and zero Lovable branding.

---

## Out of scope (already done in earlier turns)
- OG image, OG title, OG description → already ReLex
- Author / canonical URL → already ReLex
- Email branding → already ReLex via `notify.relexlm.com`

