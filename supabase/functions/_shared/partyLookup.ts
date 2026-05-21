/**
 * Party-name lookup helper (Stage 2 of caselaw v4).
 *
 * Targeted Perplexity fallback used ONLY for citations that the local
 * resolver flagged as `needs_party_lookup` — i.e. the docket was recovered
 * locally (so we know exactly which case to ask about) but party names
 * are missing AND neither the citation text nor the source card carries
 * them.
 *
 * Design constraints:
 *   • Batched: one Perplexity call per chapter for up to N dockets.
 *   • Trusted-domain filtered: nevo / supreme.court / gov.il / takdin
 *     to avoid blog/marketing sources contaminating party names.
 *   • Honest telemetry: returns attempted / recovered / failed with
 *     per-docket failure reasons.
 *   • Non-blocking: any failure is reported, never thrown — the caller
 *     keeps the original citation text on miss.
 *
 * NOT a generic resolver — this helper does ONE thing: backfill
 * party1/party2 (and optionally year/decision_date) for known dockets.
 */

export interface PartyLookupRequest {
  /** Docket number, e.g. "18225-06-25" or "8294/14". */
  caseNumber: string;
  /** Optional court hint from the source card (e.g. "(בתי המשפט המחוזיים)"). */
  courtHint?: string;
  /** Optional case-type hint from local extraction (e.g. "תמ״ש", "סע״ש"). */
  caseTypeHint?: string;
  /** Optional context block to disambiguate the docket — passed verbatim into
   * the user prompt so Perplexity can resolve cases where the docket alone is
   * insufficient (e.g. district numbers, post-rebrand renumberings, etc.). */
  contextHints?: {
    title?: string;
    snippet?: string;
    url?: string;
    sourceType?: string;
    reporterCitation?: string;
  };
}

export interface PartyLookupHit {
  caseNumber: string;
  party1: string;
  party2: string;
  /** Optional — Perplexity may also return year / decision date. */
  year?: string;
  fullDate?: string;
}

export interface PartyLookupResult {
  /** Map keyed by `caseNumber` for fast back-merge in the caller. */
  hits: Map<string, PartyLookupHit>;
  /** Per-docket failure reason for telemetry. */
  failures: Map<string, "no_match" | "parse_failed" | "domain_filtered" | "request_failed" | "timeout">;
  /** Aggregate status of the call itself. */
  status: "ok" | "no_perplexity_key" | "request_failed" | "timeout" | "parse_failed" | "no_candidates";
  /** Number of dockets we asked Perplexity to resolve. */
  attempted: number;
}

// `lite.takdin.co.il` removed: its search-results page is a JS-rendered SPA
// that Perplexity's fetcher cannot render, so including it adds no recall
// and slows the search (contributing to S7 timeouts).
const TRUSTED_LEGAL_DOMAINS = [
  "supreme.court.gov.il",
  "court.gov.il",
  "gov.il",
  "nevo.co.il",
  "takdin.co.il",
  "psakdin.co.il",
];

/**
 * Resolve party names for a batch of dockets using a single Perplexity call.
 * Returns an empty result + status="no_perplexity_key" when the key is unset
 * (so callers can degrade gracefully without throwing).
 */
