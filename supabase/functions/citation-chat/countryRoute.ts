import { lookupIesc } from "./iescRecordRoute.ts";
import { parseIesc } from "../_shared/citationPure/iescDecision.ts";
import { acquireNzscDecision } from "./nzscRecordRoute.ts";
import { parseNzscNumber } from "../_shared/citationPure/nzscDecision.ts";
import { lookupSingapore } from "./singaporeRecordRoute.ts";
import { parseSingapore } from "../_shared/citationPure/singaporeDecision.ts";
import { lookupSessionCases } from "./scottishSessionCasesRoute.ts";
/**
 * Bounded country completion (server). A typed request always terminates here,
 * never falls through to the generic model and never retries an uncertain send.
 * Ontario and Scotland may inspect a single original court record; classic
 * AU/CA templates use search results only.
 *
 * The server re-derives the request from the raw text and the explicit
 * country, so a client cannot widen the scope or forge supplied fields.
 */
import {
  bindCountryChains, countryCues, countryPlanFromRaw, extractCountryChains, filterCountryDecisions, groupCountryDecisions,
  auStatuteRecord, caStatuteRecord, selectStatuteRecords, isScottishCountryWire,
  type CountryChainEvidence, type CountryDecision, type CountryFamily, type CountryFieldSource, type CountryJurisdiction, type CountryLookupRequest,
} from "../_shared/citationPure/countryLookup.ts";
import { canChargeSearch, chargePageFetch, createCitationBudget, type CitationBudget } from "../_shared/citationPure/freeformInterpret.ts";
import { searchOnce, textContainsParty, type ForeignLookupResult } from "./foreignLookup.ts";
import { ontarioRecordUrl, readOntarioDecision } from "../_shared/citationPure/ontarioDecision.ts";
import { acquireScottishRecord } from "./scottishRecordRoute.ts";
import { scottishJudgmentUrl } from "../_shared/citationPure/scottishDecision.ts";
import { trackedFetch } from "../_shared/costTelemetry.ts";

const MAX_RAW = 2000;

/** Tier-1 discovery hints (not an allowlist; acceptance is decided per host below). */
export const COUNTRY_TIER1_HINTS: Record<string, string[]> = {
  "case:AU": ["hcourt.gov.au", "fedcourt.gov.au", "austlii.edu.au", "jade.io"],
  "case:CA": ["scc-csc.ca", "scc-csc.lexum.com", "canlii.org"],
  "statute:AU": ["legislation.gov.au"],
  "statute:CA": ["laws-lois.justice.gc.ca"],
};
const OFFICIAL: Record<CountryJurisdiction, string[]> = {
  AU: ["hcourt.gov.au", "fedcourt.gov.au", "legislation.gov.au"],
  CA: ["scc-csc.ca", "scc-csc.lexum.com", "laws-lois.justice.gc.ca"],
};
const DATABASE: Record<CountryJurisdiction, string[]> = { AU: ["austlii.edu.au", "jade.io"], CA: ["canlii.org"] };

const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } };
const under = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));
/** Strong country sources only; anything else is a discovery hint and never grounds a field. */
export function countrySourceBasis(url: string, jurisdiction: CountryJurisdiction): string | null {
  const host = hostOf(url);
  if (!host) return null;
  if (under(host, OFFICIAL[jurisdiction])) return "official_record";
  if (under(host, DATABASE[jurisdiction])) return "structured_metadata";
  return null;
}

export function isCountryLookupRequest(request: unknown): boolean {
  if (!request || typeof request !== "object" || Array.isArray(request)) return false;
  const r = request as Record<string, unknown>;
  return r.jurisdiction === "AU" || r.jurisdiction === "CA" || r.jurisdiction === "SG" || r.jurisdiction === "IE" || r.jurisdiction === "NZ" ||
    (r.jurisdiction === "UK" && isScottishCountryWire(r.rawInput, r.parsedFields));
}

