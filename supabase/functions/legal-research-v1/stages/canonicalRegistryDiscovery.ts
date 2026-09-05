/**
 * canonical_registry_discovery_and_representative_source_use_v1 — fix 1.
 *
 * Problem: `runCanonicalAuthorityAcquisition` now triggers, but every attempt
 * is starved (`discovery_candidate_count: 0`, `no_derivable_url`), because
 * official discovery only queries *nominated* sources — never the canonical
 * authorities the core-authority registry seeded (ע"א 6821/93 בנק המזרחי,
 * בג"ץ 1715/97 לשכת מנהלי ההשקעות, בג"ץ 389/80 דפי זהב …).
 *
 * This stage closes that gap and nothing else:
 *   local corpus (docket-exact) → bounded targeted web discovery → candidate
 *   URLs handed to the existing acquisition lane.
 *
 * It never cites, never drafts, never relaxes a gate. Identity is still proven
 * inside the acquired body downstream, guessed court URLs stay suppressed,
 * listing pages stay rejected, and an authority that cannot be acquired is
 * reported as an explicit `canonical_authority_gap`.
 */

import type { Candidate } from "../lib/types.ts";
import type { IntegrityLogRow } from "./candidatePool.ts";
import {
  detectDockets,
  normalizedDocketId,
  textContainsExactDocket,
  type DocketRef,
} from "./docketDetection.ts";
import {
  DOCTRINE_REGISTRY,
  type CanonicalAuthority,
  type CoreAuthorityRegistryResult,
} from "./coreAuthorityRegistry.ts";
import { searchOfficialJudgmentUrls } from "./officialSourceDiscovery.ts";
import { isGuessedCourtUrl } from "../lib/judgmentUrlEligibility.ts";
import { classifySourceIntegrity, type SourceIntegrity } from "./sourceIntegrity.ts";
import { resolveLocalJudgmentAnchor, type LocalDoc } from "./localPrimaryAnchor.ts";
import type { DiscoveredJudgmentUrl } from "./canonicalAuthorityAcquisition.ts";

export const CANONICAL_REGISTRY_DISCOVERY_VERSION =
  "canonical_registry_discovery_and_representative_source_use_v1";

export const CANONICAL_REGISTRY_DISCOVERY_LIMITS = {
  /** Bounded: this is targeted discovery, not broad search. */
  MAX_AUTHORITIES: 3,
  /** Bounded web calls per authority. */
  MAX_QUERIES_PER_AUTHORITY: 2,
  /** Candidate URLs handed downstream per authority. */
  MAX_CANDIDATES_PER_AUTHORITY: 3,
  /** Official-host URLs accepted without explicit docket evidence in the title. */
  MAX_UNVERIFIED_OFFICIAL_PER_AUTHORITY: 2,
  SEARCH_MS: 12_000,
  TOTAL_MS: 30_000,
  MIN_BUDGET_MS: 6_000,
  /** Local body must be at least this long to count as an acquired judgment. */
  MIN_LOCAL_BODY_CHARS: 1_200,
  MAX_LOCAL_TEXT: 12_000,
} as const;

const OFFICIAL_HOST_RE =
  /(^|\.)(supremedecisions\.court\.gov\.il|elyon1\.court\.gov\.il|elyon2\.court\.gov\.il|supreme\.court\.gov\.il|court\.gov\.il|justice\.gov\.il|gov\.il|knesset\.gov\.il)$/i;

const LISTING_PATH_RE = /(search|results|list|index|category|tags?|archive|rss)(\/|\?|$)/i;

/** Telemetry row: `canonical_registry_discovery_query`. */
export interface CanonicalRegistryDiscoveryQuery {
  run_id: string | null;
  authority_name: string;
  docket: string | null;
  jurisdiction: string;
  expected_role: string;
  query_variants: string[];
  discovery_lane: "local_corpus" | "official_web_search" | "none";
  candidate_count: number;
  candidate_urls: string[];
  candidate_hosts: string[];
  local_attempted: boolean;
  local_doc_id: string | null;
  local_body_chars: number;
  skip_reason: string | null;
  http_status: number | null;
  ms: number;
}

/** Telemetry row: `canonical_discovery_candidate_selection`. */
export interface CanonicalDiscoveryCandidateSelection {
  authority_name: string;
  docket: string | null;
  candidate_url: string;
  candidate_host: string;
  selected_for_fetch: boolean;
  rejected_before_fetch: boolean;
  rejection_reason: string | null;
  docket_evidence: "title" | "url" | "official_host_targeted" | "none";
}

