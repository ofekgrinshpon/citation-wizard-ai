

# Update Apify Scraper Field Mappings

## Problem
The scraper code used guessed Hebrew labels (`שופט`, `שופטים`, `הרכב` as separate fallbacks). The screenshot confirms the actual label is **`שופט/הרכב:`** as a single combined label.

## Changes to Apify `src/main.js`

Update the metadata field extraction to match the **exact** labels from the gov.il page:

| Field | Correct Label | Current (wrong) |
|-------|--------------|-----------------|
| judges | `שופט/הרכב` | `שופט` / `שופטים` / `הרכב` (separate fallbacks) |
| case_number | `מספר תיק` | ✅ correct |
| court | `בתי משפט` | was `בית משפט` (singular) |
| decision_date | `מועד החלטה` | was `תאריך` |
| procedure_type | `סוג ההליך` | **new field** — not in original code |
| district | `מחוז` | **new field** — not in original code |

Also extract **both** download links (`.docx` summary + `.pdf` full decision) instead of just one `download_url`.

## Updated Scraper Snippet

The field-mapping object in the Cheerio crawler should be:

```text
Label → Field mapping:
"מספר תיק"    → case_number
"סוג ההליך"   → procedure_type  (NEW)
"שופט/הרכב"   → judges
"בתי משפט"    → court
"מחוז"        → district  (NEW)
"מועד החלטה"  → decision_date
```

For download links, extract all `<a>` elements with `.docx` and `.pdf` hrefs separately into `docx_url` and `pdf_url`.

## Impact on Database Migration (later)
When we run the migration to add columns to `legal_documents`, we should include `procedure_type` and `district` as additional nullable columns alongside the previously discussed fields.

## Summary
This is a correction to the Apify Actor code (external to this codebase). I'll provide the updated `src/main.js` with the corrected label mappings once you approve.

