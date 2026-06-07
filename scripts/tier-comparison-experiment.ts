// Diagnostic-only A/B/C tier-comparison runner.
// NO production code paths. Calls Perplexity directly from this script.
// Writes report to reports/tier-comparison-<ts>.{md,json}.

import {
  TRUSTED_LEGAL,
  TRUSTED_PUB,
  isTrustedHost,
  hostOf,
  extractDocket,
  urlContainsDocketVia,
  type DocketAnchorVia,
} from "../supabase/functions/_shared/trustedHosts.ts";

const PPLX_KEY = Deno.env.get("PERPLEXITY_API_KEY");
if (!PPLX_KEY) {
  console.error("PERPLEXITY_API_KEY not set");
  Deno.exit(1);
}

const argMap = new Map<string, string>();
for (let i = 0; i < Deno.args.length; i++) {
  const a = Deno.args[i];
  if (a.startsWith("--")) argMap.set(a.slice(2), Deno.args[i + 1] ?? "");
}
const FIXTURES = argMap.get("fixtures") ?? "eval/tier-comparison/fixtures.json";
const OUT_DIR = argMap.get("out") ?? "reports";

interface Gold {
  docket?: string | null;
  parties?: string[] | null;
  title?: string | null;
  author?: string | null;
  pub_year?: string | null;
  journal?: string | null;
  volume?: string | null;
  page?: string | null;
}
interface Fixture {
  id: string;
  type: string;
  query: string;
  gold: Gold;
  neighbors?: string[];
}

const fixtures: Fixture[] = JSON.parse(await Deno.readTextFile(FIXTURES)).fixtures;

// ---------------- Perplexity wrapper ----------------
interface PplxResult {
  content: string;
  citations: string[];
  search_results: { url?: string; title?: string; snippet?: string }[];
  raw: unknown;
}

const SYSTEM = `אתה עוזר משפטי. החזר אזכור משפטי לפי כללי האזכור האחיד הישראלי בלבד, בשורה אחת. אם לא ידוע פרט — אל תמציא. החזר JSON: {"citation": string, "docket": string|null, "party1": string|null, "party2": string|null, "title": string|null, "author": string|null, "journal": string|null, "volume": string|null, "page": string|null, "pub_year": string|null, "selected_url": string|null}`;

