// =========================================================================
// sourcesOnly.ts — build the response payload for the "חיפוש מקורות" mode.
//
// Reuses the candidate pool + verifier output from legal-research-v1.
// Skips the drafter entirely. Produces a grouped + ranked source list
// suitable for the LegalSourceSearchPanel UI.
//
// Also builds a SECONDARY "additional sources for inspection" list from
// selected perplexity-dropped + verifier-tangential candidates. Sources-only
// mode only — the answer pipeline is not affected.
// =========================================================================

import type {
  Candidate,
  DroppedCandidate,
  DroppedSource,
  SourceRole,
  SupportLevel,
  UsableCandidate,
  Verdict,
} from "./types.ts";

export type SourcesOnlyOrigin = "local_db" | "perplexity";
export type SourcesOnlySupport = "direct" | "partial";
export type SourceTier = "recommended" | "additional";

export type UrlValidationState = "ok" | "unreachable" | "unverified";

export interface SourceResult {
  rank: number;
  title: string;
  url: string | null;
  source_type: string;
  role: SourceRole;
  origin: SourcesOnlyOrigin;
  support: SourcesOnlySupport;
  role_match: boolean;
  reason: string;
  supported_claim_ids: string[];
  snippet: string | null;
  display_citation: string | null;
  tier?: SourceTier; // "additional" only set for secondary list entries
  // URL liveness validation (sources_only mode, perplexity-origin only).
  url_validation_state?: UrlValidationState;
  url_status?: string;
  url_unreachable?: boolean;
}

export type SourceGroupKey =
  | "primary_statute"
  | "binding_case_law"
  | "persuasive_case_law"
  | "scholarship"
  | "legislative_history"
  | "government_report"
  | "other";

export const SOURCE_GROUP_ORDER: SourceGroupKey[] = [
  "primary_statute",
  "binding_case_law",
  "persuasive_case_law",
  "scholarship",
  "legislative_history",
  "government_report",
  "other",
];

export interface SourcesOnlySummary {
  total_candidates: number;
  verified: number;
  usable: number;
  dropped: number;
  local_count: number;
  perplexity_count: number;
  additional_count: number;
  url_checks_failed?: number;
  url_checks_unverified?: number;
}

export interface SourcesOnlyPayload {
  mode: "sources_only";
  question: string;
  run_id: string;
  sources: SourceResult[];
  groups: Record<SourceGroupKey, SourceResult[]>;
  additional_sources: SourceResult[];
  additional_groups: Record<SourceGroupKey, SourceResult[]>;
  summary: SourcesOnlySummary;
}

// ─── Display-group classifier (URL / title / source_type) ─────────────────
//
// Independent of the planner's requested role. Used for BOTH the main list
// and the additional list, so a חוק stays under חקיקה even when the planner
// requested a different role, and an IDI article never lands under חקיקה.