/** Strict contract: the client's request must equal the plan re-derived from its raw text. */
export function validateCountryRequest(request: unknown): CountryLookupRequest | null {
  if (!isCountryLookupRequest(request)) return null;
  const r = request as Record<string, unknown>;
  if (r.enabled !== true || (r.kind !== "case" && r.kind !== "statute")) return null;
  if (typeof r.rawInput !== "string" || !r.rawInput.trim() || r.rawInput.length > MAX_RAW) return null;
  if (Object.keys(r).some((k) => !["enabled", "kind", "jurisdiction", "rawInput", "parsedFields"].includes(k))) return null;
  const plan = countryPlanFromRaw(r.rawInput, r.jurisdiction as CountryLookupRequest["jurisdiction"], r.kind as CountryFamily);
  if (plan?.kind !== "lookup") return null;
  const sent = r.parsedFields && typeof r.parsedFields === "object" && !Array.isArray(r.parsedFields) ? r.parsedFields as Record<string, unknown> : null;
  if (!sent) return null;
  const want = plan.request.parsedFields;
  if (Object.keys(sent).length !== Object.keys(want).length || Object.entries(want).some(([k, v]) => sent[k] !== v)) return null;
  return plan.request;
}

export type CountryLookupResponse = ForeignLookupResult & {
  countryDecisions?: CountryDecision[];
};

function emptyResult(request: Pick<CountryLookupRequest, "kind" | "jurisdiction">): CountryLookupResponse {
  return {
    kind: request.kind, jurisdiction: request.jurisdiction as never, fields: {}, grounded: {}, provenance: {}, sources: [],
    identity: { matched: false, anchors: [], conflicts: [] },
    diagnostics: { tier1Queried: false, tier2Fired: false },
  };
}

export interface CountryRouteDeps {
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  budget?: CitationBudget;
  onProviderUnknown?: () => void;
  onError?: (error: unknown) => void;
  extractNzscPdf?: NonNullable<Parameters<typeof acquireNzscDecision>[1]>["extract"];
  extractScottishPdf?: NonNullable<Parameters<typeof acquireScottishRecord>[2]>["extract"];
}

function queryFor(request: CountryLookupRequest): string {
  const f = request.parsedFields;
  if (request.kind === "statute") {
    return request.jurisdiction === "AU" ? `"${f.statuteName}" Commonwealth Act Federal Register of Legislation` : `"${f.statuteName}" federal Act Justice Laws Canada`;
  }
  const hints = [f.neutralYear, f.court, f.reporter, f.year, f.decisionYear].filter(Boolean).join(" ");
  return request.jurisdiction === "AU"
    ? `"${f.caseName}" ${hints} High Court of Australia OR Federal Court of Australia citation`.replace(/\s+/g, " ")
    : `"${f.caseName}" ${hints} Supreme Court of Canada citation S.C.R.`.replace(/\s+/g, " ");
}

interface Hit { url: string; title?: string; snippet?: string; tier: "tier1" | "tier2" }