async function pplx(
  query: string,
  domains: string[] | null,
): Promise<PplxResult> {
  const body: Record<string, unknown> = {
    model: "sonar",
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `המקור: ${query}` },
    ],
    temperature: 0.1,
    response_format: {
      type: "json_schema",
      json_schema: {
        schema: {
          type: "object",
          properties: {
            citation: { type: "string" },
            docket: { type: ["string", "null"] },
            party1: { type: ["string", "null"] },
            party2: { type: ["string", "null"] },
            title: { type: ["string", "null"] },
            author: { type: ["string", "null"] },
            journal: { type: ["string", "null"] },
            volume: { type: ["string", "null"] },
            page: { type: ["string", "null"] },
            pub_year: { type: ["string", "null"] },
            selected_url: { type: ["string", "null"] },
          },
          required: ["citation"],
        },
      },
    },
  };
  if (domains && domains.length) body.search_domain_filter = domains;

  const r = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PPLX_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`pplx ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  const content = j?.choices?.[0]?.message?.content || "{}";
  return {
    content,
    citations: Array.isArray(j?.citations) ? j.citations : [],
    search_results: Array.isArray(j?.search_results) ? j.search_results : [],
    raw: j,
  };
}

// ---------------- Host classification ----------------
const ACADEMIC_TLDS = [".ac.il", "ssrn.com", "papers.ssrn.com", "academia.edu", "researchgate.net"];
const OFFICIAL = [
  "supreme.court.gov.il", "supremedecisions.court.gov.il", "court.gov.il",
  "knesset.gov.il", "main.knesset.gov.il", "fs.knesset.gov.il",
  "reshumot.gov.il", "gov.il",
];
const DATABASES = ["nevo.co.il", "takdin.co.il", "lite.takdin.co.il", "psakdin.co.il", "din.org.il"];
const NEWS = ["mako.co.il", "ynet.co.il", "haaretz.co.il", "globes.co.il", "calcalist.co.il", "n12.co.il", "themarker.com", "kan.org.il", "walla.co.il", "a7.org", "israelhayom.co.il", "maariv.co.il"];
const WIKI = ["wikipedia.org", "he.wikipedia.org"];
const BLOG_HINTS = ["blog", "wordpress", "medium.com", "substack.com"];

function classifyHost(url: string | null): string {
  const h = hostOf(url || "");
  if (!h) return "unknown";
  if (OFFICIAL.some((d) => h === d || h.endsWith("." + d))) return "official";
  if (DATABASES.some((d) => h === d || h.endsWith("." + d))) return "database";
  if (ACADEMIC_TLDS.some((d) => h.endsWith(d) || h === d.replace(/^\./, ""))) return "academic";
  if (NEWS.some((d) => h === d || h.endsWith("." + d))) return "news";
  if (WIKI.some((d) => h.endsWith(d))) return "wiki";
  if (BLOG_HINTS.some((s) => h.includes(s))) return "blog";
  if (url && url.toLowerCase().endsWith(".pdf")) return "random_pdf";
  return "other";
}

// ---------------- Field check helpers ----------------
function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/["״׳'.,()[\]{}:;!?\/\\|–—\-]/g, " ").replace(/\s+/g, " ").trim();
}
function containsAll(hay: string, needle: string): boolean {
  const tokens = norm(needle).split(" ").filter((t) => t.length >= 2);
  if (!tokens.length) return false;
  const h = norm(hay);
  return tokens.every((t) => h.includes(t));
}

interface Parsed {
  citation: string;
  docket: string | null;
  party1: string | null;
  party2: string | null;
  title: string | null;
  author: string | null;
  journal: string | null;
  volume: string | null;
  page: string | null;
  pub_year: string | null;
  selected_url: string | null;
}

function parseContent(content: string): Parsed | null {
  try {
    const o = JSON.parse(content);
    return {
      citation: String(o.citation || ""),
      docket: o.docket ?? null,
      party1: o.party1 ?? null,
      party2: o.party2 ?? null,
      title: o.title ?? null,
      author: o.author ?? null,
      journal: o.journal ?? null,
      volume: o.volume ?? null,
      page: o.page ?? null,
      pub_year: o.pub_year ?? null,
      selected_url: o.selected_url ?? null,
    };
  } catch {
    return null;
  }
}

const CAPTION_MARKERS = ["נ׳", "נ'", "נגד", "העותרים", "המשיבים", "המערערים", "המבקשים"];

interface VariantResult {
  variant: "A" | "B" | "C";
  found: boolean;
  selected_url: string | null;
  host: string | null;
  host_class: string;
  trusted_tier2: boolean;
  citation: string;
  docket_ok: boolean | null;
  parties_ok: boolean | null;
  article_ok: boolean | null;
  pub_ok: boolean | null;
  missing_fields: string[];
  fp_near_neighbor: boolean;
  docket_anchor_via: DocketAnchorVia | "n/a";
  party_verification: "both" | "caption_marker" | "insufficient_snippet" | "no_anchor" | "n/a";
  notes: string[];
}

function checkParties(parsed: Parsed, anchored: { title?: string; snippet?: string } | null): "both" | "caption_marker" | "insufficient_snippet" | "no_anchor" | "n/a" {
  if (!parsed.party1 && !parsed.party2) return "n/a";
  if (!anchored) return "no_anchor";
  const hay = norm(`${anchored.title || ""} ${anchored.snippet || ""}`);
  const p1 = parsed.party1 ? norm(parsed.party1) : "";
  const p2 = parsed.party2 ? norm(parsed.party2) : "";
  const p1Hit = p1 && hay.includes(p1);
  const p2Hit = p2 && hay.includes(p2);
  if (p1Hit && p2Hit) return "both";
  const rawHay = `${anchored.title || ""} ${anchored.snippet || ""}`;
  for (const marker of CAPTION_MARKERS) {
    const idx = rawHay.indexOf(marker);
    if (idx < 0) continue;
    const window = norm(rawHay.slice(Math.max(0, idx - 40), idx + 40));
    if ((p1 && window.includes(p1)) || (p2 && window.includes(p2))) return "caption_marker";
  }
  return "insufficient_snippet";
}

async function runVariant(
  variant: "A" | "B" | "C",
  fx: Fixture,
  domains: string[] | null,
): Promise<VariantResult> {
  const res: VariantResult = {
    variant,
    found: false,
    selected_url: null,
    host: null,
    host_class: "unknown",
    trusted_tier2: false,
    citation: "",
    docket_ok: null,
    parties_ok: null,
    article_ok: null,
    pub_ok: null,
    missing_fields: [],
    fp_near_neighbor: false,
    docket_anchor_via: "n/a",
    party_verification: "n/a",
    notes: [],
  };

  let pr: PplxResult;
  try {
    pr = await pplx(fx.query, domains);
  } catch (e) {
    res.notes.push(`pplx_error: ${(e as Error).message}`);
    return res;
  }

  const parsed = parseContent(pr.content);
  if (!parsed || !parsed.citation) {
    res.notes.push("no_parse");
    return res;
  }
  res.citation = parsed.citation;
  res.found = true;

  // Selected URL: prefer parsed.selected_url if valid, else first matching docket URL, else first.
  const candidates = [
    ...(parsed.selected_url ? [parsed.selected_url] : []),
    ...pr.citations,
    ...pr.search_results.map((s) => s.url).filter(Boolean) as string[],
  ];
  const docket = extractDocket(fx.gold.docket || fx.query);

  let chosen: string | null = null;
  let chosenVia: DocketAnchorVia = "none";
  if (docket) {
    for (const u of candidates) {
      const v = urlContainsDocketVia(u, docket);
      if (v.ok) { chosen = u; chosenVia = v.via; break; }
    }
  }
  if (!chosen) chosen = candidates[0] ?? null;
  res.selected_url = chosen;
  res.host = hostOf(chosen || "");
  res.host_class = classifyHost(chosen);
  res.trusted_tier2 = isTrustedHost(chosen, [...TRUSTED_LEGAL, ...TRUSTED_PUB]);
  res.docket_anchor_via = docket ? chosenVia : "n/a";

  // Anchored snippet (for party check) — pick search_result whose URL matches chosen.
  const anchored = pr.search_results.find((s) => s.url === chosen) || null;

  // Docket correctness
  if (fx.gold.docket) {
    const want = fx.gold.docket;
    const gotInCit = parsed.citation.includes(want) || (parsed.docket || "").includes(want);
    res.docket_ok = gotInCit;
    // Near-neighbor false positive: chosen URL anchors a neighbor docket but not the asked docket.
    if (fx.neighbors && docket) {
      const anchorsAsked = chosen && urlContainsDocketVia(chosen, docket).ok;
      if (!anchorsAsked) {
        for (const nb of fx.neighbors) {
          const nbd = extractDocket(nb);
          if (nbd && chosen && urlContainsDocketVia(chosen, nbd).ok) {
            res.fp_near_neighbor = true;
            res.notes.push(`near_neighbor_url:${nb}`);
            break;
          }
        }
      }
    }
    // Also: citation mentions neighbor party but not asked docket
    if (fx.neighbors) {
      for (const nb of fx.neighbors) {
        if (parsed.citation.includes(nb)) {
          res.fp_near_neighbor = true;
          res.notes.push(`near_neighbor_citation:${nb}`);
        }
      }
    }
  }

  // Parties
  if (fx.gold.parties && fx.gold.parties.length) {
    const cit = parsed.citation;
    const goldHits = fx.gold.parties.filter((p) => containsAll(cit, p)).length;
    res.parties_ok = goldHits >= Math.min(2, fx.gold.parties.length) ? true : goldHits >= 1 ? false : false;
    res.party_verification = checkParties(parsed, anchored as any);
  }

  // Article
  if (fx.type === "literature") {
    const titleOk = fx.gold.title ? containsAll(parsed.citation, fx.gold.title) : null;
    const authorOk = fx.gold.author ? containsAll(parsed.citation, fx.gold.author) : null;
    const journalOk = fx.gold.journal ? containsAll(parsed.citation, fx.gold.journal) : null;
    const hits = [titleOk, authorOk, journalOk].filter((x) => x === true).length;
    const total = [titleOk, authorOk, journalOk].filter((x) => x !== null).length;
    res.article_ok = total > 0 ? hits === total : null;
    if (titleOk === false) res.missing_fields.push("title");
    if (authorOk === false) res.missing_fields.push("author");
    if (journalOk === false) res.missing_fields.push("journal");
  }

  // Publication
  if (fx.gold.pub_year) {
    res.pub_ok = parsed.citation.includes(fx.gold.pub_year) || (parsed.pub_year || "").includes(fx.gold.pub_year);
  }

  // Missing fields generic
  if (!parsed.docket && fx.gold.docket) res.missing_fields.push("docket");
  if (!parsed.party1 && fx.gold.parties) res.missing_fields.push("party1");
  if (!parsed.party2 && fx.gold.parties) res.missing_fields.push("party2");

  return res;
}

// ---------------- B trust gate (post-hoc) ----------------
function applyTier2Gate(res: VariantResult, fx: Fixture): VariantResult {
  // If selected URL not trusted under Tier-2 → drop.
  if (!res.trusted_tier2) {
    return { ...res, found: false, citation: "", notes: [...res.notes, "tier2_gate:untrusted_host"], docket_ok: null, parties_ok: null, article_ok: null, pub_ok: null };
  }
  // Docket-anchor gate
  if (fx.gold.docket && res.docket_anchor_via === "none") {
    return { ...res, found: false, citation: "", notes: [...res.notes, "tier2_gate:no_docket_anchor"] };
  }
  // Strict party gate
  if (res.party_verification === "insufficient_snippet") {
    return { ...res, parties_ok: false, notes: [...res.notes, "tier2_gate:party_dropped"] };
  }
  return res;
}

// ---------------- Classification C vs B ----------------
function classify(b: VariantResult, c: VariantResult, fx: Fixture): string {
  const bGood = b.found && b.docket_ok !== false && !b.fp_near_neighbor;
  const cGood = c.found && c.docket_ok !== false && !c.fp_near_neighbor;
  const bFields = [b.docket_ok, b.parties_ok, b.article_ok, b.pub_ok].filter((x) => x === true).length;
  const cFields = [c.docket_ok, c.parties_ok, c.article_ok, c.pub_ok].filter((x) => x === true).length;

  if (c.fp_near_neighbor && !b.fp_near_neighbor) return "false_positive";
  if (cGood && !bGood) return "materially_better";
  if (cGood && bGood && cFields > bFields + 1) return "materially_better";
  if (cGood && bGood && cFields === bFields + 1) return "slightly_better";
  if (!cGood && bGood) return "worse";
  if (cGood && bGood && cFields === bFields) {
    // Same correctness; check noise (untrusted host)
    if (!c.trusted_tier2) return "same_but_noisier";
    return "same";
  }
  if (!cGood && !bGood) return "same";
  return "same_but_noisier";
}

// ---------------- Main ----------------
const CONCURRENCY = 3;
const rows: { fx: Fixture; A: VariantResult; B: VariantResult; C: VariantResult; cls: string }[] = [];

async function processOne(fx: Fixture) {
  console.error(`[run] ${fx.id} :: ${fx.query.slice(0, 60)}`);
  const [a, bRaw, c] = await Promise.all([
    runVariant("A", fx, [...TRUSTED_LEGAL]),
    runVariant("B", fx, [...TRUSTED_LEGAL, ...TRUSTED_PUB]),
    runVariant("C", fx, null),
  ]);
  const b = applyTier2Gate(bRaw, fx);
  const cls = classify(b, c, fx);
  rows.push({ fx, A: a, B: b, C: c, cls });
}

// Simple concurrency pool
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const queue = items.slice();
  const workers = Array.from({ length: n }, async () => {
    while (queue.length) {
      const it = queue.shift()!;
      try { await fn(it); } catch (e) { console.error("worker err", e); }
    }
  });
  await Promise.all(workers);
}

console.error(`Running ${fixtures.length} fixtures x 3 variants…`);
const t0 = Date.now();
await pool(fixtures, CONCURRENCY, processOne);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.error(`Done in ${elapsed}s`);

// Sort rows to match input order
rows.sort((a, b) => fixtures.findIndex((f) => f.id === a.fx.id) - fixtures.findIndex((f) => f.id === b.fx.id));

// ---------------- Aggregate ----------------
const buckets: Record<string, number> = {
  materially_better: 0, slightly_better: 0, same: 0, same_but_noisier: 0, worse: 0, false_positive: 0,
};
for (const r of rows) buckets[r.cls] = (buckets[r.cls] ?? 0) + 1;

const bFP = rows.filter((r) => r.B.fp_near_neighbor).length;
const cFP = rows.filter((r) => r.C.fp_near_neighbor).length;
const cMatBetterWhereBFailed = rows.filter((r) => r.cls === "materially_better" && (!r.B.found || r.B.docket_ok === false)).length;
const cAddsCorrectFields = rows.filter((r) => {
  const bF = [r.B.docket_ok, r.B.parties_ok, r.B.article_ok, r.B.pub_ok].filter((x) => x === true).length;
  const cF = [r.C.docket_ok, r.C.parties_ok, r.C.article_ok, r.C.pub_ok].filter((x) => x === true).length;
  return cF > bF;
}).length;

const EPS = 1;
const passTier3 = cMatBetterWhereBFailed >= 4 && cFP <= bFP + EPS && cAddsCorrectFields >= 4;
const recommendation = passTier3
  ? "C materially beats B. Do not enable open web by default. Propose a separate admin/diagnostic Tier-3 design (follow-up task)."
  : "Keep Tier-2 curated fallback only. Do not implement open-web Tier-3.";

// ---------------- Report ----------------
const ts = new Date().toISOString().replace(/[:.]/g, "-");
await Deno.mkdir(OUT_DIR, { recursive: true });
const jsonPath = `${OUT_DIR}/tier-comparison-${ts}.json`;
const mdPath = `${OUT_DIR}/tier-comparison-${ts}.md`;

await Deno.writeTextFile(jsonPath, JSON.stringify({ rows, buckets, bFP, cFP, cMatBetterWhereBFailed, cAddsCorrectFields, recommendation }, null, 2));

function tf(b: boolean | null): string { return b === null ? "—" : b ? "✓" : "✗"; }
function tBool(b: boolean): string { return b ? "Y" : "N"; }

let md = `# Tier Comparison Report\n\nGenerated: ${new Date().toISOString()}\nFixtures: ${rows.length}\n\n## Aggregate\n\n`;
md += `| bucket | count |\n|---|---|\n`;
for (const [k, v] of Object.entries(buckets)) md += `| ${k} | ${v} |\n`;
md += `\nB false-positives: ${bFP}  |  C false-positives: ${cFP}\n`;
md += `C materially_better where B failed: ${cMatBetterWhereBFailed}\n`;
md += `C contributed strictly more correct fields than B: ${cAddsCorrectFields}\n\n`;
md += `## Recommendation\n\n**${recommendation}**\n\n`;

