

## The problem (confirmed by sampling DB)
After running recovery, of 6,164 Knesset docs:
- **288 "recovered"** — but most are garbage:
  - `after_kativa_header` (170 docs): grabs the line right after `כתיבה:` which is often a **Hebrew date** (`ט"ז אדר ב' תשע"ד`), masthead text (`לשונית עריכה : מערכת"הכנסת דברי"` — reversed RTL), or department name (`המחלקה לפיקוח תקציבי`).
  - `longest_top_candidate` (93 docs): grabs paragraph fragments (e.g. `התקציבי (לעומת חלופה של הפחתות תקציביות נוספות)...`).
  - **Years are reversed** in many: `0200`, `9102`, `4102`, `1122` — the year extractor sees the digits in visual (RTL-flipped) order.
  - **Authors keep role suffixes**: `תמיר אגמון, כלכלן`, `אילנית בר, כלכלנית`.
- **56 flagged broken**, **5,815 untouched** (recovery still mid-loop or stalled).
- Knesset HTML page is a **SPA** with no real title in source → external scraping not viable (matches existing constraint memory).

## Plan: Tighten extractor, roll back the bad batch, re-run cleanly

### Step 1 — Roll back the 288 + 56 bad batch
SQL `UPDATE` to reset all `recovered_title=true` and `broken_title=true` rows back to `title='פרטי מסמך'`, clear recovery metadata. (Same shape as the previous rollback migration.) Run via `insert tool` (data update, not schema).

### Step 2 — Harden `recover-knesset-titles/index.ts`

**A. Kill the date-as-title bug** (root cause of `after_kativa_header` garbage):
Add to `BOILERPLATE_PATTERNS`:
- Hebrew calendar dates: `^[יכלמנסעפצקרשתבגדהוזחט]['"״׳][א-ת]?\s+ב?(?:ניסן|אייר|סיון|סיוון|תמוז|אב|אלול|תשרי|חשון|חשוון|כסלו|טבת|שבט|אדר)(\s+[אב]['׳])?\s+ת?ש[א-ת]+`
- Pure date lines (already partially covered, expand to catch `ד 'בטבת תשס"ח` style with stray spaces)
- `^המחלקה\s+ל`
- `^הכנסת,?\s+מרכז\s+המחקר`
- `^לשונית\s+עריכה` and reversed `עריכה\s+לשונית`
- `^מערכת\s*["״]?דברי` 

**B. Fix reversed-year extraction**:
Current `extractYear` matches first 4-digit year. Problem: in the head text "0200", "9102" appear because RTL OCR reversed them.
- Validate year must be in `1990–2026`. If only reversed candidates exist (e.g., `0200`), try **reversing the digit string** and re-validate. If still invalid, drop the year (better no year than wrong year).
- Same for `extractDate`.

**C. Kill the paragraph-fragment bug** (`longest_top_candidate`):
- Reject any candidate line that ends with a comma, "של", "את", "של", "הוא", "היא", "ו", "ב", "ל", "מ" (mid-sentence cutoffs).
- Reject lines containing `:` mid-sentence (e.g., `גביית מחיר:`).
- Reject lines >120 chars (titles are rarely longer; current max 180 is too loose).
- Require lines to **start with a noun-likely word** — reject if starts with prepositions (`בישראל`, `התקציבי`, `מסמך זה`, `פגיעה`).

**D. Strip role suffixes from authors**:
- Extend `cleanAuthorName` regex to drop trailing `, כלכלן(ית)?`, `, חוקר(ת)?`, `, עובד(ת)?`, `, ראש\s+צוות`, `, מנהל(ת)?`, `, יועץ(ת)?` after the name.

**E. Stricter "valid title" gate before accepting**:
- Must be 8–120 chars
- Must contain ≥3 Hebrew words
- Must NOT match any boilerplate pattern (re-check after extraction)
- Must NOT be a Hebrew date
- If fails → flag `broken_title=true` instead of accepting

### Step 3 — Lower expectations: prefer "broken" over "wrong"
Change strategy ordering — drop `longest_top_candidate` entirely (it's the worst offender), keep only:
1. `after_section_label` (most reliable: 25 docs, low false-positive rate)
2. `after_kativa_header` (with the new boilerplate filters above)

If neither hits → flag `broken_title=true`. We'd rather have 1,000 valid titles + 5,000 filtered out than 6,000 with 90% garbage.

### Step 4 — Re-run the recovery loop
Click the existing admin "שחזור כותרות מסמכי הכנסת" button. With stricter rules, expect ~500–2,000 valid recoveries and the rest flagged broken (and thus filtered from `legal-qa` results).

### Step 5 — QA query
After re-run, sample 30 random recovered docs and check:
- No Hebrew dates as titles
- No reversed years
- No paragraph fragments
- Authors have no role suffixes
- All titles read like real document titles

### Out of scope
- External Knesset scraping (SPA, geo-blocked — confirmed unfeasible).
- Re-OCRing scrambled PDFs (separate, larger effort).
- Body text changes — only `title`, `citation`, `metadata`.

### Expected impact
- Garbage citations like `הכנסת, מרכז המחקר והמידע (הכנסת, מרכז מחקר ומידע 0200)` disappear.
- Footnote #12-style entries either show a real title with a real year, or don't appear at all (filtered as `broken_title`).
- Logs will show `Filtered N broken-title knesset docs from source pool` per query — quantifiable health metric.