/** Terminal typed AU/CA resolution. Never throws, never retries, at most two searches. */
export async function resolveCountryLookup(rawRequest: unknown, deps: CountryRouteDeps): Promise<CountryLookupResponse> {
  const request = validateCountryRequest(rawRequest);
  const fallbackShape = { kind: ((rawRequest as { kind?: string } | null)?.kind === "statute" ? "statute" : "case") as CountryFamily,
    jurisdiction: ((rawRequest as { jurisdiction?: string } | null)?.jurisdiction === "UK" ? "UK" :
      (rawRequest as { jurisdiction?: string } | null)?.jurisdiction === "SG" ? "SG" :
      (rawRequest as { jurisdiction?: string } | null)?.jurisdiction === "NZ" ? "NZ" :
      (rawRequest as { jurisdiction?: string } | null)?.jurisdiction === "IE" ? "IE" :
      (rawRequest as { jurisdiction?: string } | null)?.jurisdiction === "CA" ? "CA" : "AU") as CountryLookupRequest["jurisdiction"] };
  if (!request) return { ...emptyResult(fallbackShape), error: "invalid_country_request" };
  const result = emptyResult(request);
  const doFetch = deps.fetchImpl ?? trackedFetch;
  const budget = deps.budget ?? createCitationBudget();
  try {
    if (request.jurisdiction === "UK" && request.parsedFields.reporter === "SC") {
      const f = request.parsedFields;
      const id = `[${f.neutralYear}] ${f.court} ${f.neutralNumber}`;
      const record = await lookupSessionCases(id, budget, doFetch);
      result.identity.anchors.push(id);
      if (record.state !== "matched") return record.state === "unverified" ? { ...result, error:"lookup_failed" } : result;
      result.sources = [{ url:record.url,title:record.caption,tier:"tier1" }];
      return fill(result, request, { caseName:record.caption, reporterYear:record.reportYear,firstPage:record.firstPage },
        { url:record.url,title:record.caption,basis:"publisher_metadata" });
    }
    if (request.jurisdiction === "NZ") {
      const id = parseNzscNumber(request.rawInput);
      if (!id || !chargePageFetch(budget)) return result;
      result.identity.anchors.push(id.neutral);
      const record = await acquireNzscDecision(request.rawInput, { fetch: doFetch, extract: deps.extractNzscPdf });
      if (!record) return result;
      const name = `${record.firstParty} v ${record.secondParty}`;
      result.sources = [{ url: record.url, title: name, tier: "tier1" }];
      return fill(result, request, { caseName: name }, { url: record.url, title: name, basis: "official_record" });
    }
    if (request.jurisdiction === "IE") {
      const neutral = parseIesc(request.rawInput);
      if (!neutral) return result;
      result.identity.anchors.push(neutral);
      const record = await lookupIesc(request.rawInput, budget, doFetch);
      if (!record) return result;
      result.sources = [{ url: record.url, title: record.caption, tier: "tier1" }];
      return fill(result, request, { caseName: record.caption },
        { url: record.url, title: record.caption, basis: "official_record" });
    }
    if (request.jurisdiction === "SG") {
      const neutral = (parseSingapore(request.rawInput)?.neutral ?? null);
      if (!neutral) return result;
      result.identity.anchors.push(neutral);
      const record = await lookupSingapore(request.rawInput, budget, doFetch);
      if (!record) return result;
      result.sources = [{ url: record.url, title: record.caption, tier: "tier1" }];
      return fill(result, request, { caseName: record.caption },
        { url: record.url, title: record.caption, basis: "official_record" });
    }
    if (!deps.apiKey) return { ...result, error: "missing_perplexity_credentials" };
    if (request.parsedFields.court === "ONCA") {
      return await lookupOntario(request, result, doFetch, deps.apiKey, budget);
    }
    if (request.jurisdiction === "UK") return await lookupScotland(request, result, doFetch, deps.apiKey, budget, deps.extractScottishPdf);
    return await lookup({ ...request, jurisdiction: request.jurisdiction }, result, doFetch, deps.apiKey, budget);
  } catch (error) {
    deps.onProviderUnknown?.();
    deps.onError?.(error);
    return { ...emptyResult(request), error: "lookup_failed" };
  }
}

// One discovery request plus one inspected first-party record. Redirects are
// never followed; the returned search text can rank candidates but cannot fill fields.
async function lookupOntario(request: CountryLookupRequest, result: CountryLookupResponse, doFetch: typeof fetch, apiKey: string, budget: CitationBudget): Promise<CountryLookupResponse> {
  const id = `${request.parsedFields.neutralYear} ONCA ${request.parsedFields.neutralNumber}`;
  const host = "coadecisions.ontariocourts.ca";
  result.identity.anchors.push(id);
  result.diagnostics.tier1Queried = true;
  const hits = await searchOnce(`"${id}" Ontario Court of Appeal`, [host], doFetch, apiKey,
    "foreign_search_tier1", undefined, "tier1", budget);
  if (budget.unknown) return { ...result, error: "lookup_failed" };
  const candidates = hits.flatMap(hit => {
    const url = ontarioRecordUrl(hit?.url);
    return url ? [{ url, exact: new RegExp(`\\b${id}\\b`).test(`${hit.title ?? ""} ${hit.snippet ?? ""}`) }] : [];
  }).sort((a,b) => Number(b.exact)-Number(a.exact));
  const url = candidates[0]?.url;
  if (!url || !chargePageFetch(budget)) return result;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7_000);
  try {
    const response = await doFetch(url, { redirect: "error", signal: ctrl.signal, headers: { Accept: "text/html" } });
    if (!response.ok || (response.url && response.url !== url) ||
        !/^text\/html(?:;|$)/i.test(response.headers.get("content-type") ?? "")) return result;
    const reader = response.body?.getReader();
    if (!reader) return result;
    const decoder = new TextDecoder();
    let body = "", bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512_000) { void reader.cancel().catch(() => {}); return result; }
      body += decoder.decode(value, { stream: true });
    }
    const record = readOntarioDecision(id, url, body + decoder.decode());
    if (!record) return result;
    result.sources = [{ url, title: record.caption, tier: "tier1", strong: true }];
    return fill(result, request, { caseName: record.caption }, { url, title: record.caption, basis: "official_record" });
  } finally {
    clearTimeout(timer);
  }
}