export async function lookupPartyNames(
  requests: PartyLookupRequest[],
): Promise<PartyLookupResult> {
  const hits = new Map<string, PartyLookupHit>();
  const failures = new Map<string, PartyLookupResult["failures"] extends Map<string, infer V> ? V : never>();
  const attempted = requests.length;

  if (attempted === 0) {
    return { hits, failures, status: "ok", attempted };
  }

  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY) {
    for (const r of requests) failures.set(r.caseNumber, "request_failed");
    return { hits, failures, status: "no_perplexity_key", attempted };
  }

  // Build the user prompt — list dockets with their court/type hints so the
  // model can disambiguate (some district docket numbers collide across
  // tiers when stripped of prefix).
  //
  // Fix C — when caseTypeHint is a true docket prefix (בג"ץ, ע"א, …), prepend
  // it to the docket number so Perplexity sees a self-consistent Israeli
  // citation (`בג"ץ 18225-06-25`) instead of a bare district-style number.
  // Otherwise (subject category like "משפחה") keep it parenthesized as a
  // disambiguation hint, since prepending it would corrupt the citation.
  const trunc = (s: string | undefined, n: number): string =>
    !s ? "" : (s.length > n ? s.slice(0, n).trim() + "…" : s.trim());
  const docketLines = requests
    .map((r, i) => {
      const hint = (r.caseTypeHint || "").trim();
      const isDocketPrefix = hint.length > 0 && hint.length <= 6 && /["'״׳]/.test(hint);
      const docket = isDocketPrefix ? `${hint} ${r.caseNumber}` : r.caseNumber;
      const parenHints = [isDocketPrefix ? "" : hint, r.courtHint]
        .filter(Boolean)
        .join(" ");
      let line = `${i + 1}. ${docket}${parenHints ? ` (${parenHints})` : ""}`;
      const ctx = r.contextHints;
      if (ctx) {
        const ctxBits: string[] = [];
        if (ctx.title) ctxBits.push(`כותרת: ${trunc(ctx.title, 180)}`);
        if (ctx.reporterCitation) ctxBits.push(`ציטוט: ${trunc(ctx.reporterCitation, 120)}`);
        if (ctx.url) ctxBits.push(`URL: ${ctx.url}`);
        if (ctx.snippet) ctxBits.push(`קטע: ${trunc(ctx.snippet, 300)}`);
        if (ctx.sourceType) ctxBits.push(`סוג: ${ctx.sourceType}`);
        if (ctxBits.length > 0) line += `\n   הקשר — ${ctxBits.join(" | ")}`;
      }
      return line;
    })
    .join("\n");

  const userPrompt =
    "אנא ספק את שמות הצדדים (party1 = תובע/מערער/עותר, party2 = נתבע/משיב) " +
    "עבור תיקי בתי המשפט הבאים. החזר JSON תואם לסכמה. " +
    "אם אינך יכול לאתר תיק מסוים בוודאות מלאה ממקור רשמי (נבו, אתר בתי המשפט, takdin), " +
    "השמט אותו לחלוטין במקום לנחש.\n\n" +
    docketLines;

  const schema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            case_number: { type: "string" },
            party1: { type: "string" },
            party2: { type: "string" },
            year: { type: "string" },
            decision_date: { type: "string" },
          },
          required: ["case_number", "party1", "party2"],
        },
      },
    },
    required: ["results"],
  };

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 45_000);
  let status: PartyLookupResult["status"] = "ok";
  let raw: Array<{
    case_number?: string;
    party1?: string;
    party2?: string;
    year?: string;
    decision_date?: string;
  }> = [];

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "sonar-pro",
        search_domain_filter: TRUSTED_LEGAL_DOMAINS,
        response_format: {
          type: "json_schema",
          json_schema: { name: "party_lookup", schema },
        },
        messages: [
          {
            role: "system",
            content:
              "You are a precise Israeli-court records assistant. Given Israeli court dockets " +
              "(with optional context: title, snippet, URL, reporter citation), return the " +
              "party names exactly as they appear on the official record " +
              "(supreme.court.gov.il, nevo.co.il, takdin.co.il). " +
              "Use the provided context (כותרת/קטע/URL/ציטוט) to disambiguate when the bare " +
              "docket number is ambiguous — the URL in particular is often a deterministic " +
              "permalink to the case page. " +
              "Output Hebrew party names only. " +
              "If you cannot verify a docket from a trusted source, OMIT it from the results — never invent.",
          },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      console.warn("[party-lookup] HTTP", res.status, (await res.text()).slice(0, 300));
      status = "request_failed";
    } else {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      try {
        const parsed = JSON.parse(content);
        const arr = Array.isArray(parsed?.results) ? parsed.results : [];
        raw = arr.slice(0, requests.length);
      } catch (parseErr) {
        console.warn("[party-lookup] JSON parse failed:", parseErr);
        status = "parse_failed";
      }
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    status = isAbort ? "timeout" : "request_failed";
    console.warn("[party-lookup] fetch failed:", err);
  }

  if (raw.length === 0 && status === "ok") status = "no_candidates";

  // Index Perplexity results by normalized case_number, then back-merge into
  // the request set so failures (no_match) are explicit.
  const byDocket = new Map<string, typeof raw[number]>();
  for (const item of raw) {
    const cn = (item.case_number || "").trim();
    if (!cn) continue;
    byDocket.set(cn, item);
  }

  for (const req of requests) {
    const item = byDocket.get(req.caseNumber);
    if (!item) {
      failures.set(req.caseNumber, status === "ok" ? "no_match" : (status as any));
      continue;
    }
    const p1 = (item.party1 || "").trim();
    const p2 = (item.party2 || "").trim();
    if (!p1 || !p2) {
      failures.set(req.caseNumber, "no_match");
      continue;
    }
    const hit: PartyLookupHit = {
      caseNumber: req.caseNumber,
      party1: p1,
      party2: p2,
    };
    const yr = (item.year || "").trim();
    if (/^\d{4}$/.test(yr)) hit.year = yr;
    const dt = (item.decision_date || "").trim();
    const dtMatch = dt.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
    if (dtMatch) hit.fullDate = dtMatch[1];
    else if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
      const [y, m, d] = dt.split("-");
      hit.fullDate = `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`;
    }
    hits.set(req.caseNumber, hit);
  }

  return { hits, failures, status, attempted };
}
