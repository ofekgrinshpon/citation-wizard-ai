// judgment_search_first_discovery_v1
//
// Deterministic URL derivation from a *model-supplied* docket is fragile: the
// docket may be wrong (Sima Amir was nominated as 8497/00 while the real case
// is 8638/03) and the Supreme Court archive object code cannot be guessed for
// older judgments. This module replaces guessing with searching: it asks the
// search provider for the official document URL of a named judgment, keeps
// only official / high-trust hosts, and hands the URLs back for bounded
// acquisition. Identity is then proven *inside the acquired body*.
//
// This module never cites, never drafts, never relaxes a gate. It performs at
// most one bounded search call per target and returns URLs only.

export const JUDGMENT_SEARCH_FIRST_VERSION = "judgment_search_first_discovery_v1";

export const SEARCH_FIRST_LIMITS = {
  /** One search call per target; the whole point is to be cheap. */
  TIMEOUT_MS: 12_000,
  MAX_URLS: 6,
  MAX_RESULTS: 8,
} as const;

/** Official Israeli court / legislature hosts — always preferred. */
const OFFICIAL_JUDGMENT_HOST_RE =
  /(^|\.)(supremedecisions\.court\.gov\.il|elyon1\.court\.gov\.il|elyon2\.court\.gov\.il|supreme\.court\.gov\.il|court\.gov\.il|justice\.gov\.il|gov\.il|knesset\.gov\.il)$/i;

/**
 * High-trust judgment mirrors. Only used when no official URL could be
 * acquired, and only if source integrity later accepts the row — nothing here
 * makes a mirror citable on its own.
 */
const HIGH_TRUST_MIRROR_HOST_RE =
  /(^|\.)(nevo\.co\.il|takdin\.co\.il|lite\.takdin\.co\.il|psakdin\.co\.il|din\.org\.il)$/i;

/** Never worth a fetch for a judgment body. */
const NON_BODY_HOST_RE =
  /(wikipedia\.org|scholar\.google|facebook\.com|twitter\.com|x\.com|youtube\.com|linkedin\.com)/i;

const LISTING_PATH_RE =
  /(search|results|list|index|category|tags?|archive|rss)(\/|\?|$)/i;

export type SearchUrlTrust = "official" | "high_trust_mirror";

export interface SearchFirstUrl {
  url: string;
  host: string;
  trust: SearchUrlTrust;
  title: string;
  /** True when the result page is an official English translation. */
  official_translation: boolean;
}

export interface JudgmentSearchFirstResult {
  version: typeof JUDGMENT_SEARCH_FIRST_VERSION;
  ran: boolean;
  skip_reason: string | null;
  queries: string[];
  results_seen: number;
  official_urls: SearchFirstUrl[];
  mirror_urls: SearchFirstUrl[];
  http: number | null;
  ms: number;
}

export interface JudgmentSearchFirstInput {
  /** Model-supplied docket — a *hint* only, never a derivation key. */
  docket_display?: string | null;
  /** Case / party label, e.g. `בג"ץ 8638/03 סימה אמיר נ' בית הדין הרבני`. */
  label: string;
  party_names?: string[];
  court?: string | null;
  year?: number | null;
  timeout_ms?: number;
  signal?: AbortSignal;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

/** Build one compact Hebrew search query targeting the official document. */
export function buildSearchFirstQuery(input: JudgmentSearchFirstInput): string {
  const parts = [
    input.docket_display?.trim() || "",
    input.label.trim().slice(0, 90),
    input.year ? String(input.year) : "",
    "פסק דין מלא מקור רשמי supremedecisions.court.gov.il OR court.gov.il",
  ].filter(Boolean);
  return parts.join(" ").slice(0, 300);
}

function classifyUrl(url: string, title: string): SearchFirstUrl | null {
  const host = hostOf(url);
  if (!host || NON_BODY_HOST_RE.test(host)) return null;
  const path = pathOf(url);
  if (LISTING_PATH_RE.test(path) && !/download|doc|file|verdict/i.test(path)) return null;
  const official = OFFICIAL_JUDGMENT_HOST_RE.test(host);
  const mirror = HIGH_TRUST_MIRROR_HOST_RE.test(host);
  if (!official && !mirror) return null;
  return {
    url,
    host,
    trust: official ? "official" : "high_trust_mirror",
    title: String(title ?? "").slice(0, 200),
    official_translation: official && /\/eng|english|_e\b|translat/i.test(`${path} ${title}`),
  };
}

/**
 * Search for the official document URL of a named judgment.
 *
 * Returns URLs only — nothing is fetched, extracted, cached or cited here.
 * The docket, when present, is used as a search hint, not as a derivation key,
 * so a wrong model docket can still be corrected by name/party signals.
 */
export async function searchOfficialJudgmentUrls(
  input: JudgmentSearchFirstInput,
): Promise<JudgmentSearchFirstResult> {
  const t0 = Date.now();
  const out: JudgmentSearchFirstResult = {
    version: JUDGMENT_SEARCH_FIRST_VERSION,
    ran: false,
    skip_reason: null,
    queries: [],
    results_seen: 0,
    official_urls: [],
    mirror_urls: [],
    http: null,
    ms: 0,
  };
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) {
    out.skip_reason = "no_search_provider_key";
    out.ms = Date.now() - t0;
    return out;
  }
  if (!input.label || input.label.trim().length < 3) {
    out.skip_reason = "no_label";
    out.ms = Date.now() - t0;
    return out;
  }

