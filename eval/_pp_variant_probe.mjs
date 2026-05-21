// 4-variant Perplexity prompt diagnostic for Pass D context-richness.
//
// Calls sonar-pro with progressively richer context for known bare-reporter
// dockets, then prints a hit-rate table.
//
// Variants:
//   v1: docket only
//   v2: docket + reporter
//   v3: docket + reporter + title
//   v4: docket + reporter + title + URL + snippet
//
// Required env: PERPLEXITY_API_KEY  (read directly, NOT via Supabase).

const KEY = process.env.PERPLEXITY_API_KEY;
if (!KEY) { console.error("PERPLEXITY_API_KEY not set"); process.exit(1); }

const CASES = [
  { tag: "S2", docket: "910/86", prefix: 'בג"ץ', reporter: 'פ"ד מב(2) 441',
    title: "בג\"ץ 910/86 רסלר נ' שר הביטחון",
    url: "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts\\86\\100\\091\\g21&fileName=86091091.G21&type=4",
    snippet: "עקרון מיצוי הליכים וסעדי סף.",
    expected: { p1: "רסלר", p2: "שר הביטחון" } },
  { tag: "S4", docket: "4628/93", prefix: 'ע"א', reporter: 'פ"ד מט(2) 265',
    title: "ע\"א 4628/93 מדינת ישראל נ' אפרופים שיכון וייזום בע\"מ",
    url: "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F10%2F610%2F039%2Fp15&fileName=10039610_p15.txt&type=4",
    snippet: "פרשנות חוזה תכלית אובייקטיבית.",
    expected: { p1: "מדינת ישראל", p2: "אפרופים" } },
  { tag: "S7", docket: "389/80", prefix: 'בג"ץ', reporter: 'פ"ד לה(1) 421',
    title: "בג\"ץ 389/80 דפי זהב בע\"מ נ' רשות השידור",
    url: "https://supremedecisions.court.gov.il/Home/Download?path=HebrewVerdicts%2F80%2F038%2F9%2F01&fileName=80038901.txt&type=4",
    snippet: "עקרון הסבירות מחייב את הרשות לשקול שיקולים רלוונטיים.",
    expected: { p1: "דפי זהב", p2: "רשות השידור" } },
];

const DOMAINS = ["supreme.court.gov.il", "court.gov.il", "gov.il", "nevo.co.il", "takdin.co.il", "psakdin.co.il"];

const SYSTEM = "You are a precise Israeli-court records assistant. Given Israeli court dockets, return party names exactly as they appear on the official record (supreme.court.gov.il, nevo.co.il, takdin.co.il). Output Hebrew party names only. If you cannot verify a docket from a trusted source, OMIT it from the results — never invent.";

const SCHEMA = {
  type: "object",
  properties: {
    results: { type: "array", items: {
      type: "object",
      properties: { case_number: { type: "string" }, party1: { type: "string" }, party2: { type: "string" } },
      required: ["case_number", "party1", "party2"],
    } },
  },
  required: ["results"],
};

function buildPrompt(c, variant) {
  const docket = `${c.prefix} ${c.docket}`;
  const lines = [`1. ${docket}`];
  if (variant >= 2) lines.push(`   ציטוט: ${c.reporter}`);
  if (variant >= 3) lines.push(`   כותרת: ${c.title}`);
  if (variant >= 4) { lines.push(`   URL: ${c.url}`); lines.push(`   קטע: ${c.snippet}`); }
  return "אנא ספק את שמות הצדדים (party1, party2) עבור התיק הבא. החזר JSON.\n\n" + lines.join("\n");
}

async function call(c, variant) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST", signal: ctrl.signal,
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        search_domain_filter: DOMAINS,
        response_format: { type: "json_schema", json_schema: { name: "party_lookup", schema: SCHEMA } },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: buildPrompt(c, variant) }],
      }),
    });
    clearTimeout(timer);
    const dur = Date.now() - t0;
    if (!res.ok) return { variant, tag: c.tag, status: `http_${res.status}`, dur };
    const data = await res.json();
    const citations = data.citations || data.search_results?.map((s) => s.url) || [];
    const content = data.choices?.[0]?.message?.content || "";
    let parsed; try { parsed = JSON.parse(content); } catch { return { variant, tag: c.tag, status: "parse_failed", dur, content: content.slice(0, 200) }; }
    const r = (parsed.results || [])[0];
    if (!r?.party1 || !r?.party2) return { variant, tag: c.tag, status: "no_match", dur, citations: citations.slice(0, 3) };
    const matchP1 = r.party1.includes(c.expected.p1);
    const matchP2 = r.party2.includes(c.expected.p2);
    return { variant, tag: c.tag, status: matchP1 && matchP2 ? "verified" : "wrong_parties", dur, returned: { p1: r.party1, p2: r.party2 }, expected: c.expected, citations: citations.slice(0, 3) };
  } catch (e) {
    clearTimeout(timer);
    const isAbort = e?.name === "AbortError";
    return { variant, tag: c.tag, status: isAbort ? "timeout" : "error", dur: Date.now() - t0, msg: e?.message?.slice(0, 200) };
  }
}

const all = [];
for (const variant of [1, 2, 3, 4]) {
  console.log(`\n=== Variant v${variant} ===`);
  const results = await Promise.all(CASES.map((c) => call(c, variant)));
  for (const r of results) {
    console.log(JSON.stringify(r));
    all.push(r);
  }
}

console.log("\n=== Summary ===");
for (const variant of [1, 2, 3, 4]) {
  const sub = all.filter((r) => r.variant === variant);
  const verified = sub.filter((r) => r.status === "verified").length;
  const noMatch = sub.filter((r) => r.status === "no_match").length;
  const wrong = sub.filter((r) => r.status === "wrong_parties").length;
  const tout = sub.filter((r) => r.status === "timeout").length;
  console.log(`v${variant}: verified=${verified}/${sub.length} no_match=${noMatch} wrong=${wrong} timeout=${tout}`);
}