md += `## Per-source\n\n`;
for (const r of rows) {
  md += `### ${r.fx.id} — ${r.fx.query}\n\n`;
  md += `Classification: **${r.cls}**  |  type: ${r.fx.type}\n\n`;
  md += `| variant | found | host | class | trusted2 | docket | parties | article | pub | FP | anchor_via | party_v | URL |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const v of [r.A, r.B, r.C]) {
    md += `| ${v.variant} | ${tBool(v.found)} | ${v.host || "—"} | ${v.host_class} | ${tBool(v.trusted_tier2)} | ${tf(v.docket_ok)} | ${tf(v.parties_ok)} | ${tf(v.article_ok)} | ${tf(v.pub_ok)} | ${tBool(v.fp_near_neighbor)} | ${v.docket_anchor_via} | ${v.party_verification} | ${(v.selected_url || "—").slice(0, 80)} |\n`;
  }
  md += `\n`;
  for (const v of [r.A, r.B, r.C]) {
    if (v.citation) md += `- **${v.variant}**: ${v.citation}\n`;
  }
  const notes = [...r.A.notes, ...r.B.notes, ...r.C.notes].filter(Boolean);
  if (notes.length) md += `- notes: ${notes.join("; ")}\n`;
  md += `\n`;
}

await Deno.writeTextFile(mdPath, md);
console.error(`\nReport: ${mdPath}\nJSON:   ${jsonPath}\n`);
console.log(JSON.stringify({ mdPath, jsonPath, buckets, bFP, cFP, cMatBetterWhereBFailed, cAddsCorrectFields, recommendation }, null, 2));