  const query = buildSearchFirstQuery(input);
  out.queries.push(query);
  const timeout = Math.max(2_000, input.timeout_ms ?? SEARCH_FIRST_LIMITS.TIMEOUT_MS);
  const sys =
    "אתה מאתר את המסמך הרשמי של פסק דין ישראלי. החזר קישורים ישירים למסמך פסק הדין " +
    "(supremedecisions.court.gov.il, elyon1.court.gov.il, court.gov.il, gov.il), " +
    "ורק אם אין — למאגר פסיקה מוכר. אל תמציא קישורים. אם מספר התיק שסופק שגוי, " +
    "החזר את מספר התיק והקישור הנכונים לפי שמות הצדדים.";

  try {
    out.ran = true;
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: query },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "judgment_documents",
            schema: {
              type: "object",
              properties: {
                documents: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      docket: { type: "string" },
                      url: { type: "string" },
                    },
                    required: ["title"],
                  },
                },
              },
              required: ["documents"],
            },
          },
        },
      }),
      signal: input.signal ?? AbortSignal.timeout(timeout),
    });
    out.http = r.status;
    if (!r.ok) {
      out.skip_reason = `search_http_${r.status}`;
      out.ms = Date.now() - t0;
      return out;
    }
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content ?? "";
    const citations: string[] = Array.isArray(j?.citations) ? j.citations : [];
    let parsed: { documents?: Array<{ title?: string; url?: string; docket?: string }> } = {};
    try {
      parsed = JSON.parse(content);
    } catch { /* tolerate non-JSON */ }
    const docs = Array.isArray(parsed.documents) ? parsed.documents : [];
    out.results_seen = docs.length + citations.length;

    const seen = new Set<string>();
    const push = (url: string, title: string) => {
      const u = String(url ?? "").trim();
      if (!u || seen.has(u)) return;
      seen.add(u);
      const c = classifyUrl(u, title);
      if (!c) return;
      if (c.trust === "official") out.official_urls.push(c);
      else out.mirror_urls.push(c);
    };
    for (const d of docs.slice(0, SEARCH_FIRST_LIMITS.MAX_RESULTS)) {
      push(String(d.url ?? ""), String(d.title ?? ""));
    }
    for (const c of citations.slice(0, SEARCH_FIRST_LIMITS.MAX_RESULTS)) push(c, "");

    out.official_urls = out.official_urls.slice(0, SEARCH_FIRST_LIMITS.MAX_URLS);
    out.mirror_urls = out.mirror_urls.slice(0, SEARCH_FIRST_LIMITS.MAX_URLS);
  } catch (e) {
    out.skip_reason = `search_failed:${e instanceof Error ? e.message : String(e)}`.slice(0, 160);
  }
  out.ms = Date.now() - t0;
  return out;
}

// ── Identity validation inside the acquired body ───────────────────────────

export interface JudgmentIdentityInput {
  text: string;
  /** Normalized docket, when the nomination supplied one. */
  docket_present: boolean;
  docket_in_text: boolean;
  name_tokens: string[];
  year?: number | null;
  court?: string | null;
}

export interface JudgmentIdentityResult {
  validated: boolean;
  docket_match: boolean;
  name_hits: number;
  name_required: number;
  year_match: boolean;
  court_match: boolean;
  reason: string;
}

const COURT_MARKER_RE =
  /(בבית\s+המשפט\s+העליון|בית\s+המשפט\s+העליון|בשבתו\s+כבית\s+משפט\s+גבוה\s+לצדק|בית\s+הדין|בית\s+המשפט\s+המחוזי)/;

export function nameHitCount(text: string, toks: string[]): number {
  const t = String(text ?? "").replace(/["'`׳״]/g, "");
  let n = 0;
  for (const tok of toks) if (t.includes(tok)) n++;
  return n;
}

/**
 * A judgment body is accepted only when its identity is provable in the text.
 *
 *  - docket present and found in the body → accepted (strongest signal);
 *  - no usable docket → at least two distinctive party/name tokens **plus** a
 *    court marker or the year, so a different case with one shared surname
 *    cannot pass.
 */
export function validateJudgmentIdentity(
  input: JudgmentIdentityInput,
): JudgmentIdentityResult {
  const head = String(input.text ?? "").slice(0, 40_000);
  const hits = nameHitCount(head, input.name_tokens);
  const required = input.name_tokens.length >= 2 ? 2 : 1;
  const year_match = !!input.year && head.includes(String(input.year));
  const court_match = COURT_MARKER_RE.test(head);

  const base: Omit<JudgmentIdentityResult, "validated" | "reason"> = {
    docket_match: input.docket_in_text,
    name_hits: hits,
    name_required: required,
    year_match,
    court_match,
  };

  if (input.docket_present && input.docket_in_text) {
    return { ...base, validated: true, reason: "docket_in_body" };
  }
  if (input.name_tokens.length === 0) {
    return { ...base, validated: false, reason: "no_distinctive_tokens" };
  }
  if (hits < required) {
    return { ...base, validated: false, reason: "insufficient_name_tokens" };
  }
  if (!court_match && !year_match) {
    return { ...base, validated: false, reason: "no_court_or_year_corroboration" };
  }
  return { ...base, validated: true, reason: "name_tokens_with_corroboration" };
}
