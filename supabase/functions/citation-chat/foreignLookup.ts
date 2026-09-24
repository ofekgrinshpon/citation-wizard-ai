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

export function classifySource(url: string): SourceQuality {
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
  `(\\d{1,4})\\s+(${REPORTER_TOKEN.source})\\s+(\\d{1,4})(?:\\s*,\\s*\\d+)?\\s*\\((?:(.{1,40}?)\\s+)?(\\d{4})\\)`,
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

export // U.S. Reports / S. Ct. / L. Ed. citations carry only a year parenthetical —
// the reporter itself identifies the court.
const US_REPORTS_YEAR_RE = /(\d+)\s+(U\. ?S\.|S\. ?Ct\.|L\. ?Ed\. ?2d|L\. ?Ed\.)\s+(\d+)\s*\((\d{4})\)/;

function extractCaseFromEvidence(text: string, jurisdiction: ForeignLookupJurisdiction): CaseCite | null {
  // Drop "appeals from" lines — those citations belong to OTHER decisions.
  text = text.replace(/On appeals from:[^\n]*/gi, " ").replace(/\s+/g, " ");
  if (jurisdiction === "US") {
    const r = text.match(US_REPORTS_YEAR_RE);
    if (r) return { volume: r[1], reporter: r[2].replace(/ /g, ""), firstPage: r[3], court: "U.S.", year: r[4] };
  }
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
      court: m[4]?.trim() || undefined,
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

export const VOL_RE = /([A-Z*][A-Za-z.&' *]+?),?\s+Vol\.?\s+([IVXLCDM]+|\d+),?\s+(\d{4}),?\s+pp?\.?\s*(\d+)/i;
const VOLUME_PAGES_RE = /\*?([A-Z][A-Za-z.&' ]+?)\*?,?\s+Volume\s+(\d+)(?:,?\s+Issue\s+\d+)?,?\s*[A-Za-z]*\s*(\d{4}),?\s+Pages\s+(\d+)/;
const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
function romanToArabic(r: string): string | null {
  if (/^\d+$/.test(r)) return r;
  if (!/^[IVXLCDM]+$/.test(r)) return null;
  let total = 0;
  for (let i = 0; i < r.length; i++) {
    const v = ROMAN[r[i]];
    total += i + 1 < r.length && ROMAN[r[i + 1]] > v ? -v : v;
  }
  return total > 0 ? String(total) : null;
}

function journalAnchoredInTitle(journal: string, title?: string): boolean {
  if (!title) return false;
  const words = normalizeTitle(journal).split(" ").filter((w) => w !== "the" && w !== "of" && w.length > 2);
  const t = normalizeTitle(title);
  return words.length > 0 && words.slice(0, 2).every((w) => t.includes(w));
}

function extractWorkFromEvidence(text: string, kind: ForeignLookupKind, title?: string): WorkCite {
  text = text.replace(/\s+/g, " ");
  if (kind === "journal_article") {
    const m = text.match(ARTICLE_RE);
    if (m) {
      const journal = m[2].replace(/[*#]/g, "").replace(/\s+/g, " ").trim();
      if (isPlausibleJournal(journal)) {
        return { volume: m[1], journal, firstPage: m[3], year: m[4] };
      }
    }
    // Publisher page formats: "Journal X, Vol. III, 1960, pp. 1-44".
    const v = text.match(VOL_RE);
    if (v) {
      const journal = v[1].replace(/[*#]/g, "").replace(/\s+/g, " ").trim();
      const volume = romanToArabic(v[2]);
      if (volume && isPlausibleJournal(journal) && journalAnchoredInTitle(journal, title)) {
        return { volume, journal, year: v[3], firstPage: v[4] };
      }
    }
    const vp = text.match(VOLUME_PAGES_RE);
    if (vp) {
      const journal = vp[1].replace(/[*#]/g, "").replace(/\s+/g, " ").trim();
      if (isPlausibleJournal(journal) && journalAnchoredInTitle(journal, title)) {
        return { volume: vp[2], journal, year: vp[3], firstPage: vp[4] };
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
    empty.sources.push({ url: r.url, title: r.title, tier: r.tier, snippet: r.snippet } as LookupSource & { tier: "tier1" | "tier2" });
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

  // ── Per-source extraction + grounding ────────────────────────────────────
  // Weak sources assist discovery but never ground fields alone.
  const userCourt = input.parsedFields?.court;
  const userYear = input.parsedFields?.year ?? input.rawInput.match(/\b(19|20)\d{2}\b/)?.[0];
  const strongMatched = identitySources.filter((s) => s.strong);

  type Candidate = { field: string; value: string; donor: LookupSource; inspected: boolean };
  const candidates: Candidate[] = [];

  const fieldsForSource = (text: string): Record<string, string | undefined> => {
    if (input.kind === "case") {
      const c = extractCaseFromEvidence(text, input.jurisdiction);
      if (!c) return {};
      if (input.jurisdiction === "UK") {
        return {
          // Field names match the deterministic UK renderer.
          neutral: c.neutral,
          reporter: c.ukSeries,
          reporterVolume: c.ukVolume,
          firstPage: c.firstPage,
          court: c.neutral ? undefined : c.court,
          year: c.year,
        };
      }
      return {
        volume: c.volume,
        reporter: c.reporter,
        firstPage: c.firstPage,
        court: c.court,
        year: c.year,
        docket: c.docket,
        databaseIdentifier: c.databaseIdentifier,
        decisionDate: c.decisionDate,
      };
    }
    const w = extractWorkFromEvidence(text, input.kind);
    return {
      volume: w.volume,
      journal: w.journal,
      firstPage: w.firstPage,
      year: w.year,
      edition: w.edition,
    };
  };

  // Identity-conflict filter: a source that disagrees with a user-supplied
  // identity anchor (court / year) is discarded entirely.
  const usable = strongMatched.filter((s) => {
    const ev = `${s.title ?? ""} ${s.snippet ?? ""}`;
    const c = input.kind === "case" ? extractCaseFromEvidence(ev, input.jurisdiction) : null;
    if (c) {
      if (userCourt && c.court && normalizeCourtName(c.court) !== normalizeCourtName(userCourt)) {
        empty.identity.conflicts.push(`court:${userCourt} vs ${c.court}`);
        return false;
      }
      if (userYear && c.year && userYear !== c.year) {
        empty.identity.conflicts.push(`year:${userYear} vs ${c.year}`);
        return false;
      }
    }
    return true;
  });
  if (usable.length === 0 && strongMatched.length > 0) {
    return { ...empty, identity: { ...empty.identity, matched: false } };
  }
  if (usable.length === 0) return empty;

  for (const s of usable) {
    const ev = `${s.title ?? ""} ${s.snippet ?? ""}`;
    const f = fieldsForSource(ev);
    for (const [field, value] of Object.entries(f)) {
      if (!value) continue;
      if (field === "year" && userYear === value) continue; // user anchor ≠ new fact
      // The value was deterministically extracted from THIS source's evidence —
      // that is the grounding (basis: search_result_explicit for that source).
      candidates.push({ field, value, donor: s, inspected: false });
    }
  }

  // Bounded single-page inspection of the best identity-matched strong source
  // when snippets yielded nothing. One fetch maximum; no link following.
  if (candidates.length === 0) {
    const best = usable[0];
    const page = await fetchPageText(best.url, doFetch);
    if (page) {
      const plain = page.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200_000);
      const f = fieldsForSource(plain);
      for (const [field, value] of Object.entries(f)) {
        if (!value) continue;
        if (field === "year" && userYear === value) continue;
        candidates.push({ field, value, donor: best, inspected: true });
      }
    }
  }

  // ── Field-level acceptance with conflict detection ───────────────────────
  // Identity anchors conflicting → handled above (discard source). A
  // NON-identity field on which two identity-matched sources disagree → that
  // field stays missing; the other grounded fields survive.
  const byField = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = byField.get(c.field) ?? [];
    list.push(c);
    byField.set(c.field, list);
  }
  for (const [field, list] of byField) {
    const distinct = new Set(list.map((c) => c.value));
    if (distinct.size > 1) continue; // conflicting non-identity field → missing
    const chosen = list.find((c) => c.inspected) ?? list[0];
    const quality = classifySource(chosen.donor.url);
    if (quality === "weak") continue;
    empty.fields[field] = chosen.value;
    empty.grounded[field] = true;
    empty.provenance[field] = {
      value: chosen.value,
      sourceUrl: chosen.donor.url,
      sourceTitle: chosen.donor.title,
      basis: basisFor(quality, chosen.inspected),
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