function host(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function pathOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

const SUPREME_HOSTS = new Set([
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
  "elyon1.court.gov.il",
  "versa.cardozo.yu.edu",
]);
const COURT_HOSTS_SUFFIX = ["court.gov.il"];
const KNESSET_HOSTS = new Set([
  "main.knesset.gov.il",
  "knesset.gov.il",
  "fs.knesset.gov.il",
]);
const IDI_HOSTS = ["idi.org.il"];
const JOURNAL_HOSTS = ["heinonline.org", "jstor.org", "ssrn.com", "papers.ssrn.com"];
const ACADEMIC_SUFFIX = [".ac.il", "academia.edu"];
const STATE_COMPTROLLER_HOSTS = ["mevaker.gov.il"];

const SUPREME_DOCKET_RE = /\b(?:בג"?ץ|בג״ץ|דנג"?ץ|דנג״ץ|רע"?א|רע״א|דנ"?א|דנ״א|בש"?פ|בש״פ)\s*\d{1,5}\/\d{2,4}\b/;
const ANY_DOCKET_RE = /\b(?:ע"?א|ע״א|ע"?פ|ע״פ|ת"?א|ת״א|ה"?פ|ה״פ|פ"?ה|פ״ה|ב"?ל|ב״ל)\s*\d{1,5}\/\d{2,4}\b/;
const STATUTE_TITLE_RE = /^(?:\s*)(?:חוק[- ]יסוד|חוק\b|תקנות\b|פקודת\b|פקודה\b|צו\b|הצעת\s+חוק)/;
const KNESSET_PROCESS_RE = /(פרוטוקול|ועדת|ועדה|הצעת\s+חוק|דברי\s+הסבר|דיון|קריאה\s+ראשונה|קריאה\s+שניה|טרומית)/;

export function classifyDisplayGroup(args: {
  title: string;
  url: string | null;
  source_type?: string | null;
  role?: SourceRole | null;
  source_class?: string | null; // from candidate.metadata.classified_source_class (perplexity)
}): SourceGroupKey {
  const title = (args.title || "").trim();
  const url = args.url || "";
  const h = host(url);
  const p = pathOf(url);
  const st = (args.source_type || "").toLowerCase();
  const sc = (args.source_class || "").toLowerCase();

  // ── Case law ──
  const supremeByHost = SUPREME_HOSTS.has(h);
  const supremeByDocket = SUPREME_DOCKET_RE.test(title);
  if (supremeByHost || supremeByDocket) return "binding_case_law";

  const courtHost = COURT_HOSTS_SUFFIX.some((s) => h.endsWith(s));
  if (courtHost && /(district|magistrate|labor|shalom|mehozi|אזורי|מחוזי|שלום)/i.test(`${h} ${p}`)) {
    return "persuasive_case_law";
  }
  if (st === "case" || ANY_DOCKET_RE.test(title)) {
    return supremeByDocket ? "binding_case_law" : "persuasive_case_law";
  }

  // ── Primary statute / regulation ──
  const titleLooksLikeLaw = STATUTE_TITLE_RE.test(title);
  const urlLooksLikeLaw =
    /\/law(_html|_word)?\//.test(p) ||
    /\/legislation\//.test(p) ||
    /nevo\.co\.il\/.+\/law/.test(`${h}${p}`);
  if (titleLooksLikeLaw || urlLooksLikeLaw || st === "statute" || st === "regulation" || sc === "legislation") {
    return "primary_statute";
  }

  // ── Legislative history (Knesset process) ──
  if (KNESSET_HOSTS.has(h) || h.endsWith(".knesset.gov.il")) {
    if (titleLooksLikeLaw) return "primary_statute";
    return "legislative_history";
  }
  if (KNESSET_PROCESS_RE.test(title)) return "legislative_history";

  // ── Scholarship / opinion ──
  if (
    IDI_HOSTS.some((s) => h === s || h.endsWith("." + s)) ||
    JOURNAL_HOSTS.some((s) => h === s || h.endsWith("." + s)) ||
    ACADEMIC_SUFFIX.some((s) => h.endsWith(s)) ||
    /law[-_]?review|mishpatim|hapraklit|iyunei|mehkarei|tzedek|tarbut/.test(`${h}${p}`) ||
    /lawreview|jlas|jurist|blog\b/.test(h)
  ) {
    return "scholarship";
  }
  if (st === "academic" || sc === "academic" || sc === "publisher" || sc === "discovery_only") {
    // discovery_only is overwhelmingly law-firm blogs / forums / journals.
    return "scholarship";
  }

  // ── State Comptroller / official reports ──
  if (STATE_COMPTROLLER_HOSTS.some((s) => h === s || h.endsWith("." + s))) return "government_report";
  if (h.endsWith(".gov.il") || h === "gov.il") {
    if (titleLooksLikeLaw) return "primary_statute";
    return "government_report";
  }
  if (st === "report" || sc === "government_report") return "government_report";

  return "other";
}

const SUPPORT_RANK: Record<SourcesOnlySupport, number> = { direct: 0, partial: 1 };

function pickBestVerdict(
  candidateId: string,
  verdicts: Verdict[],
): Verdict | null {
  const mine = verdicts.filter((v) => v.candidate_id === candidateId);
  if (mine.length === 0) return null;
  const order = { direct: 0, partial: 1, tangential: 2, unrelated: 3 } as Record<SupportLevel, number>;
  mine.sort((a, b) => {
    if (order[a.support] !== order[b.support]) return order[a.support] - order[b.support];
    if (a.role_match !== b.role_match) return a.role_match ? -1 : 1;
    return (b.reason?.length ?? 0) - (a.reason?.length ?? 0);
  });
  return mine[0] ?? null;
}

function candidateSourceClass(c: Candidate): string | null {
  const m = c.metadata && typeof c.metadata === "object" ? (c.metadata as Record<string, unknown>) : null;
  const v = m?.classified_source_class;
  return typeof v === "string" ? v : null;
}

function candidateDisplayCitation(c: Candidate): string | null {
  const m = c.metadata && typeof c.metadata === "object" ? (c.metadata as Record<string, unknown>) : null;
  const v = m?.citation;
  return typeof v === "string" ? v : null;
}

// ─── Drop-reason → sanitized Hebrew label ─────────────────────────────────
//
// Never expose raw drop_reason codes in user-facing UI.

const UNRELATED_DROP_REASONS = new Set<string>([
  "verdict_unrelated",
  "verdict_unrelated_dominant",
]);

const WIKIPEDIA_RE = /wikipedia\.org$/i;

function isDropReasonAdmissible(reason: string): boolean {
  // Strip optional "followup:" prefix.
  const r = reason.startsWith("followup:") ? reason.slice("followup:".length) : reason;
  if (r === "discovery_only") return true;
  if (r.startsWith("class_unknown_not_admitted_")) return true;
  if (r.startsWith("class_academic_not_admitted_")) return true;
  if (r.startsWith("class_publisher_not_admitted_")) return true;
  return false;
}

function reasonLabel(reason: string): string {
  const r = reason.startsWith("followup:") ? reason.slice("followup:".length) : reason;
  if (r === "discovery_only") return "מקור עיוני/דיוני — לא דורג כמקור מאומת";
  if (r.startsWith("class_unknown_not_admitted_")) return "מקור עיוני אפשרי — לא אומת";
  if (r.startsWith("class_academic_not_admitted_")) return "מקור אקדמי — מחוץ לסיווג שהתבקש";
  if (r.startsWith("class_publisher_not_admitted_")) return "מאמר/הוצאה לאור — מחוץ לסיווג שהתבקש";
  return "מקור משלים לבדיקה";
}

// ─── Normalization for dedup ──────────────────────────────────────────────

function normUrl(u: string | null | undefined): string {
  if (!u) return "";
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "").toLowerCase()}${x.pathname.replace(/\/$/, "").toLowerCase()}`;
  } catch {
    return (u || "").trim().toLowerCase();
  }
}

function normTitle(t: string | null | undefined): string {
  return (t || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function dedupKey(s: { url: string | null; title: string }): string {
  const u = normUrl(s.url);
  if (u) return `u:${u}`;
  return `t:${normTitle(s.title)}`;
}

// ─── Roles ────────────────────────────────────────────────────────────────

const VALID_ROLES: SourceRole[] = [
  "primary_statute",
  "regulation",
  "binding_case_law",
  "persuasive_case_law",
  "scholarship",
  "factual_report",
  "government_report",
];

function roleOrDefault(r: string | undefined | null, fallback: SourceRole = "scholarship"): SourceRole {
  if (r && (VALID_ROLES as string[]).includes(r)) return r as SourceRole;
  return fallback;
}

// ─── Builder input ────────────────────────────────────────────────────────

export interface BuildSourcesOnlyInput {
  question: string;
  run_id: string;
  candidates: Candidate[];
  usable: UsableCandidate[];
  verdicts: Verdict[];
  candidates_verified: number;
  candidates_usable: number;
  candidates_dropped: number;
  // Optional inputs for the secondary "additional" list. Provided only by
  // the sources_only branch of index.ts — the answer pipeline never calls
  // this builder.
  perplexityDropped?: DroppedSource[];
  verifierDropped?: DroppedCandidate[];
}

// ─── Group + rank ──────────────────────────────────────────────────────────

const ORIGIN_RANK: Record<SourcesOnlyOrigin, number> = { local_db: 0, perplexity: 1 };

function emptyGroups(): Record<SourceGroupKey, SourceResult[]> {
  return {
    primary_statute: [],
    binding_case_law: [],
    persuasive_case_law: [],
    scholarship: [],
    legislative_history: [],
    government_report: [],
    other: [],
  };
}

function groupAndRank(
  items: SourceResult[],
  startingRank = 1,
): { sources: SourceResult[]; groups: Record<SourceGroupKey, SourceResult[]> } {
  const groups = emptyGroups();
  for (const s of items) {
    const g = classifyDisplayGroup({
      title: s.title,
      url: s.url,
      source_type: s.source_type,
      role: s.role,
    });
    groups[g].push(s);
  }
  for (const k of SOURCE_GROUP_ORDER) {
    groups[k].sort((a, b) => {
      if (SUPPORT_RANK[a.support] !== SUPPORT_RANK[b.support]) {
        return SUPPORT_RANK[a.support] - SUPPORT_RANK[b.support];
      }
      if (a.role_match !== b.role_match) return a.role_match ? -1 : 1;
      if (ORIGIN_RANK[a.origin] !== ORIGIN_RANK[b.origin]) {
        return ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
      }
      return 0;
    });
  }
  const sources: SourceResult[] = [];
  let r = startingRank;
  for (const k of SOURCE_GROUP_ORDER) {
    for (const s of groups[k]) {
      s.rank = r++;
      sources.push(s);
    }
  }
  return { sources, groups };
}

// ─── Additional sources (secondary list) ──────────────────────────────────

const ADDITIONAL_CAP = 15;

function buildAdditionalSources(
  input: BuildSourcesOnlyInput,
  excludeKeys: Set<string>,
): SourceResult[] {
  const out: SourceResult[] = [];
  const seen = new Set<string>(excludeKeys);

  // (1) Perplexity dropped — discovery_only / class_* admit-list.
  for (const d of input.perplexityDropped ?? []) {
    const reason = d.drop_reason || "";
    if (!isDropReasonAdmissible(reason)) continue;
    if (!d.url) continue;
    if (WIKIPEDIA_RE.test(host(d.url))) continue;
    if (!d.title || d.title.trim().length < 3) continue;

    const k = dedupKey({ url: d.url, title: d.title });
    if (seen.has(k)) continue;
    seen.add(k);

    out.push({
      rank: 0,
      title: d.title.trim(),
      url: d.url,
      source_type: "other",
      role: roleOrDefault(d.role),
      origin: "perplexity",
      support: "partial",
      role_match: false,
      reason: reasonLabel(reason),
      supported_claim_ids: [],
      snippet: null,
      display_citation: null,
      tier: "additional",
    });
  }

  // (2) Verifier dropped — tangential only (never unrelated/bad).
  const candById = new Map(input.candidates.map((c) => [c.candidate_id, c] as const));
  for (const d of input.verifierDropped ?? []) {
    if (d.worst_support !== "tangential") continue;
    const cand = candById.get(d.candidate_id);
    if (!cand) continue;
    if (cand.source_url && WIKIPEDIA_RE.test(host(cand.source_url))) continue;
    // Skip if for some reason this candidate was also in usable (defensive).
    if (UNRELATED_DROP_REASONS.has(d.reason || "")) continue;

    const k = dedupKey({ url: cand.source_url ?? null, title: cand.title });
    if (seen.has(k)) continue;
    seen.add(k);

    out.push({
      rank: 0,
      title: cand.title,
      url: cand.source_url ?? null,
      source_type: cand.source_type,
      role: cand.role,
      origin: cand.origin === "perplexity" ? "perplexity" : "local_db",
      support: "partial",
      role_match: false,
      reason: "רלוונטיות חלקית בלבד",
      supported_claim_ids: [],
      snippet: cand.snippet ?? null,
      display_citation: candidateDisplayCitation(cand),
      tier: "additional",
    });

    if (out.length >= ADDITIONAL_CAP * 2) break; // soft cap before final cap
  }

  // Final cap.
  return out.slice(0, ADDITIONAL_CAP);
}

// ─── Public entry ─────────────────────────────────────────────────────────

export function buildSourcesOnlyPayload(input: BuildSourcesOnlyInput): SourcesOnlyPayload {
  const candById = new Map(input.candidates.map((c) => [c.candidate_id, c] as const));

  // Main list — exactly verifier.usable, regrouped by actual nature.
  const main: SourceResult[] = [];
  const mainKeys = new Set<string>();
  for (const u of input.usable) {
    const cand = candById.get(u.candidate_id);
    if (!cand) continue;
    const support: SourcesOnlySupport =
      u.best_support === "direct" || u.best_support === "partial" ? u.best_support : "partial";

    const verdict = pickBestVerdict(u.candidate_id, input.verdicts);
    const reason = verdict?.reason?.trim() || "";

    const origin: SourcesOnlyOrigin = cand.origin === "perplexity" ? "perplexity" : "local_db";

    const sr: SourceResult = {
      rank: 0,
      title: cand.title,
      url: cand.source_url ?? null,
      source_type: cand.source_type,
      role: cand.role,
      origin,
      support,
      role_match: u.role_match,
      reason,
      supported_claim_ids: u.verdict_claim_ids,
      snippet: cand.snippet ?? null,
      display_citation: candidateDisplayCitation(cand),
      tier: "recommended",
    };
    main.push(sr);
    mainKeys.add(dedupKey({ url: sr.url, title: sr.title }));
  }

  const mainGrouped = groupAndRank(main, 1);

  // Additional list — discovery_only / class_* perplexity drops + verifier
  // tangentials. Deduped against the main list.
  const addRaw = buildAdditionalSources(input, mainKeys);
  const addGrouped = groupAndRank(addRaw, mainGrouped.sources.length + 1);

  let local_count = 0;
  let perplexity_count = 0;
  for (const s of mainGrouped.sources) {
    if (s.origin === "local_db") local_count++;
    else perplexity_count++;
  }

  return {
    mode: "sources_only",
    question: input.question,
    run_id: input.run_id,
    sources: mainGrouped.sources,
    groups: mainGrouped.groups,
    additional_sources: addGrouped.sources,
    additional_groups: addGrouped.groups,
    summary: {
      total_candidates: input.candidates.length,
      verified: input.candidates_verified,
      usable: input.candidates_usable,
      dropped: input.candidates_dropped,
      local_count,
      perplexity_count,
      additional_count: addGrouped.sources.length,
    },
  };
}
