/**
 * Milestone 2B — grounded foreign source lookup.
 *
 * Search broadly, accept narrowly:
 *   Tier 1 preferred domains are DISCOVERY HINTS, not an allowlist.
 *   Tier 2 is a single bounded open-web retry.
 *   A field is accepted only when it is explicitly extracted from the
 *   evidence (title/snippet/URL or one bounded page inspection) of an
 *   identity-matched, sufficiently strong source.
 *
 * This module NEVER formats a citation and NEVER asks a model for facts.
 * Discovery = Perplexity Search API. Extraction = deterministic patterns
 * over returned evidence. Rendering stays in src/data/bluebook/.
 *
 * Pure + deps-injected so vitest can exercise it with a mocked fetch.
 */

export type ForeignLookupKind = "case" | "journal_article" | "book" | "book_chapter";
export type ForeignLookupJurisdiction = "US" | "UK" | "OTHER";

export interface ForeignLookupInput {
  kind: ForeignLookupKind;
  jurisdiction: ForeignLookupJurisdiction;
  rawInput: string;
  /** Partially parsed local fields — identity anchors the user supplied. */
  parsedFields?: Record<string, string>;
}

export interface LookupSource {
  url: string;
  title?: string;
  snippet?: string;
  tier: "tier1" | "tier2";
  /** true = strong enough to ground fields on its own. */
  strong: boolean;
}

export type GroundingBasis =
  | "official_record"
  | "structured_metadata"
  | "publisher_metadata"
  | "repository_metadata"
  | "search_result_explicit"
  | "document_inspection";

export interface ForeignLookupResult {
  kind: ForeignLookupKind;
  jurisdiction: ForeignLookupJurisdiction;
  fields: Record<string, string>;
  grounded: Record<string, boolean>;
  provenance: Record<
    string,
    { value: string; sourceUrl?: string; sourceTitle?: string; basis: GroundingBasis }
  >;
  sources: Array<{ url: string; title?: string; tier: "tier1" | "tier2" }>;
  identity: { matched: boolean; anchors: string[]; conflicts: string[] };
  diagnostics: { tier1Queried: boolean; tier2Fired: boolean };
  error?: string;
}

export interface LookupDeps {
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
}

const PPLX_SEARCH_URL = "https://api.perplexity.ai/search";
const TIMEOUT_MS = 20_000;
const MAX_RESULTS = 8;
const MAX_PAGE_BYTES = 1_500_000;

// ── Tier-1 discovery hints (NOT an allowlist) ──────────────────────────────
const TIER1_HINTS: Record<string, string[]> = {
  "case:US": [
    "courtlistener.com",
    "law.cornell.edu",
    "justia.com",
    "supremecourt.gov",
    "uscourts.gov",
    "govinfo.gov",
  ],
  "case:UK": ["bailii.org", "supremecourt.uk", "nationalarchives.gov.uk", "judiciary.uk"],
  academic: [
    "ssrn.com",
    "jstor.org",
    "heinonline.org",
    "books.google.com",
    "doi.org",
    "crossref.org",
    "cambridge.org",
    "oup.com",
    "springer.com",
    "wiley.com",
    "yalelawjournal.org",
  ],
};

function tier1Hints(kind: ForeignLookupKind, jurisdiction: ForeignLookupJurisdiction): string[] {
  if (kind === "case") return TIER1_HINTS[`case:${jurisdiction}`] ?? [];
  return TIER1_HINTS.academic;
}

// ── Source quality (acceptance rule, not hostname membership) ──────────────
const OFFICIAL_HOSTS = [
  "supremecourt.gov",
  "uscourts.gov",
  "govinfo.gov",
  "supremecourt.uk",
  "nationalarchives.gov.uk",
  "judiciary.uk",
  "legislation.gov.uk",
];
const DATABASE_HOSTS = [
  "courtlistener.com",
  "law.cornell.edu",
  "justia.com",
  "bailii.org",
  "casetext.com",
  "westlaw.com",
  "lexisnexis.com",
];
const PUBLISHER_HOSTS = [
  "ssrn.com",
  "jstor.org",
  "heinonline.org",
  "books.google.com",
  "doi.org",
  "crossref.org",
  "cambridge.org",
  "oup.com",
  "springer.com",
  "wiley.com",
  "degruyter.com",
  "tandfonline.com",
  "sagepub.com",
  "euppublishing.com",
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host: string, list: string[]): boolean {
  return list.some((d) => host === d || host.endsWith("." + d));
}

type SourceQuality = "official" | "database" | "publisher" | "repository" | "weak";