export interface CanonicalRegistryDiscoveryReport {
  version: typeof CANONICAL_REGISTRY_DISCOVERY_VERSION;
  enabled: boolean;
  skip_reason: string | null;
  doctrine_id: string | null;
  authorities_considered: string[];
  authorities_queried: string[];
  queries: CanonicalRegistryDiscoveryQuery[];
  selections: CanonicalDiscoveryCandidateSelection[];
  discovered_urls: DiscoveredJudgmentUrl[];
  candidate_count: number;
  local_bodies_injected: string[];
  ms: number;
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

/** Party names inside a canonical label: `ע"א 6821/93 בנק המזרחי נ' מגדל`. */
export function partyNamesFromLabel(label: string): string[] {
  const stripped = String(label ?? "")
    .replace(/[א-ת]{2,4}["'׳״]?\s*\d{1,6}\s*\/\s*\d{2,4}/g, " ")
    .replace(/\(.*?\)/g, " ");
  return stripped
    .split(/\s+נ['׳"]?\s+|\s+נגד\s+/)
    .map((p) => p.replace(/[״"'׳]/g, "").trim())
    .filter((p) => p.length >= 3)
    .slice(0, 2);
}

/**
 * Bounded, non-hardcoded query variants for one nominated canonical authority.
 * Variants are ordered strongest-identity first; only the first
 * `MAX_QUERIES_PER_AUTHORITY` are actually issued.
 */
export function buildAuthorityQueryVariants(auth: {
  label: string;
  docket?: string | null;
  court?: string | null;
}): string[] {
  const label = String(auth.label ?? "").trim();
  const docket = String(auth.docket ?? "").trim();
  const parties = partyNamesFromLabel(label);
  const prefixMatch = label.match(/^([א-ת]{2,4}["'׳״]?)\s*\d/);
  const prefix = prefixMatch ? prefixMatch[1] : "";
  const court = auth.court ?? (/בג["'׳״]?ץ|ע["'׳״]?א|דנ["'׳״]?א/.test(label) ? "בית המשפט העליון" : null);
  const out: string[] = [];
  const push = (s: string) => {
    const q = s.replace(/\s+/g, " ").trim();
    if (q.length >= 6 && !out.includes(q)) out.push(q);
  };
  if (docket) {
    push(`${prefix} ${docket} ${parties[0] ?? ""} פסק דין מלא`);
    push(`${docket} ${label}`);
    push(`${docket} ${court ?? ""} נוסח פסק הדין`);
  }
  push(label);
  if (parties.length) push(`${parties.join(" נ' ")} ${docket} פסק דין`);
  if (court) push(`${court} ${parties[0] ?? label}`);
  push(`${docket || label} court.gov.il פסק דין`);
  return out;
}

export interface CanonicalRegistryDiscoveryInput {
  // deno-lint-ignore no-explicit-any
  admin?: any;
  registry: CoreAuthorityRegistryResult;
  candidates: Candidate[];
  integrity: IntegrityLogRow[];
  run_id?: string | null;
  /** 0 disables the stage. Clamped to MAX_AUTHORITIES. */
  max_authorities?: number;
  budget?: {
    exceeded(): boolean;
    remaining(): number;
    mark(name: string, detail?: Record<string, unknown>): void;
  };
  markDurable?: (name: string, detail?: Record<string, unknown>) => Promise<unknown> | unknown;
  /** Injected for tests. */
  search?: typeof searchOfficialJudgmentUrls;
}

const JUDGMENT_ROLES = new Set(["binding_case_law", "persuasive_case_law", "applying_case_law"]);

function candidateText(c: Candidate): string {
  const md = (c.metadata ?? {}) as Record<string, unknown>;
  const ext = typeof md.extended_text === "string" ? md.extended_text : "";
  return `${ext}\n${c.snippet ?? ""}`;
}

function poolHasBody(candidates: Candidate[], d: DocketRef): boolean {
  for (const c of candidates) {
    const identity = textContainsExactDocket(c.title, d) ||
      textContainsExactDocket(String(c.source_url ?? ""), d);
    if (!identity) continue;
    const md = (c.metadata ?? {}) as Record<string, unknown>;
    const integ = md.source_integrity as SourceIntegrity | undefined;
    const usability = String(integ?.text_usability ?? md.text_usability ?? "");
    if (/listing|metadata|unusable|none/i.test(usability)) continue;
    if (/full_text|substantive_excerpt/.test(usability)) return true;
    if (candidateText(c).trim().length >= 900) return true;
  }
  return false;
}

function emptyReport(
  skip_reason: string | null,
  doctrine_id: string | null = null,
): CanonicalRegistryDiscoveryReport {
  return {
    version: CANONICAL_REGISTRY_DISCOVERY_VERSION,
    enabled: skip_reason === null,
    skip_reason,
    doctrine_id,
    authorities_considered: [],
    authorities_queried: [],
    queries: [],
    selections: [],
    discovered_urls: [],
    candidate_count: 0,
    local_bodies_injected: [],
    ms: 0,
  };
}

/**
 * Screen one discovered URL for this authority. Guessed court URLs and listing
 * pages are rejected before any fetch; a URL that came from a *targeted* search
 * for this exact docket on an official host is allowed through even when the
 * search result carried no title, because identity is proven inside the body.
 */
export function screenCanonicalCandidate(
  url: string,
  title: string,
  docket: DocketRef,
  authorityName: string,
  unverifiedOfficialUsed: number,
): CanonicalDiscoveryCandidateSelection {
  const host = hostOf(url);
  const row: CanonicalDiscoveryCandidateSelection = {
    authority_name: authorityName,
    docket: normalizedDocketId(docket),
    candidate_url: url,
    candidate_host: host,
    selected_for_fetch: false,
    rejected_before_fetch: true,
    rejection_reason: null,
    docket_evidence: "none",
  };
  if (!host) {
    row.rejection_reason = "unparsable_url";
    return row;
  }
  if (isGuessedCourtUrl(url)) {
    row.rejection_reason = "guessed_court_url";
    return row;
  }
  const path = pathOf(url);
  if (LISTING_PATH_RE.test(path) && !/download|doc|file|verdict/i.test(path)) {
    row.rejection_reason = "listing_page";
    return row;
  }
  if (textContainsExactDocket(title, docket)) row.docket_evidence = "title";
  else if (textContainsExactDocket(url, docket)) row.docket_evidence = "url";
  else if (
    OFFICIAL_HOST_RE.test(host) &&
    unverifiedOfficialUsed < CANONICAL_REGISTRY_DISCOVERY_LIMITS.MAX_UNVERIFIED_OFFICIAL_PER_AUTHORITY
  ) {
    row.docket_evidence = "official_host_targeted";
  } else {
    row.rejection_reason = "no_exact_docket_evidence";
    return row;
  }
  row.selected_for_fetch = true;
  row.rejected_before_fetch = false;
  return row;
}

export async function runCanonicalRegistryDiscovery(
  input: CanonicalRegistryDiscoveryInput,
): Promise<CanonicalRegistryDiscoveryReport> {
  const t0 = Date.now();
  const reg = input.registry;
  if (!reg?.triggered) return emptyReport("registry_not_triggered");
  const cap = Math.max(
    0,
    Math.min(
      input.max_authorities ?? CANONICAL_REGISTRY_DISCOVERY_LIMITS.MAX_AUTHORITIES,
      CANONICAL_REGISTRY_DISCOVERY_LIMITS.MAX_AUTHORITIES,
    ),
  );
  if (cap === 0) return emptyReport("authority_cap_zero", reg.doctrine_id);

  const report = emptyReport(null, reg.doctrine_id);
  const remainingMs = () => {
    const stage = CANONICAL_REGISTRY_DISCOVERY_LIMITS.TOTAL_MS - (Date.now() - t0);
    const outer = input.budget ? input.budget.remaining() : Number.POSITIVE_INFINITY;
    return Math.min(stage, outer);
  };
  if (input.budget?.exceeded() || remainingMs() < CANONICAL_REGISTRY_DISCOVERY_LIMITS.MIN_BUDGET_MS) {
    report.enabled = false;
    report.skip_reason = "retrieval_budget_low";
    report.ms = Date.now() - t0;
    return report;
  }

  const doctrine = DOCTRINE_REGISTRY.find((d) => d.doctrine_id === reg.doctrine_id);
  const byId = new Map<string, CanonicalAuthority>(
    (doctrine?.canonical_authorities ?? []).map((a) => [a.authority_id, a]),
  );

  const targets: Array<{ auth: CanonicalAuthority; docket: DocketRef }> = [];
  for (const tel of reg.authorities) {
    const auth = byId.get(tel.authority_id);
    if (!auth) continue;
    if (auth.kind !== "case" || auth.expected_source_type !== "case") continue;
    if (!JUDGMENT_ROLES.has(String(auth.role))) continue;
    const d = detectDockets(`${auth.label} ${auth.docket ?? ""}`)[0];
    if (!d) continue;
    report.authorities_considered.push(auth.authority_id);
    if (poolHasBody(input.candidates, d)) continue;
    targets.push({ auth, docket: d });
  }
  const queue = targets.slice(0, cap);
  if (queue.length === 0) {
    report.skip_reason = report.authorities_considered.length === 0
      ? "no_eligible_canonical_authority"
      : "already_body_acquired";
    report.ms = Date.now() - t0;
    return report;
  }

  await input.markDurable?.("canonical_registry_discovery_start", {
    authorities: queue.map((q) => q.auth.authority_id),
  });

  const searchFn = input.search ?? searchOfficialJudgmentUrls;

  for (const { auth, docket } of queue) {
    if (input.budget?.exceeded()) break;
    if (remainingMs() < CANONICAL_REGISTRY_DISCOVERY_LIMITS.MIN_BUDGET_MS) break;
    const tA = Date.now();
    const variants = buildAuthorityQueryVariants({ label: auth.label, docket: auth.docket ?? null });
    const row: CanonicalRegistryDiscoveryQuery = {
      run_id: input.run_id ?? null,
      authority_name: auth.label,
      docket: auth.docket ?? normalizedDocketId(docket),
      jurisdiction: "IL",
      expected_role: String(auth.role),
      query_variants: variants.slice(0, CANONICAL_REGISTRY_DISCOVERY_LIMITS.MAX_QUERIES_PER_AUTHORITY),
      discovery_lane: "none",
      candidate_count: 0,
      candidate_urls: [],
      candidate_hosts: [],
      local_attempted: false,
      local_doc_id: null,
      local_body_chars: 0,
      skip_reason: null,
      http_status: null,
      ms: 0,
    };
    report.authorities_queried.push(auth.authority_id);

    // ── 1. Local corpus first ────────────────────────────────────────────
    if (input.admin) {
      row.local_attempted = true;
      try {
        const local = await resolveLocalJudgmentAnchor(input.admin, {
          label: auth.label,
          docket_display: auth.docket ?? null,
        });
        const hit = pickLocalDoc(local.docs, docket);
        if (hit) {
          row.local_doc_id = hit.id;
          row.local_body_chars = hit.content.length;
          row.discovery_lane = "local_corpus";
          const injected = injectLocalCanonicalBody(input, auth, docket, hit);
          if (injected) report.local_bodies_injected.push(injected);
          row.ms = Date.now() - tA;
          report.queries.push(row);
          continue;
        }
      } catch (e) {
        row.skip_reason = `local_lookup_failed:${
          (e instanceof Error ? e.message : String(e)).slice(0, 100)
        }`;
      }
    }

    // ── 2. Targeted official web discovery ───────────────────────────────
    row.discovery_lane = "official_web_search";
    let unverifiedOfficial = 0;
    const accepted: DiscoveredJudgmentUrl[] = [];
    for (const q of row.query_variants) {
      if (accepted.length >= CANONICAL_REGISTRY_DISCOVERY_LIMITS.MAX_CANDIDATES_PER_AUTHORITY) break;
      if (input.budget?.exceeded() || remainingMs() < 3_000) break;
      const res = await searchFn({
        label: q,
        docket_display: auth.docket ?? null,
        timeout_ms: Math.min(
          CANONICAL_REGISTRY_DISCOVERY_LIMITS.SEARCH_MS,
          Math.max(3_000, remainingMs()),
        ),
      });
      row.http_status = res.http ?? row.http_status;
      if (res.skip_reason && !row.skip_reason) row.skip_reason = res.skip_reason;
      const urls = [...res.official_urls, ...res.mirror_urls];
      for (const u of urls) {
        if (accepted.some((a) => a.url === u.url)) continue;
        if (report.selections.some((s) => s.candidate_url === u.url && s.authority_name === auth.label)) {
          continue;
        }
        const sel = screenCanonicalCandidate(u.url, u.title, docket, auth.label, unverifiedOfficial);
        report.selections.push(sel);
        if (!sel.selected_for_fetch) continue;
        if (sel.docket_evidence === "official_host_targeted") unverifiedOfficial++;
        accepted.push({
          url: u.url,
          title: `${auth.label} ${u.title ?? ""}`.trim(),
          discovery_source: "canonical_registry_discovery",
        });
        if (accepted.length >= CANONICAL_REGISTRY_DISCOVERY_LIMITS.MAX_CANDIDATES_PER_AUTHORITY) break;
      }
    }
    row.candidate_count = accepted.length;
    row.candidate_urls = accepted.map((a) => a.url);
    row.candidate_hosts = accepted.map((a) => hostOf(a.url));
    row.ms = Date.now() - tA;
    report.queries.push(row);
    report.discovered_urls.push(...accepted);
  }

  report.candidate_count = report.discovered_urls.length;
  report.ms = Date.now() - t0;
  await input.markDurable?.("canonical_registry_discovery_done", {
    authorities: report.authorities_queried.length,
    candidates: report.candidate_count,
    local_injected: report.local_bodies_injected.length,
  });
  return report;
}

/** Pick the local row whose body actually proves the exact docket. */
function pickLocalDoc(docs: LocalDoc[], docket: DocketRef): LocalDoc | null {
  let best: LocalDoc | null = null;
  for (const d of docs) {
    const body = String(d.content ?? "");
    if (body.length < CANONICAL_REGISTRY_DISCOVERY_LIMITS.MIN_LOCAL_BODY_CHARS) continue;
    const identity = textContainsExactDocket(body.slice(0, 20_000), docket) ||
      textContainsExactDocket(`${d.title} ${d.citation ?? ""}`, docket);
    if (!identity) continue;
    if (!best || body.length > best.content.length) best = d;
  }
  return best;
}

/**
 * Inject a local canonical judgment body as an ordinary candidate. Identity was
 * proven inside the stored body; classification and every downstream gate run
 * exactly as for any other candidate.
 */
export function injectLocalCanonicalBody(
  input: { candidates: Candidate[]; integrity: IntegrityLogRow[] },
  auth: CanonicalAuthority,
  docket: DocketRef,
  doc: LocalDoc,
): string | null {
  const stored = String(doc.content ?? "").slice(
    0,
    CANONICAL_REGISTRY_DISCOVERY_LIMITS.MAX_LOCAL_TEXT,
  );
  if (stored.length < CANONICAL_REGISTRY_DISCOVERY_LIMITS.MIN_LOCAL_BODY_CHARS) return null;
  const candidate_id = `canonical-registry-local:${auth.authority_id}`;
  if (input.candidates.some((c) => c.candidate_id === candidate_id)) return null;
  const base = input.candidates[0];
  const injected: Candidate = {
    candidate_id,
    claim_id: base?.claim_id ?? "C1",
    role: auth.role,
    origin: "local",
    retrieval_method: "local_exact",
    title: doc.title || auth.label,
    source_type: doc.source_type || "caselaw",
    source_url: doc.source_url ?? null,
    snippet: stored.slice(0, 800),
    query_he: auth.query_he,
    score: 1,
    expected_source_type: "case",
    metadata: {},
  } as Candidate;

  const integ = classifySourceIntegrity({
    title: injected.title,
    url: injected.source_url,
    snippet: injected.snippet,
    source_type: injected.source_type,
    role: injected.role,
  });
  integ.text_usability = (stored.length >= 1200
    ? "full_text"
    : "substantive_excerpt") as SourceIntegrity["text_usability"];
  integ.citable_as = "judgment";
  integ.is_judgment_document = true;
  integ.reject = false;
  delete integ.reject_reason;
  integ.integrity_flags = [
    ...(integ.integrity_flags ?? []),
    "canonical_authority_local_body",
  ];

  injected.metadata = {
    source_integrity: integ,
    extended_text: stored,
    exact_docket_match: true,
    docket_match: true,
    body_acquired: true,
    text_usability: integ.text_usability,
    usable_for_holding: true,
    local_document_id: doc.id,
    canonical_authority_id: auth.authority_id,
    canonical_authority_docket: normalizedDocketId(docket),
    canonical_registry_discovery: CANONICAL_REGISTRY_DISCOVERY_VERSION,
  };

  input.candidates.unshift(injected);
  input.integrity.push({
    candidate_id,
    title: injected.title,
    url: injected.source_url ?? null,
    role: String(injected.role),
    original_source_type: String(injected.source_type),
    authority_tier: integ.authority_tier,
    text_usability: String(integ.text_usability),
    citable_as: String(integ.citable_as),
    integrity_flags: integ.integrity_flags ?? [],
    can_satisfy_role: true,
    is_judgment_document: true,
    has_holding_text: !!integ.has_holding_text,
    synthesis_role: "leading_candidate",
    synthesis_role_seeded_from: "canonical_registry_discovery",
    synthesis_role_overridden: false,
  } as IntegrityLogRow);
  return candidate_id;
}
