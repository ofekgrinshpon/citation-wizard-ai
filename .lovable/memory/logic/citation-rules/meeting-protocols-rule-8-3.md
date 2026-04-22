---
name: Meeting Protocols Rule 8.3
description: Knesset / committee / government meeting protocols must follow Uniform Rule 8.3 — never "פורסם באתר הכנסת" (Rule 34.2 fallback)
type: feature
---

# Rule 8.3 — Meeting Protocols (פרוטוקולי ישיבה)

## Format
```
פרוטוקול ישיבה [מספר ישיבה אם קיים] של [גוף מתכנס][, עמוד] ([תאריך לועזי DD.MM.YYYY]).
```

## Canonical Examples
- `פרוטוקול ישיבה 15 של הכנסת ה-23, 7–9 (21.4.2020).`
- `פרוטוקול ישיבה 110 של ועדת החוקה, חוק ומשפט, הכנסת ה-14 (3.11.1997).`
- `פרוטוקול ישיבה מכ/התשמ"ה של הממשלה ה-21 (30.6.1985).`
- `פרוטוקול ישיבה של ועדת השרים לעניני חוץ ובטחון, הממשלה ה-4, 9 (16.6.1953).`

## URL detection
Any URL matching `fs\.knesset\.gov\.il/(\d+)/(?:Committees|Plenum)/` is a meeting protocol — the first capture group is the Knesset number.

## Mandatory rules
- **Always** include the Knesset / Government number, even for committees ("ועדת הכלכלה" alone is invalid → must be "ועדת הכלכלה, הכנסת ה-N").
- If meeting number is unknown — **omit** entirely. Never write `[חסר: מספר ישיבה]`.
- A protocol has no author — never `[חסר: שם מומחה]` / `[חסר: שם מחבר]`.
- **Never** use `(פורסם באתר הכנסת, [date]) [URL]` — that is a Rule 34.2 fallback and is forbidden for protocols.
- If body/date/committee can't be determined — drop the citation entirely.

## חלוקת אחריות בקוד (in `supabase/functions/legal-qa/index.ts`)

Three layers, clearly separated:

1. **AI (creation)** — Produces Rule 8.3 format based on:
   - Prompt block (`**פרוטוקולי ישיבה (כלל 8.3)**`, after the Rule 34.2 line).
   - Source-card hint (`KNESSET_PROTOCOL_RE` injection): `[פרוטוקול ישיבה — עצב לפי כלל 8.3: הכנסת ה-N; ...] {url}`.
   - `meeting_protocol` entry in `citationRules.ts` (Rule 8.3 with full template, examples, prohibitions).

2. **Auto-validator (cleanup ONLY)** — `Rule 8.3 protocol cleanup` block. Strips invalid patterns:
   - `KNESSET_PUB_RE` → removes `(פורסם באתר כנסת, ...)`
   - `MISSING_MEETING_NUM_RE` → removes `[חסר: מספר ישיבה]`
   - `PROTOCOL_AUTHOR_RE` → removes leading `[חסר: שם מומחה/מחבר]`
   - **Does NOT synthesize** Rule 8.3 format. Does not "rescue" a broken citation.

3. **Filters (final decision)** — If after cleanup the citation is empty, too short, or non-substantive: existing `url_only` / `too_short` / `placeholder_dominant` / `broken_title` (newly added) drop it.

## Logging
- `Rule 8.3 cleanup FN #N: "before" → "after"` — appears when validator strips patterns.
- `Dropped footnote #N [reason, anchored=bool, has_marker=bool]` — appears when filter pipeline drops post-cleanup.