/** A search hit can locate a PDF, but cannot supply any citation field. */
async function lookupScotland(request: CountryLookupRequest, result: CountryLookupResponse, doFetch: typeof fetch,
    apiKey: string, budget: CitationBudget, extract?: CountryRouteDeps["extractScottishPdf"]): Promise<CountryLookupResponse> {
  const { neutralYear: year, court, neutralNumber: number } = request.parsedFields;
  const id = `[${year}] ${court} ${number}`;
  result.identity.anchors.push(id);
  if (!canChargeSearch(budget)) return result;
  result.diagnostics.tier1Queried = true;
  const hits = await searchOnce(`"${id}" Court of Session judgment PDF`, ["scotcourts.gov.uk"], doFetch, apiKey,
    "foreign_search_tier1", undefined, "tier1", budget);
  if (budget.unknown) return { ...result, error: "lookup_failed" };
  const exact = new RegExp(String.raw`(?:\[|\b)${year}\]?[ \t]+${court}[ \t]*${number}(?!\d)`);
  const candidates = hits.flatMap(hit => {
    const url = typeof hit.url === "string" ? scottishJudgmentUrl(hit.url) : null;
    if (!url) return [];
    const name = url.pathname.split("/").at(-1) ?? "";
    const prefix = /^(20\d{2})(csih|csoh)([1-9]\d{0,3})(?:[.-]|$)/.exec(name);
    if (prefix && (prefix[1] !== year || prefix[2] !== court.toLowerCase() || prefix[3] !== number)) return [];
    const rank = prefix ? 3 : exact.test(hit.title ?? "") ? 2 : exact.test(hit.snippet ?? "") ? 1 : 0;
    return rank ? [{ url: url.href, rank }] : [];
  }).sort((a, b) => b.rank - a.rank);
  const url = candidates[0]?.url;
  if (!url || !chargePageFetch(budget)) return result;
  const record = await acquireScottishRecord(request.rawInput, url, { fetch: doFetch, extract });
  if (!record) return result;
  result.sources = [{ url: record.sourceUrl, title: record.caption, tier: "tier1" }];
  if ("paragraph" in record && typeof record.paragraph === "string") {
    result.fields.paragraph = record.paragraph;
    result.grounded.paragraph = true;
    result.provenance.paragraph = { value: record.paragraph, sourceUrl: record.sourceUrl, basis: "document_inspection" };
  }
  return fill(result, request, { caseName: record.caption }, { url: record.sourceUrl, title: record.caption, basis: "official_record" });
}

