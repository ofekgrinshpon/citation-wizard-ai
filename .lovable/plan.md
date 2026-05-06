## Goal
Two changes:
1. Make caselaw detection recognize **all** Israeli court procedural prefixes from the BIU "קיצורים של סוגי הליכים" annex (sourced from the Uniform Citation Rules), not just the 13 prefixes hard-coded today.
2. Loosen the parties-fallback regex to also match a bare `נ` between two Hebrew names (currently requires `נגד` or `נ'`/`נ״`).

Both fix the case where the user typed `סע״ש קמיקר נ מדינת ישראל ורשות האוכלוסין וההגירה` and the takdin-lite caselaw branch silently never fired.

## Changes

### 1. New shared file: `supabase/functions/_shared/caseTypePrefixes.ts`
Centralizes the prefix dictionary so every edge function can import the same source of truth.

```ts
// Source: https://law.biu.ac.il/sites/law/files/shared/qytsvrym_shl_svgy_hlykym.pdf
export const CASE_TYPE_PREFIXES: readonly string[] = [
  // 4-letter
  'דנג"ץ', 'בשג"ץ', 'תהוצל"פ', 'ענמ"ש', 'עבמ"ץ', 'עחה"ס',
  // 3-letter (selected — covers all common labor/family/admin/criminal/civil)
  'בג"ץ','בד"א','בד"ם','בה"נ','בע"ם','בפ"מ','בפ"ת',
  'בר"ם','בר"ע','בר"ש','בש"א','בש"ם','בש"פ','בש"ע',
  'דב"ע','דנ"א','דנ"מ','דנ"פ',
  'הפ"ב','מק"מ',
  'סב"א','סק"ב','סע"ש','תע"א',
  'עא"ח','עב"ל','עד"י','עד"מ','על"ע',
  'עמ"ה','עמ"ח','עמ"י','עמ"מ','עמ"נ','עמ"ק','עמ"ש',
  'עס"ק','עע"א','עע"ם','עע"מ',
  'עפ"א','עפ"ג','עפ"ס','עק"מ','עק"נ','עק"פ','ער"מ',
  'עש"א','עש"מ','עש"ר','עש"ת',
  'עת"א','עת"מ','פל"ע','פש"ר',
  'רמ"ש','רע"א','רע"ב','רע"פ','רצ"פ','רת"ק',
  'תא"מ','תא"פ','תא"ק','תא"ר',
  'תב"כ','תב"מ','תב"ע','תב"ר',
  'תה"ג','תה"ס','תח"ח','תח"פ',
  'תי"א','תי"פ','תמ"ש','תפ"ח','תר"מ','תת"ח','תת"ע',
  'חס"מ','אפ"ח',
  // 2-letter
  'א"ב','א"צ','ב"ל','ב"ק','ב"ש','ג"ז','ד"ט','ד"מ','ד"נ',
  'ה"כ','ה"נ','ה"ע','ה"פ','ה"ת','ו"ע','ח"א','ח"ד','ח"ש','י"ס',
  'מ"א','מ"ח','מ"י','מ"מ','מ"ת','נ"ב','ס"ע','ס"ק',
  'ע"א','ע"ב','ע"ו','ע"מ','ע"פ','ע"ע','ע"ר','ע"ש',
  'פ"א','פ"ה','פ"מ','פ"פ','צ"ה','צ"ו','ק"ג','ק"פ','ר"ע',
  'ש"ע','ש"ש',
  'ת"א','ת"ד','ת"ט','ת"מ','ת"ע','ת"פ','ת"צ','ת"ק','ת"ת',
  // Apostrophe-suffix forms
  "ע'","אפ'","עז'","עב'","פל'","פר'","המ'","גזז'",
];

function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Sort longest-first so e.g. בר"ם beats ב"ר; expand " → ["״] and ' → ['׳]
// so the same dictionary accepts ASCII and Hebrew typographic forms.
export function buildPrefixAlternation(): string {
  const sorted = [...CASE_TYPE_PREFIXES].sort((a, b) => b.length - a.length);
  return sorted.map(p =>
    escapeRegex(p).replace(/"/g, '["״]').replace(/'/g, "['׳]")
  ).join("|");
}

export const CASE_DOCKET_RE = new RegExp(
  `(${buildPrefixAlternation()})\\s+([0-9]+[\\/\\-][0-9]+(?:[\\/\\-][0-9]+)?)`
);

export const CASE_TYPE_PREFIX_RE = new RegExp(`(?:${buildPrefixAlternation()})`);
```

### 2. `supabase/functions/citation-chat/index.ts`
- Import `CASE_DOCKET_RE`, `CASE_TYPE_PREFIX_RE` from the new shared file.
- Replace the hard-coded `caseNumberMatch` regex on line 816 with `userInput.match(CASE_DOCKET_RE)`.
- Replace `LEGAL_ABBR_RE_V` on line 13–14 with `CASE_TYPE_PREFIX_RE` so the input validator also accepts the full set.
- Loosen the party regex on line 825 to accept a **bare `נ`** as a separator (currently requires `נגד|נ'|נ׳|נ״`):
  ```ts
  /([\u0590-\u05FF\s'"״׳']+)\s+(?:נגד|נ['׳''\u2018\u2019\u05F3״]?)\s+([\u0590-\u05FF\s'"״׳']+)/
  ```
  i.e. make the gershayim/apostrophe **optional** after `נ` so a standalone `נ` still matches. Add a length guard so a single ambiguous letter mid-sentence doesn't trigger false positives — require both name groups to be ≥2 chars and contain at least one non-space.

### 3. `supabase/functions/_shared/citationResolver.ts`
The same hard-coded list in `compute_verified_source_identity` SQL function is fine (DB-level), but the Deno-side `partyLookup.ts` already supports an open `caseTypeHint`, no change needed.

Other functions that have similar regex (e.g. `case-law-search`, `bibliography-lookup`) accept the prefix from the client UI as a separate field — they don't parse it from free text — so no change needed there.

### 4. Memory
Add `mem://logic/case-type-prefix-dictionary` referencing the BIU PDF and the central file. Update `mem://index.md`.

## Out of scope
- No DB changes. The SQL `compute_verified_source_identity` regex still uses the older short list; that only affects identity-key bucketing for verified-source dedupe and is not on the user's query-detection path.
- No UI changes. The existing source-type dropdown is unaffected.

## Test
After deploy, repeat:
- `סע״ש קמיקר נ מדינת ישראל ורשות האוכלוסין וההגירה` → logs should now show `partyMatch=yes`, the takdin-lite-hinted Perplexity call fires, and the response contains correct party/court/date.
- `ע"א 158/77 רבינאי` → `caseNumberMatch` still fires (regression check).
- `תמ"ש 12345-01-20` → newly detected.
