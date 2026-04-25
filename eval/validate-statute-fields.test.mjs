// Standalone test for validateStatuteFields (Stage 5e Fix F).
// Mirrors the Deno port; we re-implement here in plain JS to avoid a Deno
// runtime dependency so this can run with `node`.
//
// Keep in sync with supabase/functions/legal-qa/index.ts :: validateStatuteFields.

const CASE_TYPES = /(?:בג["״]ץ|ע["״]א|ע["״]פ|רע["״]א|רע["״]פ|דנ["״]א|דנ["״]פ|ת["״]א|ת["״]פ|תפ["״]ח|בש["״]פ|עע["״]מ|בר["״]ם|עמ["״]ה)/;
const CASE_DOCKET_RE = new RegExp(`${CASE_TYPES.source}\\s+\\d+\\/\\d+`);
const PLACEHOLDER_RE = /^(?:פרטי\s+מסמך|לא\s+נמצא|לא\s+ידוע|unknown|n\/?a|מסמך|—|-)\s*\.?$/i;
const ALLOWED_COLLECTIONS = new Set(['ס"ח', "ס״ח", 'ק"ת', "ק״ת", 'נ"ח', "נ״ח", 'ע"ר', "ע״ר"]);

function validateStatuteFields(f) {
  const lawName = (f.lawName || "").trim();
  const collection = (f.collection || "").trim();

  if (CASE_DOCKET_RE.test(lawName)) return "type_caselaw_in_lawname";
  if (/(?:^|\s)פסק\s+דין(?:\s|$)/.test(lawName) || /\sנ['׳]\s/.test(lawName)) {
    return "type_caselaw_prose_in_lawname";
  }

  if (PLACEHOLDER_RE.test(lawName)) return "placeholder_lawname";
  const stripped = lawName
    .replace(/^חוק[- ]יסוד\s*:\s*/, "")
    .replace(/^(?:חוק|פקודת|פקודה|תקנות|תקנה|צו|כללי)\s*/, "")
    .trim();
  if (!stripped || stripped.split(/\s+/).filter((t) => /[א-ת]/.test(t)).length < 1) {
    return "placeholder_bare_keyword";
  }

  if (!ALLOWED_COLLECTIONS.has(collection)) return "publication_bad_collection";
  const pageRaw = f.page;
  if (pageRaw === undefined || pageRaw === null || pageRaw === "") return "publication_missing_page";
  const pageNum = typeof pageRaw === "number" ? pageRaw : Number(String(pageRaw).trim());
  if (!Number.isFinite(pageNum) || pageNum <= 0) return "publication_bad_page";

  return null;
}

const cases = [
  // VALID
  { name: "valid penal code", input: { kind: "primary_legislation", lawName: "חוק העונשין", hebrewYear: "התשל\"ז", gregorianYear: 1977, collection: "ס\"ח", page: 226 }, want: null },
  { name: "valid basic law", input: { kind: "basic_law", lawName: "כבוד האדם וחירותו", hebrewYear: "התשנ\"ב", collection: "ס\"ח", page: 150 }, want: null },
  { name: "valid regulation", input: { kind: "secondary_legislation", lawName: "תקנות התעבורה", hebrewYear: "התשכ\"א", gregorianYear: 1961, collection: "ק\"ת", page: 1128 }, want: null },
  { name: "valid page as string", input: { lawName: "חוק החוזים", collection: "ס\"ח", page: "27" }, want: null },
  { name: "valid missing year (formatter handles)", input: { lawName: "חוק החוזים", collection: "ס\"ח", page: 27 }, want: null },

  // TYPE LEAKAGE
  { name: "case-law docket in lawName", input: { lawName: "ע\"א 8336/17 פלוני נ' פלמוני", collection: "ס\"ח", page: 100 }, want: "type_caselaw_in_lawname" },
  { name: "petition docket in lawName", input: { lawName: "בג\"ץ 5100/94 הוועד הציבורי נ' הממשלה", collection: "ס\"ח", page: 100 }, want: "type_caselaw_in_lawname" },
  { name: "case-law prose 'פסק דין'", input: { lawName: "פסק דין בעניין החוק", collection: "ס\"ח", page: 100 }, want: "type_caselaw_prose_in_lawname" },
  { name: "case-law prose ' נ' '", input: { lawName: "המדינה נ' פלוני", collection: "ס\"ח", page: 100 }, want: "type_caselaw_prose_in_lawname" },

  // PLACEHOLDER
  { name: "placeholder 'פרטי מסמך'", input: { lawName: "פרטי מסמך", collection: "ס\"ח", page: 1 }, want: "placeholder_lawname" },
  { name: "placeholder 'לא נמצא'", input: { lawName: "לא נמצא", collection: "ס\"ח", page: 1 }, want: "placeholder_lawname" },
  { name: "placeholder 'unknown'", input: { lawName: "unknown", collection: "ס\"ח", page: 1 }, want: "placeholder_lawname" },
  { name: "bare 'חוק' only", input: { lawName: "חוק", collection: "ס\"ח", page: 1 }, want: "placeholder_bare_keyword" },
  { name: "empty lawName after strip", input: { lawName: "תקנות   ", collection: "ק\"ת", page: 1 }, want: "placeholder_bare_keyword" },

  // PUBLICATION
  { name: "bad collection 'פ\"ד'", input: { lawName: "חוק העונשין", collection: "פ\"ד", page: 100 }, want: "publication_bad_collection" },
  { name: "empty collection", input: { lawName: "חוק העונשין", collection: "", page: 100 }, want: "publication_bad_collection" },
  { name: "page = 0", input: { lawName: "חוק העונשין", collection: "ס\"ח", page: 0 }, want: "publication_bad_page" },
  { name: "page = -5", input: { lawName: "חוק העונשין", collection: "ס\"ח", page: -5 }, want: "publication_bad_page" },
  { name: "page non-numeric", input: { lawName: "חוק העונשין", collection: "ס\"ח", page: "abc" }, want: "publication_bad_page" },
  { name: "page missing", input: { lawName: "חוק העונשין", collection: "ס\"ח" }, want: "publication_missing_page" },

  // EDGE
  { name: "ge'reshayim variant ס״ח accepted", input: { lawName: "חוק העונשין", collection: "ס״ח", page: 226 }, want: null },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = validateStatuteFields(c.input);
  const ok = got === c.want;
  if (ok) { pass++; console.log(`✓ ${c.name}`); }
  else { fail++; console.log(`✗ ${c.name} — want=${JSON.stringify(c.want)} got=${JSON.stringify(got)}`); }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