function classifySource(url: string): SourceQuality {
  const host = hostOf(url);
  if (!host) return "weak";
  if (hostMatches(host, OFFICIAL_HOSTS) || host.endsWith(".gov")) return "official";
  if (hostMatches(host, DATABASE_HOSTS)) return "database";
  if (hostMatches(host, PUBLISHER_HOSTS)) return "publisher";
  if (
    host.endsWith(".edu") ||
    host.endsWith(".ac.uk") ||
    host.endsWith(".ac.il") ||
    /press|journal|lawreview|law-review|repository|scholar|archive/.test(host)
  ) {
    return "repository";
  }
  return "weak";
}

function basisFor(q: SourceQuality, inspected: boolean): GroundingBasis {
  if (inspected) return "document_inspection";
  switch (q) {
    case "official":
      return "official_record";
    case "database":
      return "structured_metadata";
    case "publisher":
      return "publisher_metadata";
    case "repository":
      return "repository_metadata";
    default:
      return "search_result_explicit";
  }
}

// ── Identity normalization ─────────────────────────────────────────────────
export function normalizePartyName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,'"\u2019\u2018()\[\]]/g, " ")
    .replace(/\b(inc|llc|llp|plc|ltd|corp|corporation|co|company|the|of|and|&)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitParties(raw: string): [string, string] | null {
  const m = raw.match(/^\s*(.+?)\s+v\.?\s+(.+?)(?:\s*[,(\[]|$)/i);
  if (!m) return null;
  return [m[1], m[2]];
}

function textContainsParty(text: string, party: string): boolean {
  const p = normalizePartyName(party);
  if (p.length < 3) return false;
  const t = normalizePartyName(text);
  // Every significant token of the party name must appear.
  return p.split(" ").every((tok) => tok.length < 3 || t.includes(tok));
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,'"’‘:;()\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleMatches(evidence: string, title: string): boolean {
  const t = normalizeTitle(title);
  if (t.length < 6) return false;
  const e = normalizeTitle(evidence);
  const words = t.split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return false;
  const hits = words.filter((w) => e.includes(w)).length;
  return hits / words.length >= 0.8;
}

// ── Query hints (hints ≠ evidence) ─────────────────────────────────────────
function buildQuery(input: ForeignLookupInput): string {
  const raw = input.rawInput.replace(/\s+/g, " ").trim();
  if (input.kind === "case") return `${raw} citation reporter volume first page`;
  if (input.kind === "journal_article") return `${raw} journal volume page year citation`;
  if (input.kind === "book_chapter") return `${raw} chapter in book pages year`;
  return `${raw} book edition year publisher`;
}

// ── Deterministic extraction over evidence text ────────────────────────────
const REPORTER_TOKEN = /[A-Z][A-Za-z0-9]*\.(?:\s*[A-Z][A-Za-z0-9]*\.?)*\s*\d*[ds]?/;

interface CaseCite {
  volume?: string;
  reporter?: string;
  firstPage?: string;
  court?: string;
  year?: string;
  neutral?: string;
  decisionDate?: string;
  docket?: string;
  databaseIdentifier?: string;
  ukSeries?: string;
  ukVolume?: string;
}

const US_CASE_RE = new RegExp(
  `(\\d{1,4})\\s+(${REPORTER_TOKEN.source})\\s+(\\d{1,4})(?:\\s*,\\s*\\d+)?\\s*\\(([^()]*?)\\s+(\\d{4})\\)`,
  "g",
);
const UK_NEUTRAL_RE = /\[(\d{4})\]\s+(UKSC|UKHL|EWCA|EWHC|UKPC|UKUT)\s+(\d+)(?:\s*\(([^)]+)\))?/;
const UK_TRADITIONAL_RE =
  /\[(\d{4})\]\s+(?:(\d+)\s+)?(AC|QB|KB|Ch|Fam|WLR|All ER)\s+(\d+)(?:\s*\(([A-Za-z ]+?)\))?(?=[.,;\s]|$)/;
const WL_RE = /(\d{4})\s+WL\s+(\d{3,})/;
const LEXIS_RE = /(\d{4})\s+(U\.S\.\s+(?:Dist\.|App\.)\s+LEXIS)\s+(\d+)/;
const DOCKET_RE = /\bNo\.\s+([A-Za-z0-9-]+)/;

const MONTHS: Record<string, string> = {
  jan: "Jan.", feb: "Feb.", mar: "Mar.", apr: "Apr.", may: "May", jun: "June",
  jul: "July", aug: "Aug.", sep: "Sept.", oct: "Oct.", nov: "Nov.", dec: "Dec.",
};

function extractCaseFromEvidence(text: string, jurisdiction: ForeignLookupJurisdiction): CaseCite | null {
  if (jurisdiction === "UK") {
    const n = text.match(UK_NEUTRAL_RE);
    if (n) return { year: n[1], neutral: `${n[2]} ${n[3]}`, court: n[4]?.trim() };
    const t = text.match(UK_TRADITIONAL_RE);
    if (t) {
      return {
        year: t[1],
        ukVolume: t[2],
        ukSeries: t[3],
        firstPage: t[4],
        court: t[5]?.trim(),
      };
    }
    return null;
  }
  // US — database-only forms first.
  const wl = text.match(WL_RE);
  const lex = text.match(LEXIS_RE);
  const docket = text.match(DOCKET_RE)?.[1];
  if (wl) {
    const dateM = text.match(/\(([A-Za-z. ]+?)\s+([A-Z][a-z]{2})\.?\s+(\d{1,2}),?\s+(\d{4})\)/);
    let decisionDate: string | undefined;
    let court: string | undefined;
    if (dateM) {
      const mon = MONTHS[dateM[2].slice(0, 3).toLowerCase()];
      if (mon) decisionDate = `${mon} ${dateM[3]}, ${dateM[4]}`;
      court = dateM[1].trim();
    }
    return {
      databaseIdentifier: `${wl[1]} WL ${wl[2]}`,
      year: wl[1],
      docket,
      court,
      decisionDate,
    };
  }
  if (lex) {
    return { databaseIdentifier: `${lex[1]} ${lex[2].replace(/\s+/g, " ")} ${lex[3]}`, year: lex[1], docket };
  }
  US_CASE_RE.lastIndex = 0;
  const m = US_CASE_RE.exec(text);
  if (m) {
    return {
      volume: m[1],
      reporter: m[2].replace(/\s+/g, " ").trim(),
      firstPage: m[3],
      court: m[4].trim(),
      year: m[5],
    };
  }
  return null;
}

// Lazy journal capture between volume and first page; the candidate is then
// validated (must look like a periodical, not title words). The renderer's
// deterministic table — never this module — owns abbreviation.
const ARTICLE_RE = /(\d{1,3})\s+([A-Z][A-Za-z.&' ]+?)\s+(\d{1,4})(?:\s*,\s*\d+)?\s*\((\d{4})\)/;
function isPlausibleJournal(s: string): boolean {
  return /[A-Za-z]{2,}/.test(s) && /\.|Law|Journal|Rev|Stud|Econ|Legal/i.test(s);
}
const BOOK_YEAR_RE = /\((?:(\d+)(?:st|nd|rd|th)\s+ed\.?,?\s+)?(\d{4})\)/;

interface WorkCite {
  volume?: string;
  journal?: string;
  firstPage?: string;
  year?: string;
  edition?: string;
}

function extractWorkFromEvidence(text: string, kind: ForeignLookupKind): WorkCite {
  if (kind === "journal_article") {
    const m = text.match(ARTICLE_RE);
    if (m) {
      const journal = m[2].replace(/\s+/g, " ").trim();
      if (isPlausibleJournal(journal)) {
        return { volume: m[1], journal, firstPage: m[3], year: m[4] };
      }
    }
    return {};
  }
  const y = text.match(BOOK_YEAR_RE);
  if (y) return { edition: y[1] ? `${y[1]}${ordinalSuffix(Number(y[1]))} ed.` : undefined, year: y[2] };
  return {};
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

// ── Safe bounded single-page inspection ────────────────────────────────────
const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1|0\.)/;

async function fetchPageText(
  url: string,
  doFetch: typeof fetch,
): Promise<string | null> {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    if (PRIVATE_HOST_RE.test(u.hostname)) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const resp = await doFetch(url, { signal: ctrl.signal });
      if (!resp.ok) return null;
      const reader = resp.body?.getReader();
      if (!reader) return (await resp.text()).slice(0, MAX_PAGE_BYTES);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        chunks.push(value);
        if (size >= MAX_PAGE_BYTES) {
          void reader.cancel();
          break;
        }
      }
      const merged = new Uint8Array(size);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      return new TextDecoder().decode(merged);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// ── Search API ─────────────────────────────────────────────────────────────
interface RawResult {
  title?: string;
  url?: string;
  snippet?: string;
}

async function searchOnce(
  query: string,
  domains: string[] | null,
  doFetch: typeof fetch,
  apiKey: string,
): Promise<RawResult[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await doFetch(PPLX_SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        max_results: MAX_RESULTS,
        ...(domains && domains.length ? { search_domain_filter: domains } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!resp.ok) return [];
    const json = (await resp.json().catch(() => null)) as { results?: RawResult[] } | null;
    return Array.isArray(json?.results) ? json!.results! : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ── Main entry ─────────────────────────────────────────────────────────────
export async function runForeignLookup(
  input: ForeignLookupInput,
  deps?: LookupDeps,
): Promise<ForeignLookupResult> {
  const empty: ForeignLookupResult = {
    kind: input.kind,
    jurisdiction: input.jurisdiction,
    fields: {},
    grounded: {},
    provenance: {},
    sources: [],
    identity: { matched: false, anchors: [], conflicts: [] },
    diagnostics: { tier1Queried: false, tier2Fired: false },
  };
  const apiKey = deps?.apiKey ?? null;
  if (!apiKey) return { ...empty, error: "missing_perplexity_credentials" };
  const doFetch = deps?.fetchImpl ?? fetch;
  const query = buildQuery(input);

  // Tier 1 — preferred-domain discovery hints.
  empty.diagnostics.tier1Queried = true;
  const hints = tier1Hints(input.kind, input.jurisdiction);
  let results = (await searchOnce(query, hints, doFetch, apiKey)).map((r) => ({
    ...r,
    tier: "tier1" as const,
  }));

  // Tier 2 — one bounded open-web retry when Tier 1 found nothing useful.
  const hasUsable = results.some((r) => r.url && classifySource(r.url) !== "weak");
  if (!hasUsable || results.length === 0) {
    empty.diagnostics.tier2Fired = true;
    const t2 = (await searchOnce(query, null, doFetch, apiKey)).map((r) => ({
      ...r,
      tier: "tier2" as const,
    }));
    results = [...results, ...t2];
  }

  // Record sources + strength.
  const seen = new Set<string>();
  const sources: LookupSource[] = [];
  for (const r of results) {
    if (!r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    sources.push({
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      tier: r.tier,
      strong: classifySource(r.url) !== "weak",
    });
    empty.sources.push({ url: r.url, title: r.title, tier: r.tier });
  }

  // ── Identity matching ──
  const parties = input.kind === "case" ? splitParties(input.rawInput) : null;
  const titleHint = input.kind === "case" ? null : extractTitleHint(input);
  const authorHint = input.kind === "case" ? null : extractAuthorHint(input);

  const identitySources = sources.filter((s) => {
    const ev = `${s.title ?? ""} ${s.snippet ?? ""} ${s.url}`;
    if (parties) {
      return textContainsParty(ev, parties[0]) && textContainsParty(ev, parties[1]);
    }
    if (titleHint) {
      if (!titleMatches(ev, titleHint)) return false;
      if (authorHint) {
        const surname = normalizePartyName(authorHint).split(" ").pop() ?? "";
        return surname.length >= 3 ? normalizePartyName(ev).includes(surname) : true;
      }
      return true;
    }
    return false;
  });

  if (parties) {
    empty.identity.anchors.push(`parties:${normalizePartyName(parties[0])} v ${normalizePartyName(parties[1])}`);
    const docket = input.rawInput.match(/\bNo\.\s+[A-Za-z0-9-]+/)?.[0];
    if (docket) empty.identity.anchors.push(`docket:${docket}`);
  } else if (titleHint) {
    empty.identity.anchors.push(`title:${titleHint}`);
    if (authorHint) empty.identity.anchors.push(`author:${authorHint}`);
  }

  if (identitySources.length === 0) {
    empty.identity.conflicts.push("no_identity_matched_source");
    return empty;
  }
  empty.identity.matched = true;

  // ── Extraction over identity-matched evidence ──
  const strongMatched = identitySources.filter((s) => s.strong);
  const evidencePool = strongMatched.length > 0 ? strongMatched : [];
  // Weak sources may assist discovery but never ground fields alone.
  let evidenceText = evidencePool.map((s) => `${s.title ?? ""} ${s.snippet ?? ""}`).join("\n");

  let extracted = input.kind === "case"
    ? extractCaseFromEvidence(evidenceText, input.jurisdiction)
    : extractWorkFromEvidence(evidenceText, input.kind);

  // Bounded single-page inspection of the best identity-matched strong source
  // when snippets did not yield the fields we need.
  const needMore = input.kind === "case"
    ? !(extracted && (extracted.volume || extracted.databaseIdentifier || extracted.neutral || extracted.ukSeries))
    : !(extracted && (extracted.year || extracted.volume));
  let inspectedSource: LookupSource | null = null;
  if (needMore && evidencePool.length > 0) {
    inspectedSource = evidencePool[0];
    const page = await fetchPageText(inspectedSource.url, doFetch);
    if (page) {
      const plain = page.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200_000);
      evidenceText = `${evidenceText}\n${plain}`;
      extracted = input.kind === "case"
        ? extractCaseFromEvidence(evidenceText, input.jurisdiction)
        : extractWorkFromEvidence(evidenceText, input.kind);
    }
  }
  if (!extracted) return empty;

  // ── Identity conflicts (court / year the user supplied) ──
  const userCourt = input.parsedFields?.court;
  const userYear = input.parsedFields?.year ?? input.rawInput.match(/\b(19|20)\d{2}\b/)?.[0];
  if (userCourt && extracted.court) {
    if (normalizeCourtName(extracted.court) !== normalizeCourtName(userCourt)) {
      empty.identity.conflicts.push(`court:${userCourt} vs ${extracted.court}`);
      empty.identity.matched = false;
      return { ...empty, identity: { ...empty.identity, matched: false } };
    }
  }
  if (userYear && extracted.year && userYear !== extracted.year) {
    empty.identity.conflicts.push(`year:${userYear} vs ${extracted.year}`);
    return { ...empty, identity: { ...empty.identity, matched: false } };
  }

  // ── Field-level grounding: each field traced to its evidence source ──
  const candidateFields: Record<string, string | undefined> =
    input.kind === "case"
      ? input.jurisdiction === "UK"
        ? {
            // Field names match the deterministic UK renderer.
            neutral: extracted.neutral,
            reporter: extracted.ukSeries,
            reporterVolume: extracted.ukVolume,
            firstPage: extracted.firstPage,
            court: extracted.neutral ? undefined : extracted.court,
            year: extracted.year,
          }
        : {
            volume: extracted.volume,
            reporter: extracted.reporter,
            firstPage: extracted.firstPage,
            court: extracted.court,
            year: extracted.year,
            docket: extracted.docket,
            databaseIdentifier: extracted.databaseIdentifier,
            decisionDate: extracted.decisionDate,
          }
      : {
          volume: extracted.volume,
          journal: extracted.journal,
          firstPage: extracted.firstPage,
          year: extracted.year,
          edition: extracted.edition,
        };

  for (const [field, value] of Object.entries(candidateFields)) {
    if (!value) continue;
    // Never echo back identity anchors the user already supplied as "facts".
    if (field === "year" && userYear === value) continue;
    // The value must literally appear in the evidence of an identity-matched
    // strong source (or the inspected page of one). Inference ≠ grounding.
    const donor = evidencePool.find((s) => {
      const ev = inspectedSource === s ? evidenceText : `${s.title ?? ""} ${s.snippet ?? ""}`;
      return ev.includes(value) || value.includes(ev.trim());
    }) ?? (inspectedSource && evidenceText.includes(value) ? inspectedSource : null);
    if (!donor) continue;
    const quality = classifySource(donor.url);
    if (quality === "weak") continue;
    empty.fields[field] = value;
    empty.grounded[field] = true;
    empty.provenance[field] = {
      value,
      sourceUrl: donor.url,
      sourceTitle: donor.title,
      basis: basisFor(quality, inspectedSource === donor),
    };
  }

  return empty;
}

function normalizeCourtName(s: string): string {
  return s.toLowerCase().replace(/[.\s]/g, "");
}

function extractTitleHint(input: ForeignLookupInput): string | null {
  if (input.parsedFields?.articleTitle) return input.parsedFields.articleTitle;
  if (input.parsedFields?.bookTitle) return input.parsedFields.bookTitle;
  if (input.parsedFields?.chapterTitle) return input.parsedFields.chapterTitle;
  // Fallback: longest comma-separated segment that looks like a title.
  const segs = input.rawInput.split(",").map((s) => s.trim()).filter((s) => s.length > 10);
  return segs.sort((a, b) => b.length - a.length)[0] ?? null;
}

function extractAuthorHint(input: ForeignLookupInput): string | null {
  if (input.parsedFields?.authors) return input.parsedFields.authors;
  if (input.parsedFields?.author) return input.parsedFields.author;
  const m = input.rawInput.match(/^\s*([A-Z][A-Za-z.\s]+?),/);
  return m ? m[1].trim() : null;
}