async function lookup(request: CountryLookupRequest & { jurisdiction: CountryJurisdiction }, result: CountryLookupResponse, doFetch: typeof fetch, apiKey: string, budget: CitationBudget): Promise<CountryLookupResponse> {
  const J = request.jurisdiction;
  const f = request.parsedFields;
  const parties = request.kind === "case" ? f.caseName.match(/^(.+?)\s+(?:v\.?|c\.)\s+(.+)$/u)?.slice(1, 3) as [string, string] | undefined : undefined;
  if (request.kind === "case" && !parties) return { ...result, error: "invalid_country_request" };
  if (parties) result.identity.anchors.push(`parties:${parties[0]} v ${parties[1]}`);
  if (f.statuteName) result.identity.anchors.push(`title:${f.statuteName}`);
  const hasParty = (t: string, which: 0 | 1) => !!parties && textContainsParty(t, parties[which]);
  const run = async (tier: "tier1" | "tier2"): Promise<Hit[]> => {
    const raw = await searchOnce(queryFor(request), tier === "tier1" ? COUNTRY_TIER1_HINTS[`${request.kind}:${J}`] : null, doFetch, apiKey,
      tier === "tier1" ? "foreign_search_tier1" : "foreign_search_tier2", undefined, tier, budget);
    return raw.filter((x) => typeof x.url === "string" && x.url).map((x) => ({ url: x.url!, title: x.title, snippet: x.snippet, tier }));
  };

  // ── Cases: complete records bound to the caption, grouped by decision ──
  const caseEvidence = (hits: Hit[]): CountryChainEvidence[] => {
    const out: CountryChainEvidence[] = [];
    for (const s of hits) {
      const basis = countrySourceBasis(s.url, J);
      if (!basis) continue;
      const ev = `${s.title ?? ""} ${s.snippet ?? ""}`;
      if (!hasParty(ev, 0) || !hasParty(ev, 1)) continue;
      const source: CountryFieldSource = { url: s.url, ...(s.title ? { title: s.title } : {}), basis };
      const titleIsCaption = hasParty(s.title ?? "", 0) && hasParty(s.title ?? "", 1);
      for (const [text, noCaption] of [[s.title ?? "", false], [s.snippet ?? "", titleIsCaption]] as Array<[string, boolean]>) {
        const chains = extractCountryChains(text, J);
        const bound = bindCountryChains(text, chains, hasParty, noCaption);
        chains.forEach((chain, i) => { if (bound[i]) out.push({ chain, source }); });
      }
    }
    return out;
  };
  const statuteRecords = (hits: Hit[]) => hits.flatMap((s) => {
    const r = J === "AU" ? auStatuteRecord(s, f.statuteName) : caStatuteRecord(s, f.statuteName);
    return r ? [r] : [];
  });

  result.diagnostics.tier1Queried = true;
  let hits = await run("tier1");
  const productive = (list: Hit[]) => request.kind === "case" ? caseEvidence(list).length > 0 : statuteRecords(list).length > 0;
  if (!productive(hits) && canChargeSearch(budget)) {
    result.diagnostics.tier2Fired = true;
    hits = [...hits, ...await run("tier2")];
  }
  const seen = new Set<string>();
  hits = hits.filter((h) => !seen.has(h.url) && !!seen.add(h.url));
  result.sources = hits.filter((h) => countrySourceBasis(h.url, J)).slice(0, 12).map((h) => ({ url: h.url, ...(h.title ? { title: h.title } : {}), tier: h.tier }));
  if (budget.unknown && !productive(hits)) return { ...result, error: "lookup_failed" };

  if (request.kind === "statute") {
    const { records, conflicted } = selectStatuteRecords(statuteRecords(hits), f);
    if (records.length > 1) { result.identity.conflicts.push("ambiguous_record"); return result; }
    if (!records.length) { if (conflicted) result.identity.conflicts.push("conflicting_statute_record"); return result; }
    return fill(result, request, records[0].fields, records[0].source);
  }
  const grouped = groupCountryDecisions(caseEvidence(hits), J);
  const decisions = filterCountryDecisions(grouped.decisions, f);
  if (!decisions.length) return result;
  if (decisions.length > 1) {
    result.identity.conflicts.push("ambiguous_record");
    result.countryDecisions = decisions.slice(0, 5);
    result.disambiguation = decisions.slice(0, 5).map((d) => ({ jurisdiction: J as never, label: d.label, url: d.options[0].sources[Object.keys(d.options[0].sources)[0]].url }));
    return result;
  }
  const [d] = decisions;
  result.identity.matched = true;
  result.identity.jurisdiction = J as never;
  if (d.options.length > 1) {
    result.countryDecisions = [d];
    result.locationChoiceRequired = true;
    return result;
  }
  const option = d.options[0];
  for (const [k, v] of Object.entries(option.fields)) {
    if (f[k] !== undefined) continue;
    const s = option.sources[k];
    result.fields[k] = v; result.grounded[k] = true;
    result.provenance[k] = { value: v, sourceUrl: s.url, ...(s.title ? { sourceTitle: s.title } : {}), basis: s.basis as never };
  }
  return result;
}

function fill(result: CountryLookupResponse, request: CountryLookupRequest, fields: Record<string, string>, source: CountryFieldSource): CountryLookupResponse {
  result.identity.matched = true;
  result.identity.jurisdiction = request.jurisdiction as never;
  for (const [k, v] of Object.entries(fields)) {
    if (request.parsedFields[k] !== undefined) continue;
    result.fields[k] = v; result.grounded[k] = true;
    result.provenance[k] = { value: v, sourceUrl: source.url, ...(source.title ? { sourceTitle: source.title } : {}), basis: source.basis as never };
  }
  return result;
}

export { countryCues };

export { ONCA_ID } from "../_shared/citationPure/ontarioDecision.ts";

export { parseSingapore, parseNzscNumber, parseIesc };
