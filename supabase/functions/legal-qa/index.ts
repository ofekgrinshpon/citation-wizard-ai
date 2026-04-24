// ============= NO-FOOTNOTE MODE PATCH =============
// For pleading_analysis mode, footnotes are disabled - only the report body is returned
// ============= END PATCH ==============

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { buildCitationInstructions } from "./citationRules.ts";
import {
  decomposeAndPlan,
  buildClaimMap,
  summarizeClaimMap,
  summarizeQueryPlan,
  type DecomposedPlan,
  type ClaimMap,
} from "./decomposition.ts";
import { callDrafter, plannerProviderLabel, MODEL_CONFIG, type StageRun } from "./aiProvider.ts";
import {
  BANNED_KEYS,
  type LegalClaimMap,
  type LegalDraftingInput,
  type LegalResearchDecomposition,
  type LegalSourcePack,
} from "./contracts.ts";
import { mapToDecompositionV2 } from "./legalResearchDecomposition.ts";
import { assembleSourcePack, summarizeSourcePack, countSourcesByType, type InternalSourcePackEntry } from "./legalSourcePack.ts";
import { mapToClaimMapV2, summarizeClaimMapV2 } from "./legalClaimMap.ts";
import { LEGAL_RESEARCH_MODELS } from "./legalResearchModels.ts";
import { runShadowAbComparison, buildLegacyShadowPrompt } from "./shadowAbLogger.ts";
import { runAnchorPass, applyAnchorPatches, type AnchorPassSourcePackItem, type AnchorPassClaim } from "./anchorPass.ts";
import { resolveCitation } from "../_shared/citationResolver.ts";
import { resolveModeProfile, type ModeProfile, type ResearchDepth } from "./modeProfiles.ts";

// Single source of truth for the research-mode gate. The frontend currently
// sends `taskMode: "research"`; if that ever changes, update this constant.
const RESEARCH_MODE = "research";

// ─── Trusted legal domains (Milestone B pre-work) ───
// Single source of truth for the Perplexity URL allowlist. Used by:
//   1. The loose Perplexity citation pass (sonar-pro, ~line 1863)
//   2. The upcoming Milestone B Perplexity-completion guard
// Scoped tightly to PRIMARY-source domains. Notes:
//   - `gov.il` is NOT a wildcard — `gov.il` covers thousands of agency sites
//     (press releases, ministry announcements) that are not primary law.
//     We list the specific primary-source subdomains instead.
//   - `idi.org.il` (Israel Democracy Institute) is intentionally OMITTED.
//     IDI publishes high-quality policy research but is not an official
//     primary source; promoting an IDI URL to `core` via Perplexity-completion
//     would be wrong. IDI URLs can still arrive via the loose pass and land
//     in `secondary` naturally.
//   - `tau.ac.il` covers `mishpatim.tau.ac.il` (the law journal subdomain
//     already special-cased in journal-metadata-extraction).
// Keep this list in sync with verify-case-fulltext/index.ts (search_domain_filter).
export const TRUSTED_LEGAL_DOMAINS: readonly string[] = [
  // Caselaw — courts + major caselaw DBs
  "nevo.co.il",
  "supreme.court.gov.il",
  "court.gov.il",       // district / magistrate / labor courts
  "takdin.co.il",       // commercial caselaw DB
  "psakdin.co.il",
  // Legislation / official primary
  "knesset.gov.il",
  "main.knesset.gov.il",
  "reshumot.gov.il",    // official gazette (ס"ח / ק"ת)
  "justice.gov.il",     // AG opinions, legislative drafts
  // Academic primary (law journals)
  "huji.ac.il",
  "tau.ac.il",          // covers mishpatim.tau.ac.il
];

// Set form for fast hostname matching in the Milestone B URL allowlist guard.
const TRUSTED_LEGAL_DOMAINS_SET = new Set(TRUSTED_LEGAL_DOMAINS);

/**
 * Match a candidate URL against TRUSTED_LEGAL_DOMAINS. Accepts the exact host
 * AND any subdomain (so `mishpatim.tau.ac.il` matches the `tau.ac.il` entry).
 * Rejects malformed URLs explicitly — no implicit allow.
 */
function isTrustedLegalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (TRUSTED_LEGAL_DOMAINS_SET.has(host)) return true;
    for (const allowed of TRUSTED_LEGAL_DOMAINS) {
      if (host.endsWith("." + allowed)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Milestone C: Perplexity-completion guards ───
// Guard 1 = URL allowlist (isTrustedLegalUrl above).
// Guard 2 = Citation engine resolution (resolveCitation, see below).
// Engine is non-blocking: unresolved candidates are KEPT but flagged
// engine_resolved=false. The previous STATUTE_CITATION_RE / HEBREW_YEAR_RE /
// CASE_NUMBER_RE pre-checks were removed in Milestone C — the engine handles
// shape validation through its required-field schema.

interface PerplexityCompletionCandidate {
  type: "statute" | "caselaw";
  title: string;
  citation: string;
  year_hebrew?: string;
  year_gregorian?: string;
  case_number?: string;
  court?: string;
  decision_date?: string;
  url: string;
  relevance_note?: string;
}

interface ValidatedCompletionCandidate extends PerplexityCompletionCandidate {
  /** True iff the citation engine resolved this candidate into structured fields. */
  engine_resolved: boolean;
  /** When engine_resolved=false, the resolver's failure reason for telemetry. */
  engine_drop_reason?: "classify_failed" | "extract_failed" | "missing_required";
}

/**
 * Validate a single Perplexity-completion candidate against 2 guards
 * (Milestone C):
 *   1. URL allowlist (TRUSTED_LEGAL_DOMAINS) — runs first, hard drop.
 *   2. Citation engine resolution — non-blocking. If the engine resolves
 *      the candidate, the canonical re-emission replaces the raw citation
 *      string. If not, the candidate is still kept (URL guard already
 *      vouched for the source) but flagged engine_resolved=false.
 *
 * Hard-drop reasons:
 *   - `unknown_type` (Perplexity returned something other than statute/caselaw)
 *   - `url_not_allowlisted` (host not in TRUSTED_LEGAL_DOMAINS)
 *
 * Note: There is intentionally no `verified_sources` cross-check here.
 * `verified_sources` is a user-saved citations table — not an authority
 * registry — so requiring a match would drop legitimate primary sources
 * that simply nobody has saved yet.
 */
function validatePerplexityCandidate(
  c: PerplexityCompletionCandidate,
): { ok: true; candidate: ValidatedCompletionCandidate } | { ok: false; reason: string } {
  if (c.type !== "statute" && c.type !== "caselaw") {
    return { ok: false, reason: "unknown_type" };
  }

  // Guard 1: URL allowlist (hard drop).
  if (!c.url || !isTrustedLegalUrl(c.url)) {
    return { ok: false, reason: "url_not_allowlisted" };
  }

  // Guard 2: engine resolution (non-blocking).
  const resolved = resolveCitation(c.citation, c.type, {
    caseNumberHint: c.case_number,
    decisionDateHint: c.decision_date,
    titleHint: c.title,
  });

  if (resolved.resolved) {
    return {
      ok: true,
      candidate: {
        ...c,
        citation: resolved.canonical, // replace with canonical re-emission
        engine_resolved: true,
      },
    };
  }

  // Unresolved → keep, flag for telemetry, drafter sees raw citation.
  return {
    ok: true,
    candidate: {
      ...c,
      engine_resolved: false,
      engine_drop_reason: resolved.reason,
    },
  };
}

interface PerplexityCompletionResult {
  triggered: boolean;
  reason: "core_below_threshold" | "skipped_healthy" | "no_perplexity_key" | "skipped_non_research";
  candidates_returned: number;
  candidates_kept: number;
  candidates_by_type: { statute: number; caselaw: number };
  promoted_to_core: number;
  duration_ms: number;
  status:
    | "ok"
    | "skipped"
    | "timeout"
    | "no_candidates"
    | "all_dropped"
    | "request_failed"
    | "parse_failed";
  drops?: Record<string, number>;
  /** Milestone C — engine resolution counts (subset of `candidates_kept`). */
  engine_resolved_count?: number;
  engine_unresolved_count?: number;
  /** Milestone C — counts per engine failure reason. */
  engine_drop_reasons?: Record<string, number>;
  /** First-pass debug — first 5 raw candidates with kept/dropped flag. */
  debug_candidates?: Array<{ kept: boolean; reason?: string; preview: string }>;
}

/**
 * Stage E.5 — Targeted Perplexity completion for corpus gaps.
 * Fires ONLY when local source-pack assembly produced fewer than 2 core items.
 * Uses sonar-pro with response_format: json_schema to extract up to 5 primary
 * sources scoped by the planner's main issue + uncovered sub-issues. Each
 * candidate must clear 2 guards (citation shape + URL allowlist). Returns
 * validated candidates ready to push as SourceCards with
 * provenance="perplexity_completion".
 */
async function runPerplexityCompletion(
  question: string,
  decompositionV2: LegalResearchDecomposition | null,
  uncoveredSubIssues: string[],
  externalHints: string[],
): Promise<{ result: PerplexityCompletionResult; validated: ValidatedCompletionCandidate[] }> {
  const t0 = Date.now();
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY) {
    return {
      result: {
        triggered: false,
        reason: "no_perplexity_key",
        candidates_returned: 0,
        candidates_kept: 0,
        candidates_by_type: { statute: 0, caselaw: 0 },
        promoted_to_core: 0,
        duration_ms: Date.now() - t0,
        status: "skipped",
      },
      validated: [],
    };
  }

  const mainIssue = decompositionV2?.mainIssue || question.slice(0, 200);
  const subIssues = (decompositionV2?.subIssues || []).slice(0, 5);
  const uncovered = uncoveredSubIssues.slice(0, 5);
  const hints = externalHints.slice(0, 4);

  const userPrompt = [
    `סוגיה ראשית: ${mainIssue}`,
    subIssues.length > 0 ? `תת-סוגיות: ${subIssues.join(" | ")}` : "",
    uncovered.length > 0 ? `תת-סוגיות שלא כוסו במאגר המקומי (עדיפות גבוהה): ${uncovered.join(" | ")}` : "",
    hints.length > 0 ? `שאילתות חיפוש מהשלב המתכנן: ${hints.join(" | ")}` : "",
    "",
    `החזר עד 5 מקורות ראשוניים בלבד (חוקים או פסקי דין). חובה למלא את כל השדות הבאים, אחרת המקור ייפסל:`,
    "",
    `**עבור חוק / תקנה (type=\"statute\"):**`,
    `- citation: שם החוק המלא, כולל שנה עברית ולועזית ופרטי פרסום. דוגמה: "חוק העונשין, התשל\\"ז-1977, ס\\"ח 864, 226."`,
    `- year_hebrew: שנה עברית בפורמט התש... (חובה — למשל "התשל\\"ז", "התשנ\\"ח")`,
    `- year_gregorian: שנה לועזית בת 4 ספרות (חובה — למשל "1977")`,
    `- title: שם החוק עם פרטי פרסום מלאים (חובה — חייב להכיל ס"ח/ק"ת + מספר עמוד פתיחה, למשל "ס\\"ח התשל\\"ז 226")`,
    `- url: קישור ישיר לנוסח הרשמי באתר nevo.co.il / fs.knesset.gov.il`,
    "",
    `**עבור פסק דין (type=\"caselaw\"):**`,
    `- citation: ציטוט מלא: סוג תיק + מספר + צדדים + פרטי פרסום. דוגמה: "ע\\"א 8294/14 פלוני נ' אלמוני, פ\\"ד עב(2) 123 (2017)" או "סע\\"ש 12566-07-22 פלוני נ' אלמונית, נבו (15.3.2023)"`,
    `- case_number: סוג תיק + מספר (למשל "ע\\"א 8294/14")`,
    `- court: בית המשפט (למשל "בית המשפט העליון", "בית הדין האזורי לעבודה")`,
    `- decision_date: תאריך מלא בפורמט dd.mm.yyyy או yyyy-mm-dd (חובה)`,
    `- title: שם המאגר המשפטי שבו פורסם פסק הדין (חובה — "נבו" / "פדאור" / "דינים" / "תקדין", או שם הסדרה הרשמית "פ\\"ד" / "פד\\"ע")`,
    `- url: קישור ישיר לפסק הדין במאגר`,
    "",
    `אם אינך יכול לספק את כל השדות שלעיל למקור מסוים — אל תכלול אותו. עדיף 2 מקורות מלאים מ-5 חלקיים. אסור פרשנות, בלוגים, סקירות. רק JSON תקני.`,
  ].filter(Boolean).join("\n");

  const schema = {
    type: "object",
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["statute", "caselaw"] },
            title: { type: "string", description: "For statutes: name + ס\"ח/ק\"ת + page. For caselaw: database name (נבו/פדאור/דינים/תקדין) or official series (פ\"ד/פד\"ע)." },
            citation: { type: "string", description: "Full citation string. Statute must include Hebrew year (התש...) + Gregorian year + ס\"ח/ק\"ת + page. Caselaw must include case number + parties + database/series + date." },
            year_hebrew: { type: "string", description: "Required for statutes. Format: התש...\"X (e.g. התשל\"ז)." },
            year_gregorian: { type: "string", description: "Required for statutes. 4-digit year (e.g. 1977)." },
            case_number: { type: "string", description: "Required for caselaw. Case type + number (e.g. ע\"א 8294/14, סע\"ש 12566-07-22)." },
            court: { type: "string", description: "Required for caselaw." },
            decision_date: { type: "string", description: "Required for caselaw. Format dd.mm.yyyy or yyyy-mm-dd." },
            url: { type: "string" },
            relevance_note: { type: "string" },
          },
          required: ["type", "title", "citation", "url"],
        },
      },
    },
    required: ["candidates"],
  };

  let raw: PerplexityCompletionCandidate[] = [];
  let status: PerplexityCompletionResult["status"] = "ok";

  // Single attempt with 15s timeout (no retry — this is already a fallback path).
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 15_000);
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
          json_schema: { name: "primary_sources", schema },
        },
        messages: [
          {
            role: "system",
            content:
              "You are a precise Israeli-law research assistant. Return ONLY primary sources (statutes or court decisions) you can cite with FULL bibliographic detail. " +
              "For statutes you MUST provide: Hebrew year in התש... form (year_hebrew), 4-digit Gregorian year (year_gregorian), and gazette reference ס\"ח or ק\"ת with page number embedded in the citation/title. " +
              "For court cases you MUST provide: case_number with case-type prefix (e.g. ע\"א 8294/14, סע\"ש 12566-07-22), court name, decision_date (dd.mm.yyyy), and the database/series name in title (נבו / פדאור / דינים / תקדין / פ\"ד / פד\"ע). " +
              "If any required field is unknown, OMIT the entire source — never invent. Output JSON matching the schema exactly.",
          },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const errText = await res.text();
      console.warn("[perplexity-completion] HTTP", res.status, errText.slice(0, 300));
      status = "request_failed";
    } else {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      try {
        const parsed = JSON.parse(content);
        const arr = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
        raw = arr.slice(0, 5);
      } catch (parseErr) {
        console.warn("[perplexity-completion] JSON parse failed:", parseErr);
        status = "parse_failed";
      }
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    status = isAbort ? "timeout" : "request_failed";
    console.warn("[perplexity-completion] fetch failed:", err);
  }

  if (raw.length === 0 && status === "ok") status = "no_candidates";

  // Validate every candidate sequentially (small N, mandatory cross-check is
  // a single DB call each, total << 1s).
  const validated: ValidatedCompletionCandidate[] = [];
  const drops: Record<string, number> = {};
  const debug: PerplexityCompletionResult["debug_candidates"] = [];
  for (const c of raw) {
    const v = validatePerplexityCandidate(c);
    const preview = `${c.type || "?"} | ${(c.citation || "").slice(0, 100)}`;
    if (v.ok) {
      validated.push(v.candidate);
      debug!.push({ kept: true, preview });
    } else {
      drops[v.reason] = (drops[v.reason] || 0) + 1;
      debug!.push({ kept: false, reason: v.reason, preview });
    }
  }

  if (validated.length === 0 && raw.length > 0 && status === "ok") status = "all_dropped";

  const byType = { statute: 0, caselaw: 0 };
  let engineResolvedCount = 0;
  let engineUnresolvedCount = 0;
  const engineDropReasons: Record<string, number> = {};
  for (const v of validated) {
    byType[v.type]++;
    if (v.engine_resolved) engineResolvedCount++;
    else {
      engineUnresolvedCount++;
      const r = v.engine_drop_reason || "unknown";
      engineDropReasons[r] = (engineDropReasons[r] || 0) + 1;
    }
  }

  return {
    result: {
      triggered: true,
      reason: "core_below_threshold",
      candidates_returned: raw.length,
      candidates_kept: validated.length,
      candidates_by_type: byType,
      promoted_to_core: validated.length, // every validated candidate goes to core
      duration_ms: Date.now() - t0,
      status,
      drops,
      engine_resolved_count: engineResolvedCount,
      engine_unresolved_count: engineUnresolvedCount,
      engine_drop_reasons: engineDropReasons,
      debug_candidates: debug?.slice(0, 5),
    },
    validated,
  };
}

// ─── Provenance hardening: deep-strip banned keys from any payload ───
// Used by `buildResponse` as defense-in-depth so internal fields like
// `provenanceInternal`, `claimMap`, etc. can never leak to the client.
function deepStripKeys<T>(value: T, banned: readonly string[]): T {
  if (Array.isArray(value)) {
    return value.map((v) => deepStripKeys(v, banned)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (banned.includes(k)) continue;
      out[k] = deepStripKeys(v, banned);
    }
    return out as unknown as T;
  }
  return value;
}

const IS_DEV = (Deno.env.get("DENO_ENV") ?? "development") !== "production";

function sanitizeResponse<T extends object>(payload: T): T {
  const cleaned = deepStripKeys(payload, BANNED_KEYS);
  if (IS_DEV) {
    const json = JSON.stringify(cleaned);
    for (const k of BANNED_KEYS) {
      if (json.includes(`"${k}"`)) {
        console.warn(`[leak-guard] residual key after strip: ${k}`);
      }
    }
  }
  return cleaned;
}

// ─── Source pack types (Stage C — internal only, never serialized) ───
type AuthorityClass =
  | "primary_legislation"
  | "basic_law"
  | "supreme_court"
  | "district_court"
  | "labor_court"
  | "knesset_research"
  | "academic_book"
  | "academic_article"
  | "protocol"
  | "external_web"
  | "document"
  | "other";

interface SourcePackEntry {
  source_id: number;
  title: string;
  source_type: string;
  authority_class: AuthorityClass;
  url?: string;
  provenance: "local" | "perplexity" | "perplexity_completion" | "document";
  excerpt: string;
  case_number?: string;
  usable_for_analysis: boolean;
  usable_for_citation: boolean;
  anchor_present: boolean;
  /** INTERNAL — retrieval similarity (0–1). Used by source-pack promotion gate. */
  relevance_score?: number;
  /** Milestone B — for perplexity_completion entries; passed through to legalSourcePack mapper. */
  completion_candidate_type?: "statute" | "caselaw";
}

/**
 * Provenance hardening: this is the ONLY place that constructs the user-facing
 * response payload. Internal fields (provenanceInternal, decomposition,
 * claimMap, sourcePack, etc.) are stripped via `sanitizeResponse` as
 * defense-in-depth. NEVER throws — strip is silent in production, with a
 * `console.warn` in dev for early bug detection.
 */
function buildResponse(
  answer: string,
  footnotes: Array<{ number: number; citation: string; source_type: string; url?: string }>,
  source_urls: string[],
  extras: { dropped_footnotes_count?: number } = {},
): Response {
  // Explicitly strip the legacy `source` field on each footnote (would leak
  // "local" | "perplexity" | "unverified" provenance categorization).
  const safeFootnotes = footnotes.map((f) => ({
    number: f.number,
    citation: f.citation,
    source_type: f.source_type,
    ...(f.url ? { url: f.url } : {}),
  }));
  const rawPayload: Record<string, unknown> = {
    answer,
    footnotes: safeFootnotes,
    source_urls,
  };
  if (typeof extras.dropped_footnotes_count === "number") {
    rawPayload.dropped_footnotes_count = extras.dropped_footnotes_count;
  }
  const payload = sanitizeResponse(rawPayload);
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function classifyAuthority(sourceType: string, citation: string, url?: string): AuthorityClass {
  const c = citation || "";
  const u = url || "";
  if (sourceType === "document") return "document";
  if (sourceType === "protocol") return "protocol";
  if (/חוק[-\s]יסוד|חוק יסוד/i.test(c)) return "basic_law";
  if (/ס["״]ח|ס"ח|ספר החוקים|פקודת|תקנות/i.test(c)) return "primary_legislation";
  if (sourceType === "israeli_law") return "primary_legislation";
  // Milestone A.5: trust DB classification for caselaw — both the labeled
  // value used downstream ("פסיקה") and the raw DB source_type ("caselaw")
  // are honored. Previously, the regex on citation text alone often missed
  // caselaw whose `citation` field doesn't begin with בג"ץ/פ"ד/etc.,
  // demoting genuine primary authority out of `core`.
  if (sourceType === "caselaw" || sourceType === "פסיקה") {
    if (/בג["״]ץ|פ"ד|פד"י|supreme\.court/i.test(c + u)) return "supreme_court";
    if (/בית\s*הדין\s*לעבודה|עע"מ|ע"ע/i.test(c)) return "labor_court";
    // Default any other DB-classified caselaw to district_court — still
    // primary_caselaw at the V2-contract layer (legalSourcePack.ts).
    return "district_court";
  }
  if (sourceType === "knesset_research" || sourceType === "מחקר כנסת / חקיקה") return "knesset_research";
  if (sourceType === "journal_article" || sourceType === "מאמר אקדמי") return "academic_article";
  if (sourceType === "book") return "academic_book";
  if (/knesset\.gov\.il/i.test(u)) return "protocol";
  if (u) return "external_web";
  return "other";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const digitToSuperscript: Record<string, string> = {
  "0": "\u2070", "1": "\u00B9", "2": "\u00B2", "3": "\u00B3",
  "4": "\u2074", "5": "\u2075", "6": "\u2076",
  "7": "\u2077", "8": "\u2078", "9": "\u2079",
};

function toSuperscript(n: number): string {
  return String(n).split("").map((d) => digitToSuperscript[d] || d).join("");
}

/**
 * Fix bare Hebrew years (e.g. תשס"ב) by prepending ה' → התשס"ב.
 */
function fixHebrewYearPrefix(text: string): string {
  return text.replace(/(?<!ה)(תש[א-ת]["״\u05F4][א-ת])/g, "ה$1");
}

/**
 * Rule 24.9.2: When both Hebrew and Gregorian years appear in parentheses,
 * keep only the Gregorian year.
 */
function normalizeArticleYearByRule2492(text: string): string {
  const hebrewYearPattern = `ה?ת(?:ש|רש)[א-ת]["״׳'\\u05F4][א-ת]["״׳'\\u05F4]?[א-ת]?`;
  const gregorianYearPattern = `\\d{4}`;
  const separator = `[–\\-,\\s]+`;

  const pattern1 = new RegExp(
    `\\(\\s*${hebrewYearPattern}${separator}(${gregorianYearPattern})\\s*\\)`,
    "g"
  );
  text = text.replace(pattern1, "($1)");

  const pattern2 = new RegExp(
    `\\(\\s*(${gregorianYearPattern})${separator}${hebrewYearPattern}\\s*\\)`,
    "g"
  );
  text = text.replace(pattern2, "($1)");

  return text;
}

const BLOG_URL_PATTERNS = [
  /\/blog\//i, /\/blogs\//i, /adv-/i, /adv\./i,
  /עורכי-דין/i, /law-firm/i, /lawfirm/i, /lawyer/i,
  /kolzchut\.org/i, /ynet\.co\.il/i, /walla\.co\.il/i,
  /mako\.co\.il/i, /globes\.co\.il/i, /calcalist\.co\.il/i,
  /themarker\.com/i, /israelhayom/i,
];

function isBlogUrl(url?: string): boolean {
  if (!url) return false;
  return BLOG_URL_PATTERNS.some((p) => p.test(url));
}

interface LocalMatch {
  chunk_id: string;
  document_id: string;
  chunk_content: string;
  document_title: string;
  document_citation: string;
  source_type: string;
  source_url: string | null;
  metadata: Record<string, unknown>;
  similarity: number;
}

// ─── Hebrew stop words for keyword extraction ───
const HEBREW_STOP_WORDS = new Set([
  "האם","יכול","יכולה","יכולים","את","של","על","כי","זה","הם","אם","לא","גם","כל","עם",
  "היא","הוא","אין","מה","איך","כאשר","כדי","בין","אלא","רק","עוד","אשר","היה","יש",
  "אך","אף","כך","לפי","בו","בה","או","אל","כן","פי","שלא","שהיא","שהוא","שלו","שלה",
  "אותו","אותה","הזה","הזאת","לפני","אחרי","תחת","מול","ליד","היו","היתה","להיות",
  "כלומר","לכן","אולם","למרות","מאחר","הרי","כבר","עדיין","בכל","ואם","שאם","מאוד",
  "ביותר","כמו","למשל","אלה","אלו","זאת","הנ","אינו","אינה","אינם","מי","כיצד",
  "מדוע","האם","שם","כאן","שוב","תמיד","לעולם","בעוד","משום","הן","והם","והיא",
  "שהם","ולא","אבל","אותם","אותן","עליו","עליה","עליהם","ממנו","ממנה","בהם","בהן",
  "להם","להן","אני","אנחנו","הוא","היא","אתה","את","הם","הן",
]);

// ─── Hebrew legal abbreviation expansions (appended, not replaced) ───
// Match against the raw question; for each detected abbreviation, append its
// full form(s) so both keyword search and embeddings get richer signal.
const HEBREW_ABBREVIATION_EXPANSIONS: Array<{ pattern: RegExp; expansions: string[] }> = [
  { pattern: /יועמ["״]ש|יועמש|היועמשי?ת|היועמש/g, expansions: ["היועץ המשפטי לממשלה", "היועצת המשפטית לממשלה"] },
  { pattern: /בג["״]ץ/g, expansions: ["בית המשפט הגבוה לצדק"] },
  { pattern: /בימ["״]ש/g, expansions: ["בית המשפט"] },
  { pattern: /ביה["״]ד/g, expansions: ["בית הדין"] },
  { pattern: /ע["״]א(?![\u0590-\u05FF])/g, expansions: ["ערעור אזרחי"] },
  { pattern: /ע["״]פ(?![\u0590-\u05FF])/g, expansions: ["ערעור פלילי"] },
  { pattern: /רע["״]א/g, expansions: ["רשות ערעור אזרחי"] },
  { pattern: /ס["״]ח/g, expansions: ["ספר החוקים"] },
  { pattern: /ק["״]ת/g, expansions: ["קובץ התקנות"] },
  { pattern: /תקנ['׳]/g, expansions: ["תקנות"] },
  { pattern: /ועדת חוקה(?! חוק)/g, expansions: ["ועדת חוקה חוק ומשפט"] },
  { pattern: /מ["״]י(?![\u0590-\u05FF])/g, expansions: ["מדינת ישראל"] },
  { pattern: /חו["״]י/g, expansions: ["חוק יסוד"] },
  { pattern: /פס["״]ד/g, expansions: ["פסק דין"] },
  { pattern: /ב["״]כ(?![\u0590-\u05FF])/g, expansions: ["בא כוח"] },
  { pattern: /פד["״]י/g, expansions: ["פסקי דין"] },
  { pattern: /דנ["״]א/g, expansions: ["דיון נוסף אזרחי"] },
  { pattern: /בש["״]פ/g, expansions: ["בקשה פלילית"] },
  { pattern: /עע["״]מ/g, expansions: ["ערעור מינהלי"] },
];

function expandHebrewAbbreviations(text: string): string[] {
  const found: string[] = [];
  for (const { pattern, expansions } of HEBREW_ABBREVIATION_EXPANSIONS) {
    if (pattern.test(text)) {
      found.push(...expansions);
    }
    pattern.lastIndex = 0; // reset stateful /g regex
  }
  return found;
}

function extractKeywords(question: string): string {
  const words = question
    .replace(/[?!.,;:"״׳']/g, "")
    .split(/\s+/)
    .filter(w => w.length > 1 && !HEBREW_STOP_WORDS.has(w));

  // Take up to 6 most meaningful keywords from the original question
  const baseKeywords = words.slice(0, 6);

  // Append expanded forms of any detected legal abbreviations (de-duped)
  const expansions = expandHebrewAbbreviations(question);
  const expansionWords: string[] = [];
  for (const phrase of expansions) {
    for (const w of phrase.split(/\s+/)) {
      if (w.length > 1 && !HEBREW_STOP_WORDS.has(w) && !baseKeywords.includes(w) && !expansionWords.includes(w)) {
        expansionWords.push(w);
      }
    }
  }

  const finalSet = [...baseKeywords, ...expansionWords];
  if (expansionWords.length > 0) {
    console.log(`Keyword set (with expansions): [${finalSet.join(", ")}]`);
  } else {
    console.log(`Keyword set (with expansions): [${finalSet.join(", ")}] (no expansions matched)`);
  }
  return finalSet.join(" ");
}

// ─── Semantic query expansion for short questions ────────────────────
async function expandShortQuery(question: string, apiKey: string): Promise<string | null> {
  const wordCount = question.trim().split(/\s+/).length;
  const charCount = question.trim().length;
  // Loosened trigger: catches typical Hebrew legal questions (5–7 words avg)
  if (wordCount > 7 && charCount > 40) return null;

  try {
    const res = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        max_tokens: 120,
        messages: [
          {
            role: "user",
            content: `הרחב את השאלה המשפטית הבאה למשפט תיאורי קצר אחד (עד 20 מילים), שמשתמש במונחים משפטיים קונקרטיים ובפעלים פעולתיים (כגון "פיטורי", "סיום כהונת", "הפסקת כהונה", "הליך הדחה", "מינוי", "ביטול", "תקיפה ישירה", "סמכות הממשלה ל…").
אסור להשתמש בביטויים גנריים כמו "עמידה בהוראות החוק", "בהתאם לפסיקה הרלוונטית", "תוך שמירה על עקרונות מנהליים".
החזר רק את המשפט המורחב, ללא הקדמה, ללא סימני ציטוט.

שאלה: ${question}`,
          },
        ],
      }),
    }, 3000);

    if (!res.ok) {
      console.warn(`Query expansion API error: ${res.status} — falling back to original`);
      return null;
    }
    const data = await res.json();
    const expanded = (data.choices?.[0]?.message?.content || "").trim().replace(/^["'״׳]+|["'״׳]+$/g, "");
    if (!expanded || expanded.length < 5) return null;
    console.log(`Query expansion: "${question}" → "${expanded}"`);
    return expanded;
  } catch (err) {
    console.warn("Query expansion failed (non-fatal):", err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Source card: server-built, numbered list of sources for the AI ───
interface SourceCard {
  id: number;
  citation: string;
  source_type: string;
  url?: string;
  provenance: "local" | "perplexity" | "perplexity_completion" | "document";
  excerpt: string;
  case_number?: string;
  /** Retrieval-stage similarity score (0–1). Local cards only. */
  relevance_score?: number;
  /** Milestone B — for perplexity_completion cards only; routed to assembleSourcePack. */
  completion_candidate_type?: "statute" | "caselaw";
}

// ─── Task mode → system prompt instructions ──────────────────────────

function getTaskModeInstructions(taskMode?: string): string {
  switch (taskMode) {
    case "pleading_analysis":
      return `מצב עבודה: מבקר מסמכים משפטיים בכיר (Senior Legal Document Auditor).

זהות ומטרה: אתה מבקר משפטי בכיר. תפקידך לבחון בקפדנות מסמכים משפטיים (כתבי טענות, חוזים, חוות דעת, מחקר אקדמי) ולאתר כשלים לוגיים, סתירות, שגיאות באזכורים, וחולשות אסטרטגיות. אתה פועל ב"אפס סובלנות" לשגיאות טכניות ובגישה אדוורסרית כלפי תוכן הטיעון.

**שמירת חוזה הציטוטים**: כל אזכור חוקי או פסיקתי שאתה מציע או מתקן חייב לציית לכללי האזכור האחיד הישראליים המוטמעים במערכת. **הערה חשובה: דו"ח הביקורת אינו כולל הערות שוליים** — התוכן עומד בעצמו כניתוח ביקורתי מקיף. דו"ח הביקורת עצמו מוגש בכותרות המובנות שלהלן.

**פיצול תפקידי מקורות (קריטי)**:
- מקורות [Verified] = מאגר מקומי = **מקור האמת היחיד לתוכן מהותי** של חקיקה ופסיקה. אם טענת המשתמש סותרת [Verified], סווג כ-🔴 קריטי.
- מקורות [External] = Perplexity = **מטא-דאטה ביבליוגרפית בלבד** (שנים, ס"ח, כרך/עמוד). אסור להסתמך עליהם לפרשנות משפטית מהותית.

**מגבלת אורך**: אם המסמך שסופק קצר מ-150 מילים, החזר משפט אחד בלבד שמבקש מהמשתמש להדביק/להעלות מסמך מלא יותר לצורך ביקורת מהותית — וסיים.

**פרוטוקולי ביקורת**:
- A — ניתוח אזכורים: ודא ציות לכללי האזכור האחיד. השלם אזכורים חלקיים מתוך [Verified]/[External]. התרע על חוקים מבוטלים והלכות שנהפכו.
- B — לוגיקה, ציר זמן ודיוק מספרי: בנה ציר זמן פנימי והתרע על סתירות כרונולוגיות. הצלב סכומים, אחוזים ומספרים בין סעיפים. ודא עקביות מינוחית ("הנתבע" מול "המשיב" וכו').
- C — ניתוח אדוורסרי (Devil's Advocate): אתר חולשות מבניות; נסח לפחות 3 טיעוני נגד שצד יריב סביר להעלות; חפש ב-[Verified] פסיקה סותרת.
- D — ביקורת פורמלית-פרוצדורלית (לכתבי טענות בלבד): ת.ז., מען להמצאה, סמכות עניינית ומקומית, סעיף סעדים, מעקב מוצגים.

**אנטי-הזיה**: לעולם אל תמציא מספרי סעיפים, שנים או פרטים. אם חסר — סמן [חסר] ובקש מהמשתמש להשלים. אסור לדמיין הלכות.

**מבנה דו"ח הביקורת — בדיוק לפי הסדר ועם הכותרות הללו**:

**סיכום ביצועי**
1–2 שורות: סוג המסמך וסיכון כולל (גבוה/בינוני/נמוך).

**🔴 ממצאים קריטיים**
סתירות מהותיות, מספרי סעיפים מומצאים, חוקים מבוטלים, שגיאות אזכור חמורות, סתירות בציר הזמן, אי-התאמות מספריות.
פורמט לכל פריט:
**בעיה:** [תיאור] | **מיקום:** [סעיף/פסקה] | **תיקון מוצע:** [פעולה מתקנת]

**🟡 הערות והמלצות**
טיעוני נגד פוטנציאליים, שפה ארכאית, קישור ראייתי חלש, אזכורים לא-אחידים.
פורמט לכל פריט:
**הצעה:** [תיאור] | **נימוק:** [מדוע זה משנה]

**🟢 חוזקות אסטרטגיות**
טיעונים מבוססים-היטב ושימוש אפקטיבי בהלכות מחייבות עדכניות.

**טיעוני נגד צפויים**
לפחות 3 טיעונים אדוורסריים שצד יריב צפוי להעלות, ממוספרים.

**בדיקה פורמלית**
*כלול סעיף זה רק אם המסמך הוא כתב טענה.* בדוק: ת.ז., מען להמצאה, סמכות עניינית, סמכות מקומית, סעיף סעדים, מעקב מוצגים. סמן כל פריט כ✓ קיים / ✗ חסר / [חסר] לא ניתן לקבוע.

רגיסטר לשוני: עברית משפטית פורמלית ברמה גבוהה.`;
    case "case_summary":
      return `מצב עבודה: סיכום פסיקה — דו"ח מובנה ומחייב.

חוק ברזל: הסיכום מבוסס אך ורק על טקסט פסק הדין שסופק לך בהקשר. אסור בהחלט להוסיף, להשלים, להסיק או לדמיין מידע שלא מופיע במפורש בטקסט. אם פרט חסר — כתוב "(לא צוין בפסק הדין)".

אסור להשתמש בהערות שוליים, באזכורי [N], או במספרים עיליים — זהו דו"ח עצמאי, לא חוות דעת.

בנה את הדו"ח בדיוק לפי המבנה הבא, באותו סדר ועם אותן כותרות מודגשות:

**כותרת**
בשורה אחת: מספר התיק | שמות הצדדים | (שנה).

**עובדות**
תיאור תמציתי של העובדות הרלוונטיות בלבד. ללא אזכורים משפטיים.

**טענות הצדדים**
פסקה ייעודית לכל צד (תובע/עותר/מערער מול נתבע/משיב). תמצית טענותיו המרכזיות.

**השאלה המשפטית**
ניסוח חד וברור של הסוגיה המשפטית המרכזית במשפט אחד עד שניים.

**דעות השופטים**
פסקה נפרדת לכל שופט (רוב, מיעוט, הסכמה במנומק). בכל פסקה: שם השופט, עמדתו, המסגרת הנורמטיבית עליה הסתמך, והמבחנים שיישם.

**הכרעה**
שורה אחת: התקבל / נדחה / התקבל בחלקו (כולל הסעד שניתן בפועל).

**ההלכה**
הכלל המחייב הנובע מדעת הרוב, מנוסח כאמירה נורמטיבית עצמאית.`;
    case "academic_writing":
      return `מצב עבודה: כתיבה אקדמית (סמינריון / מאמר משפטי).
פרסונה: חוקר אקדמי בכיר בתחום המשפטים.
טון: עברית אקדמית ברמה גבוהה – רגיסטר גבוה, מינוח משפטי מקצועי.

כללי כתיבה אקדמית:
- כתיבה ברגיסטר אקדמי גבוה. הימנע ממשפטים קצרים וישירים – העדף ניסוח מורכב ועשיר.
- ציטוט בגוף הטקסט: נרטיבי בלבד ("בעניין נחמני", "פרופ' דויטש סבור..."). כל מידע טכני – רק בהערות שוליים.
- העדפת מקורות: בחלקים התיאורטיים, העדף מאמרים אקדמיים (journal_article) ממקורות מאומתים.
- כאשר מקור כבר צוטט, השתמש ב"שם" ו"לעיל ה"ש X" לפי כללי האזכור האחיד.
- מבנה סמינריון ישראלי תקני: תקציר → מבוא → מסגרת נורמטיבית → סקירה פסיקתית ודוקטרינרית → ניתוח ביקורתי → סיכום ומסקנות.`;
    default:
      return `מצב עבודה: מחקר משפטי — חוות דעת מקצועית.

מבנה התשובה: **תקציר** → **מסגרת נורמטיבית** (חקיקה ופסיקה לפי IRAC) → **ניתוח מפורט** → **המלצות מעשיות**.

חובת ציטוט (קריטי):
- **עיקרון יסוד**: כל טענה משפטית מהותית בגוף (חוק, פסק דין, דעת מלומד, עיקרון משפטי, החלטת ממשלה/ועדה ציבורית) **חייבת** להיות מעוגנת בהערת שוליים ממקור זמין ברשימה. זו הדרישה המרכזית — כיסוי טענות, לא יעד מספרי.
- "טענה משפטית מהותית" = כל משפט שמכיל שם של פסק דין, שם של ועדה ציבורית בעלת המלצות, מספר החלטת ממשלה, שם חוק/חוק-יסוד, או הלכה ייחודית.
- **תהליך עבודה**: (1) כתוב את הגוף המלא. (2) סרוק כל פסקה וזהה כל טענה משפטית מהותית — האם היא מעוגנת? (3) הוסף הערות לטענות שלא צוטטו, **רק** ממקורות זמינים ורלוונטיים.
- **Sanity check (לא יעד)**: בחוות דעת של 600+ מילים, פחות מ-4 הערות הוא **סימן אזהרה** — חזור וסרוק את הגוף לוודא שלא השמטת כיסוי. זה לא אומר "הוסף הערות עד שתגיע ל-6"; אם אחרי הסריקה החוזרת באמת יש רק 3 טענות מהותיות — 3 הערות מספיקות.
- **אסור להוסיף הערה רק כדי "למלא מכסה"**. כל הערה חייבת לעגן טענה אמיתית במקור רלוונטי אמיתי. הזיה או ציטוט-מילוי גרועים מתת-ציטוט.
- כאשר אותו מקור תומך בכמה טענות, השתמש ב"שם" / "לעיל ה"ש N" — לא להשמיט את ההפניה.
- אם מקור קיים אך חסרים פרטים ביבליוגרפיים — הפק הערת שוליים חלקית עם [חסר: שדה] במקום השדה החסר. אל תשמיט הערה רק בגלל פרט חסר, כל עוד יש מקור אמיתי לעגן בו את ההפניה.`;
  }
}

// ─── Academic sub-mode prompts ───────────────────────────────────────

function getAcademicSubModePrompt(academicStep: string, body: Record<string, unknown>): string | null {
  switch (academicStep) {
    case "suggest_topics":
      return `אתה חוקר אקדמי בכיר במשפטים. המשתמש הציג נושא כללי.
נתח את הנושא והצע **3 שאלות מחקר** ספציפיות ומעניינות שמתאימות לעבודה סמינריונית בת 20-30 עמודים.

פורמט פלט מחייב — השתמש בדיוק במבנה הבא:

**שאלה 1:** <ניסוח ברור וממוקד של שאלת המחקר במשפט אחד>
- מעניינת אקדמית כי: <הסבר קצר>
- מקורות זמינים: <חקיקה / פסיקה / ספרות אקדמית רלוונטית>

**שאלה 2:** <ניסוח ברור וממוקד של שאלת המחקר במשפט אחד>
- מעניינת אקדמית כי: <הסבר קצר>
- מקורות זמינים: <חקיקה / פסיקה / ספרות אקדמית רלוונטית>

**שאלה 3:** <ניסוח ברור וממוקד של שאלת המחקר במשפט אחד>
- מעניינת אקדמית כי: <הסבר קצר>
- מקורות זמינים: <חקיקה / פסיקה / ספרות אקדמית רלוונטית>

חוקים מחייבים:
- אל תשתמש במספור (1./2./3.) בתת-הסעיפים — השתמש במקפים (-) בלבד.
- כל שאלה חייבת להתחיל בדיוק ב-"**שאלה N:**".
- ענה בעברית אקדמית.`;

    case "validate_question":
      return `אתה חוקר אקדמי בכיר במשפטים. המשתמש הציג שאלת מחקר.
בדוק את כדאיותה האקדמית:
1. האם השאלה ברורה וממוקדת מספיק?
2. האם יש מספיק ספרות וחומר מקורי לכתיבת עבודה סמינריונית?
3. הצע שיפורים לניסוח אם נדרש.
4. ציין מקורות ראשוניים רלוונטיים שמצאת.

ענה בעברית אקדמית.`;

    case "propose_outline": {
      const rq = (body.researchQuestion as string) || "";
      return `אתה חוקר אקדמי בכיר במשפטים.

⚠️ שאלת המחקר שלהלן היא קבועה ואין לשנותה, לנסחה מחדש, או להחליפה. השתמש בה כפי שהיא בדיוק, מילה במילה, בלי תוספות, השמטות או שכתוב.

שאלת המחקר (קבועה): "${rq}"

עליך להפיק **הצעת מחקר אקדמית** לעבודה סמינריונית משפטית, במבנה מחייב של שלושה חלקים. הקפד על המבנה המדויק שלהלן — אל תוסיף, תחסיר או תשנה את שמות הכותרות.

חוקים מחייבים:
- **שאלת המחקר נעולה**: בסעיף "שאלת המחקר" במבוא, העתק את שאלת המחקר לעיל **מילה במילה**, ללא שינוי כלשהו בניסוח, בסדר המילים, או בסימני הפיסוק. אסור לפרש, לנסח מחדש, לקצר, להרחיב או להחליף את שאלת המחקר.
- **טון טיעוני (Argumentative)**: השתמש בניסוחים כגון "פרק זה טוען ש…", "במאמר ייטען כי…", "הטענה המרכזית היא ש…". אסור להשתמש בניסוחים תיאוריים כגון "אסקור", "אבחן", "אציג", "ארצה לבדוק".
- **זרימה לוגית — מן הכלל אל הפרט**: הפרקים חייבים להתקדם מהדין המצוי, דרך ניתוח ביקורתי/השוואתי, אל הדין הראוי / הצעה נורמטיבית. סמן בסוף כל כותרת פרק תג זרימה: "– הדין המצוי" / "– ניתוח ביקורתי" / "– משפט משווה" / "– הדין הראוי".
- **מספר פרקים**: 4 עד 6 פרקים. אל תכלול תקציר במתווה — התקציר יסונתז בנפרד בסוף.
- **רישום אקדמי בעברית** — ללא הערות שוליים, ללא מספרי עמודים, ללא ציטוטים מלאים.

הפק את הפלט בדיוק לפי התבנית הבאה (שמור על הכותרות המודגשות ועל הסימונים המדויקים):

**מבוא**
- שאלת המחקר: ${rq}
- התזה המרכזית (Thesis): <טענה משפטית מרכזית במשפט אחד — מה תוכיח העבודה>
- חשיבות ותרומה לשיח המשפטי: <2-3 שורות — מדוע הסוגיה חשובה ומה תוסיף העבודה לדיון הקיים>
- קו הטיעון (Line of Argument): <כיצד התזה מתפתחת ומתבססת לאורך הפרקים, צעד אחר צעד>
- מבנה העבודה: <משפט מקשר אחד שמסביר את ההיגיון של חלוקת הפרקים>

**רשימת הפרקים**
1. **<כותרת הפרק>** – הדין המצוי
   - הרחבה: <2-4 משפטים בטון טיעוני: על מה הפרק מתמקד, אילו טיעונים יוצגו בו, וכיצד הפרק משרת את שאלת המחקר והתזה>
   - טיעוני נגד אפשריים: <משפט-שניים — אילו השגות צפויות לעלות נגד הטיעון בפרק זה, וכיצד הפרק נערך להתמודד עמן>
2. **<כותרת הפרק>** – ניתוח ביקורתי
   - הרחבה: ...
   - טיעוני נגד אפשריים: ...
3. **<כותרת הפרק>** – משפט משווה
   - הרחבה: ...
   - טיעוני נגד אפשריים: ...
4. **<כותרת הפרק>** – הדין הראוי
   - הרחבה: ...
   - טיעוני נגד אפשריים: ...

**סיכום ומסקנות (משוערות)**
- מסקנה משוערת: <מה צפוי לעלות מהמחקר על-בסיס מה שידוע עד כה — ניסוח זהיר אך ברור>
- תרומה משפטית: <שורה-שתיים — מה תתרום העבודה לשיח המשפטי, לפסיקה או לחקיקה עתידית>

ענה אך ורק בתבנית לעיל, בעברית אקדמית, ללא הקדמות וללא הערות מסכמות.`;
    }

    case "write_chapter": {
      const chapterTitle = (body.chapterTitle as string) || "";
      const chapterIndex = (body.chapterIndex as number) || 0;
      const rq = (body.researchQuestion as string) || "";
      const prevChapters = (body.previousChapters as Array<{ title: string; content: string }>) || [];
      const isAbstract = !!body.isAbstract;

      // ───────── Dedicated Abstract synthesis prompt ─────────
      if (isAbstract) {
        const allChaptersContext = prevChapters.length > 0
          ? prevChapters.map(ch => `--- ${ch.title} ---\n${ch.content || ""}`).join("\n\n")
          : "(לא סופקו פרקים)";

        return `אתה חוקר אקדמי בכיר במשפטים. עליך לכתוב **תקציר** לעבודה סמינריונית שכבר נכתבה במלואה.

שאלת המחקר: "${rq}"

=== כל פרקי העבודה ===
${allChaptersContext}

הנחיות מחייבות:
- אורך: עד 250 מילים בלבד (קשיח). אל תחרוג.
- טון: עברית אקדמית פורמלית ברגיסטר גבוה.
- מבנה (פסקה אחת רציפה או 2-4 פסקאות קצרות):
  1. שאלת המחקר וחשיבותה.
  2. המסגרת התיאורטית/המתודולוגיה.
  3. הטיעונים המרכזיים שהוצגו בפרקים.
  4. המסקנה והתרומה של המחקר.
- אל תוסיף הערות שוליים, רשימת מקורות, כותרות משנה או רשימות ממוספרות.
- אל תפתח במילים "תקציר זה..." — פתח ישר בתוכן.
- אל תוסיף ציטוטים חדשים — סינתזה בלבד מהפרקים הקיימים.
- אם חרגת מ-250 מילים — קצר את עצמך.`;
      }

      let prevContext = "";
      if (prevChapters.length > 0) {
        prevContext = "\n\n=== פרקים שנכתבו עד כה ===\n" +
          prevChapters.map(ch => `--- ${ch.title} ---\n${ch.content?.slice(0, 2000) || ""}`).join("\n\n");
      }

      // ─── Outline-derived context: thesis, this chapter's role, sibling titles ───
      const outlineRaw = (body.outline as string) || "";
      let thesisLine = "";
      let lineOfArgument = "";
      let chapterDescription = "";
      let counterArguments = "";
      const otherChapterTitles: string[] = [];

      if (outlineRaw) {
        // Thesis: line starting with "- התזה המרכזית" or "התזה המרכזית"
        const thesisMatch = outlineRaw.match(/(?:^|\n)\s*[-•]?\s*\*?\*?התזה[^:]*:\s*([^\n]+)/);
        if (thesisMatch) thesisLine = thesisMatch[1].replace(/\*+/g, "").trim();

        const loaMatch = outlineRaw.match(/(?:^|\n)\s*[-•]?\s*\*?\*?קו הטיעון[^:]*:\s*([^\n]+)/);
        if (loaMatch) lineOfArgument = loaMatch[1].replace(/\*+/g, "").trim();

        // Parse all numbered chapter blocks: "N. **title** ..."
        const chapterBlockRe = /(?:^|\n)\s*(\d+)\.\s*\*\*([^*]+?)\*\*([^]*?)(?=(?:\n\s*\d+\.\s*\*\*)|(?:\n\*\*סיכום)|$)/g;
        let m: RegExpExecArray | null;
        while ((m = chapterBlockRe.exec(outlineRaw)) !== null) {
          const idx = parseInt(m[1], 10);
          const title = m[2].trim();
          const block = m[3] || "";
          // Match by 1-based outline index against chapterIndex (which is 0-based for the chapters array;
          // outline index 1 → first non-abstract chapter). Also fall back to title equality.
          const titlesMatch = title === chapterTitle.replace(/\*+/g, "").trim();
          const indexMatch = idx === chapterIndex + (chapterTitle.includes("תקציר") ? 0 : 0) || idx === chapterIndex;
          // Try the most reliable signal first
          const isCurrent = titlesMatch || (idx === chapterIndex && !titlesMatch);
          if (isCurrent) {
            const descMatch = block.match(/[-•]\s*הרחבה[^:]*:\s*([^\n]+(?:\n(?!\s*[-•])[^\n]+)*)/);
            if (descMatch) chapterDescription = descMatch[1].replace(/\s+/g, " ").trim();
            const counterMatch = block.match(/[-•]\s*טיעוני נגד[^:]*:\s*([^\n]+(?:\n(?!\s*[-•])[^\n]+)*)/);
            if (counterMatch) counterArguments = counterMatch[1].replace(/\s+/g, " ").trim();
          } else {
            otherChapterTitles.push(`${idx}. ${title}`);
          }
        }
      }

      const thesisBlock = thesisLine ? `\n\n=== התזה המרכזית של העבודה ===\n${thesisLine}` : "";
      const loaBlock = lineOfArgument ? `\nקו הטיעון: ${lineOfArgument}` : "";
      const roleBlock = (chapterDescription || counterArguments)
        ? `\n\n=== תפקיד הפרק הנוכחי במבנה הטיעון ===${chapterDescription ? `\nתיאור הפרק (מן המתווה): ${chapterDescription}` : ""}${counterArguments ? `\nטיעוני נגד שצריך להתמודד איתם: ${counterArguments}` : ""}`
        : "";
      const siblingsBlock = otherChapterTitles.length > 0
        ? `\n\n=== מבנה כלל הפרקים בעבודה ===\n${otherChapterTitles.join("\n")}\n(אל תחזור על תוכן של פרקים אחרים — הם מטופלים בנפרד.)`
        : "";

      const userFeedback = (body.userFeedback as string) || "";
      const feedbackLine = userFeedback ? `\n\nהנחיות נוספות מהמשתמש לשכתוב הפרק:\n${userFeedback}` : "";

      return `אתה חוקר אקדמי בכיר במשפטים. כתוב את הפרק הבא בעבודה הסמינריונית.

שאלת המחקר: "${rq}"
פרק נוכחי (${chapterIndex + 1}): **${chapterTitle}**${thesisBlock}${loaBlock}${roleBlock}${siblingsBlock}
${prevContext}

הנחיות:
- כתוב פרק אחד בלבד: "${chapterTitle}".
- הפרק חייב לקדם את התזה המרכזית ולמלא את התפקיד שהוגדר לו במבנה הטיעון לעיל. אל תכתוב פרק כללי על הנושא — כתוב את **הפרק הספציפי הזה** עם הטענה הספציפית שלו.
- אם הוגדרו טיעוני נגד — התייחס אליהם והתמודד איתם בתוך הפרק.
- שמור על רצף ועקביות עם הפרקים הקודמים, ואל תחפוף לפרקים האחרים שכותרותיהם מופיעות לעיל.
- השתמש בהערות שוליים מעוצבות לפי כללי האזכור האחיד.
- העדף מקורות מאומתים ממאגר journal_article לחלקים תיאורטיים.
- **איכות לפני כמות**: אם אין לך מספיק נתונים בשביל ציטוט תקני (שם הצדדים בפסק דין, שם המחבר במאמר, פרטי פרסום) — אל תכתוב הערת שוליים בכלל. עדיף פרק עם פחות הערות מדויקות מאשר הערות חלקיות.
- **אסור בהחלט** להפיק הערת שוליים שתוכנה מסתכם במספר תיק וסוגריים בלבד (כגון "20.1.5931 (בתי משפט השלום)"). הערה כזו חייבת לכלול גם את שמות הצדדים, ואם אין — להשמיט אותה.
- טון: עברית אקדמית ברגיסטר גבוה.${feedbackLine}`;
    }

    default:
      return null;
  }
}

// ─── Fetch with timeout helper ───────────────────────────────────────

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Truncate combined context to a max character budget ─────────────

const MAX_CONTEXT_CHARS = 6000;

function truncateContext(text: string, limit: number = MAX_CONTEXT_CHARS): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\n[... קוצר מטעמי אורך ...]";
}

// ─── AI-based re-ranking: score source relevance to the question ─────

interface RankedMatch extends LocalMatch {
  relevanceScore?: number;
}

async function rerankLocalMatches(
  matches: LocalMatch[],
  question: string,
  apiKey: string,
): Promise<RankedMatch[]> {
  if (matches.length === 0) return [];

  // Deduplicate by document_id, aggregate chunks per doc
  const docMap = new Map<string, { match: LocalMatch; chunks: string[] }>();
  for (const m of matches) {
    const existing = docMap.get(m.document_id);
    if (existing) {
      existing.chunks.push(m.chunk_content.slice(0, 300));
    } else {
      docMap.set(m.document_id, { match: m, chunks: [m.chunk_content.slice(0, 300)] });
    }
  }

  const docs = Array.from(docMap.values());
  const sourceList = docs.map((d, i) => {
    return `[${i}] ${d.match.document_title}\nתוכן: ${d.chunks.join(" ").slice(0, 400)}`;
  }).join("\n\n");

  const rerankPrompt = `אתה מדרג רלוונטיות מהותית של מקורות משפטיים לשאלה. עליך להיות מחמיר.

שאלה: ${question}

מקורות:
${sourceList}

דרג כל מקור 0–10 לפי רלוונטיות מהותית בלבד לשאלה הספציפית.
- 0–2 = לא קשור לסוגיה / ענף דין שונה / עוסק בנושא אחר לחלוטין (גם אם יש מילות מפתח דומות).
- 3–4 = נוגע באופן רחוק / רקע כללי בלבד שאינו ענה על השאלה.
- 5–6 = רלוונטי לענף הדין ולסוגיה הקרובה.
- 7–10 = עוסק ישירות בסוגיה הספציפית הנשאלת.

חשוב במיוחד עבור פסיקה: התאמה בין ענף הדין חיונית. שאלה על דיני חוזים אינה מצדיקה ציון גבוה לפסקי דין מענייני משפחה/עבודה/פלילים אלא אם הם עוסקים ישירות בעקרון הנידון. אל תהסס לתת ציון 0–2 לפסיקה לא רלוונטית.

דוגמה לאי-התאמה: שאלה על חוזים מסחריים + מקור על משמורת קטינים או הגירת קטינים = ציון 0–1, גם אם שניהם מזכירים את המילה "הסכם" או "הסכמים". התאמת מילות מפתח שטחית ללא חפיפה בענף הדין = 0–2.

החזר רק מערך JSON של מספרים, ציון אחד לכל מקור לפי הסדר.
דוגמה: [8, 1, 9, 0, 6]`;

  try {
    const res = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        max_tokens: 200,
        messages: [
          { role: "user", content: rerankPrompt },
        ],
      }),
    }, 10000);

    if (!res.ok) {
      console.error(`Re-ranking API error: ${res.status}`);
      return matches.map(m => ({ ...m, relevanceScore: undefined }));
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    // Extract JSON array from response
    const arrayMatch = text.match(/\[[\d\s,]+\]/);
    if (!arrayMatch) {
      console.warn(`Re-ranking: COULD NOT PARSE SCORES — falling back to similarity threshold. Raw response: ${text.slice(0, 200)}`);
      // Fallback: keep only chunks with raw similarity >= 0.5 (not "use all"),
      // and always keep at least the single highest-similarity chunk.
      const sorted = [...matches].sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
      const top = sorted[0];
      const filtered = matches.filter(m => (m.similarity || 0) >= 0.5);
      const result = filtered.length > 0 ? filtered : (top ? [top] : []);
      console.log(`Re-ranking fallback kept ${result.length}/${matches.length} chunks by similarity`);
      return result.map(m => ({ ...m, relevanceScore: undefined }));
    }

    const rawScores: number[] = JSON.parse(arrayMatch[0]);
    console.log(`Re-ranking scores (raw): ${rawScores.join(", ")}`);

    // Action-verb topical bonus on the rerank score itself (parallels similarity-bonus layer).
    const VERB_TOPIC_PAIRS_RR: Array<{ trigger: RegExp; topicTerms: string[] }> = [
      { trigger: /(לפטר|פיטור|להדיח|הדחה|להפסיק\s+כהונ|הפסקת\s+כהונ|לסיים\s+כהונ|סיום\s+כהונ)/, topicTerms: ["פיטור", "פיטורי", "הפסקת כהונ", "סיום כהונ", "הדחה", "הדחת"] },
      { trigger: /(למנות|מינוי|להתמנות)/, topicTerms: ["מינוי", "מינויי", "למנות", "התמנות"] },
      { trigger: /(לעצור|מעצר|מעצרים)/, topicTerms: ["מעצר", "עצור", "עוצר", "מעצרים"] },
      { trigger: /(חיפוש|לערוך\s+חיפוש|צו\s+חיפוש)/, topicTerms: ["חיפוש", "צו חיפוש"] },
      { trigger: /(חקירה|חשד|לחקור)/, topicTerms: ["חקירה", "חשד", "חקירת"] },
    ];
    const activePairsRR = VERB_TOPIC_PAIRS_RR.filter(p => p.trigger.test(question));
    const computeBonus = (chunkContent: string): number => {
      if (activePairsRR.length === 0) return 0;
      for (const pair of activePairsRR) {
        if (pair.topicTerms.some(t => chunkContent.includes(t))) return 1;
      }
      return 0;
    };

    const docsArr = Array.from(docMap.entries());
    const docScores: Array<{ docId: string; score: number; rawScore: number; bonus: number; title: string; originalIndex: number }> = [];
    for (let i = 0; i < docsArr.length; i++) {
      const [docId, docData] = docsArr[i];
      const raw = rawScores[i] ?? 4;
      const bonus = computeBonus(docData.chunks.join(" "));
      docScores.push({ docId, score: raw + bonus, rawScore: raw, bonus, title: docData.match.document_title, originalIndex: i });
    }

    // Sort by score desc; tiebreak by original retrieval order (preserves upstream vector similarity ranking).
    // Then take top-N — no hard threshold, so semantically-relevant vector hits with score=0 still survive.
    const TOP_N_DOCS = 6;
    const sortedDocs = [...docScores].sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);

    // Hard relevance gate: drop docs with score <= 2 (off-topic).
    // For caselaw specifically: also drop score 3 (only weakly related), unless we'd end up with zero caselaw kept.
    const getDocSourceType = (docId: string): string =>
      docMap.get(docId)?.match.source_type || "";
    const isCaselaw = (docId: string): boolean => {
      const st = getDocSourceType(docId);
      return st === "case_law" || st === "caselaw" || st === "ruling";
    };

    const aboveHardFloor = sortedDocs.filter(d => d.score >= 3);
    const strictKept = aboveHardFloor.filter(d => !isCaselaw(d.docId) || d.score >= 5);
    // Safety valve: if filtering left zero caselaw AND the question itself is caselaw-domain
    // (explicit case markers like בג"ץ, ע"א, פס"ד, פסיקה, הלכה), allow back caselaw with score >= 3.
    // For doctrinal/contract questions, an empty caselaw bucket is fine — legislation/articles carry it.
    const isCaselawDomainQuestion = /(בג"ץ|בג״ץ|ע"א|ע״א|רע"א|רע״א|ע"פ|ע״פ|פס"ד|פס״ד|פסק\s+דין|פסיקה|הלכה|תקדים|בית\s+המשפט\s+העליון)/.test(question);
    const hadCaselaw = sortedDocs.some(d => isCaselaw(d.docId));
    const keptHasCaselaw = strictKept.some(d => isCaselaw(d.docId));
    let baseKept = strictKept;
    if (hadCaselaw && !keptHasCaselaw && isCaselawDomainQuestion) {
      const weakCaselaw = aboveHardFloor.filter(d => isCaselaw(d.docId) && d.score >= 3);
      baseKept = [...strictKept, ...weakCaselaw].sort(
        (a, b) => b.score - a.score || a.originalIndex - b.originalIndex,
      );
    }
    const topDocs = baseKept.slice(0, TOP_N_DOCS);
    const topDocIds = new Set(topDocs.map(d => d.docId));
    const droppedByGate = sortedDocs.length - baseKept.length;

    const result: RankedMatch[] = [];
    const rerankScoreLog: Record<string, string> = {};
    for (const ds of docScores) {
      const tag = ds.bonus > 0 ? `${ds.rawScore}+${ds.bonus}=${ds.score}` : `${ds.score}`;
      rerankScoreLog[ds.title.slice(0, 60)] = tag;
    }
    // Push chunks for top-N docs in score order
    for (const ds of topDocs) {
      for (const m of matches) {
        if (m.document_id === ds.docId) {
          result.push({ ...m, relevanceScore: ds.score });
        }
      }
    }

    const keptDocs = topDocIds.size;
    console.log(`Rerank scores per doc: ${JSON.stringify(rerankScoreLog)}`);
    console.log(`Rerank gate dropped ${droppedByGate} off-topic docs (score<3, or caselaw<4 with caselaw alternatives).`);
    console.log(`Rerank: kept top-${TOP_N_DOCS} of ${docsArr.length} docs by score`);
    console.log(`Local kept after gate + top-${TOP_N_DOCS} slice: ${keptDocs}/${docsArr.length} (active verb pairs: ${activePairsRR.length})`);

    return result;
  } catch (err) {
    console.error("Re-ranking failed (non-fatal):", err);
    return matches.map(m => ({ ...m, relevanceScore: undefined }));
  }
}

// ─── SSE streaming wrapper for Deep mode ────────────────────────────────
// Deep mode runs ~150-160s end-to-end. Without keepalive, the HTTP socket
// (browser ↔ edge runtime ↔ legal-qa container) gets dropped before the
// payload can be flushed, surfacing as the user-facing error
// "Http: connection closed before message completed". This wrapper:
//   1. Returns a `text/event-stream` Response immediately.
//   2. Emits an SSE comment heartbeat (`: ping\n\n`) every 15s so every
//      proxy in the chain stays warm.
//   3. Runs the original handler against a fresh Request (body cloned) and,
//      when it resolves, emits a single `data: <payload>\n\n` event followed
//      by `data: [DONE]\n\n`, then closes the stream.
// Errors inside the handler are caught and emitted as a `data:{error:…}`
// event so the client always gets a deterministic terminator.
async function runHandlerSSE(
  req: Request,
  parsedBody: Record<string, unknown>,
  handler: (req: Request) => Promise<Response>,
): Promise<Response> {
  const encoder = new TextEncoder();
  // Strip `stream` from the body we forward, so the inner handler doesn't
  // re-trigger this wrapper if someone ever calls handler() recursively.
  const { stream: _omit, ...rest } = parsedBody;
  const innerReq = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: JSON.stringify(rest),
  });

  let heartbeat: number | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      // Initial comment so the client immediately sees the connection open.
      controller.enqueue(encoder.encode(`: stream-open\n\n`));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          // controller already closed — let the cleanup finally{} clear it.
        }
      }, 15000) as unknown as number;

      try {
        const finalRes = await handler(innerReq);
        // Read the inner response as text. We expect JSON in all paths.
        const text = await finalRes.text();
        let payloadJson = text;
        // Validate it's parseable JSON; if not, wrap as an error event.
        try { JSON.parse(text); } catch {
          payloadJson = JSON.stringify({ error: "Invalid response from handler" });
        }
        // Encode as a single SSE message. Status code is forwarded via a
        // dedicated header field on the JSON so the client can react.
        const wrapped = JSON.stringify({
          status: finalRes.status,
          body: JSON.parse(payloadJson),
        });
        controller.enqueue(encoder.encode(`data: ${wrapped}\n\n`));
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        console.error("[sse-wrapper] handler threw:", msg);
        const wrapped = JSON.stringify({
          status: 500,
          body: { error: "שגיאה בעיבוד השאלה. נסו שוב." },
        });
        try {
          controller.enqueue(encoder.encode(`data: ${wrapped}\n\n`));
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        } catch { /* already closed */ }
      } finally {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      if (heartbeat !== undefined) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "Connection": "keep-alive",
    },
  });
}

// The actual request handler. Extracted from `serve(...)` so the SSE wrapper
// above can re-invoke it with a fresh Request when streaming is enabled.
async function handleLegalQARequest(req: Request): Promise<Response> {
  // Refund state — hoisted so the outer catch can refund on unexpected throws.
  let __creditsCharged = false;
  let __creditRequestId: string | null = null;
  let __userClientForRefund: ReturnType<typeof createClient> | null = null;
  // Checkpoint state — hoisted so the outer catch can flush a final
  // "error" snapshot to qa_logs.metadata even on unexpected throws or
  // client disconnects (HTTP "connection closed before message completed").
  let __checkpointQaLogId: string | null = null;
  let __checkpointInserted = false;
  // deno-lint-ignore no-explicit-any
  let __checkpointAdmin: any = null;
  let __checkpointUserId: string | null = null;
  let __checkpointQuestion = "";
  let __checkpointTaskMode: string | null = null;
  const __checkpointStageRuns: StageRun[] = [];

  try {
    // Auth gate
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { question, taskMode, documentText, documentName, academicStep, documentTexts, previousChapters, chapterTitle, chapterIndex, researchQuestion: bodyResearchQuestion, outline: bodyOutline, isAbstract, hasDocument: bodyHasDocument, requestId: clientRequestId, evalForceLegacy: bodyEvalForceLegacy, evalRunId: bodyEvalRunId, evalVariant: bodyEvalVariant, depth: bodyDepth } = body;

    // ─── Mode profile (Fast / Deep) — single source of truth for per-mode knobs ───
    // Resolved once here; everything downstream reads from `modeProfile`.
    // Defaults to Fast for backward compatibility (no `depth` in body = Fast).
    // Only applied to taskMode === RESEARCH_MODE; other modes ignore it.
    // eslint-disable-next-line prefer-const
    let { depth: researchDepth, profile: modeProfile } = resolveModeProfile(bodyDepth);
    if (taskMode === RESEARCH_MODE) {
      // Deploy marker v7.13: forces redeploy when modeProfile wiring stops appearing in metadata.profile_used.
      console.log(`[mode] depth=${researchDepth} anchor_pass=${modeProfile.anchorPassEnabled} drafter=${modeProfile.drafterVariant} retrieval_rounds=${modeProfile.retrievalRounds} e5_min=${modeProfile.perplexityCompletionMinAnchored}`);
    }

    // ─── Eval harness gate (admin-only, internal). Allows the offline
    // evaluation runner to force the legacy retrieval+drafter path on the
    // exact same edge function so we get apples-to-apples comparisons.
    // No effect for normal users: the flag is silently ignored unless the
    // caller has the admin role.
    let isAdminCaller = false;
    try {
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      isAdminCaller = !!roleRow;
    } catch (_e) {
      isAdminCaller = false;
    }
    const evalForceLegacy = isAdminCaller && bodyEvalForceLegacy === true;
    const evalRunId = isAdminCaller && typeof bodyEvalRunId === "string" ? bodyEvalRunId : null;
    const evalVariant = isAdminCaller && (bodyEvalVariant === "legacy" || bodyEvalVariant === "structured")
      ? bodyEvalVariant
      : null;
    if (evalForceLegacy) {
      console.log(`[eval] forcing legacy path (run=${evalRunId} variant=${evalVariant})`);
    }

    if (!question || typeof question !== "string" || question.trim().length < 3) {
      return new Response(JSON.stringify({ error: "Question too short" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ===== Credit gate: consume up-front, refund automatically on failure / empty result =====
    // Cost: 5 for legal QA. Document grounding adds +2 surcharge.
    // Academic sub-modes (suggest_topics, validate_question, propose_outline) cost 0;
    // chapter generation costs 8 (handled below before its own AI call).
    const isAcademicSubModeFree =
      taskMode === "academic_writing" &&
      typeof academicStep === "string" &&
      ["suggest_topics", "validate_question", "propose_outline"].includes(academicStep);
    const isAcademicChapter =
      taskMode === "academic_writing" && academicStep === "write_chapter";
    const hasGroundingDoc =
      (Array.isArray(documentTexts) && documentTexts.length > 0) ||
      (typeof documentText === "string" && documentText.trim().length > 100);

    let creditCost = 5;
    if (isAcademicSubModeFree) creditCost = 0;
    else if (isAcademicChapter) creditCost = 8;
    if (hasGroundingDoc && !isAcademicChapter && !isAcademicSubModeFree) creditCost += 2;

    // ─── Deep pipeline opt-in for academic chapter writes ───────────
    // Academic chapters use the same Deep behavior as research/Deep:
    //  • full Frame→Decompose→ClaimMap→Retrieve→SourcePack→E.5→Draft pipeline
    //  • Deep envelope (1200-2000 words, footnote floor 8, anchor pass on)
    //  • Stage E.5 Perplexity completion when core < 6
    //  • citation engine resolver canonicalises the parsed footnotes (below)
    // We force the deep profile for chapters AFTER resolveModeProfile so any
    // depth coming from the body is overridden — chapters are always Deep.
    if (isAcademicChapter) {
      const forced = resolveModeProfile("deep");
      researchDepth = forced.depth;
      modeProfile = forced.profile;
      console.log(`[mode] academic chapter: forcing depth=deep (anchor_pass=${modeProfile.anchorPassEnabled} drafter=${modeProfile.drafterVariant} retrieval_rounds=${modeProfile.retrievalRounds})`);
    }
    // Single gate that drives every Deep-pipeline behaviour. Replaces the
    // bare `taskMode === RESEARCH_MODE` check at every Deep-only stage.
    const enableDeepPipeline = (taskMode === RESEARCH_MODE) || isAcademicChapter;

    const creditRequestId =
      typeof clientRequestId === "string" && clientRequestId.length >= 8
        ? clientRequestId
        : crypto.randomUUID();
    __creditRequestId = creditRequestId;

    // Use a user-scoped client (with the caller's JWT) so consume_credits sees auth.uid()
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    __userClientForRefund = userClient;

    let creditsCharged = false;
    if (creditCost > 0) {
      const { data: consumeData, error: consumeErr } = await userClient.rpc("consume_credits", {
        _amount: creditCost,
        _reason: `legal-qa:${taskMode || "research"}${hasGroundingDoc ? "+doc" : ""}`,
        _request_id: creditRequestId,
      });
      if (consumeErr) {
        console.error("consume_credits error:", consumeErr);
        return new Response(JSON.stringify({ error: "שגיאה בחיוב קרדיטים. נסו שוב." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const cr = (consumeData ?? {}) as Record<string, unknown>;
      if (!cr.ok) {
        if (cr.error === "INSUFFICIENT_CREDITS") {
          return new Response(JSON.stringify({
            error: "INSUFFICIENT_CREDITS",
            required: cr.required ?? creditCost,
            remaining_included: cr.remaining_included ?? 0,
            remaining_topup: cr.remaining_topup ?? 0,
          }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ error: cr.error || "CREDIT_ERROR" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      creditsCharged = true;
      __creditsCharged = true;
    }

    // Helper: build a refund-aware payload for refusals / empty results.
    const refundAndPayload = async (extraReason: string, payload: Record<string, unknown>) => {
      let refunded = false;
      if (creditsCharged) {
        try {
          const { data: refundData } = await userClient.rpc("refund_credits", {
            _request_id: creditRequestId,
            _reason: `auto-refund: ${extraReason}`,
          });
          refunded = Boolean((refundData as Record<string, unknown> | null)?.ok);
          creditsCharged = !refunded;
          __creditsCharged = creditsCharged;
        } catch (rfErr) {
          console.error("refund_credits failed (non-fatal):", rfErr);
        }
      }
      return { ...payload, refunded, refundReason: refunded ? extraReason : undefined };
    };

    const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
    if (!PERPLEXITY_API_KEY) throw new Error("PERPLEXITY_API_KEY is not configured");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const t0 = Date.now();

    // ========= Academic sub-mode shortcut =========
    // For suggest_topics, validate_question, propose_outline: lighter flow without full retrieval.
    // Also: write_chapter when isAbstract === true, since the abstract is pure synthesis of
    // already-written chapters and must NOT introduce new external citations.
    const isAbstractGeneration =
      taskMode === "academic_writing" && academicStep === "write_chapter" && !!isAbstract;

    if (
      taskMode === "academic_writing" &&
      academicStep &&
      (["suggest_topics", "validate_question", "propose_outline"].includes(academicStep) || isAbstractGeneration)
    ) {
      const subPrompt = getAcademicSubModePrompt(academicStep, body);
      if (!subPrompt) {
        return new Response(JSON.stringify({ error: "Invalid academic step" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Quick local search for context (skipped for abstract — synthesis only)
      let localContext = "";
      if (!isAbstractGeneration) {
        try {
          const keywords = extractKeywords(question);
          const { data: textMatches } = await adminClient.rpc("search_legal_chunks_text", {
            search_query: keywords, match_count: 5,
          });
          if (textMatches && textMatches.length > 0) {
            localContext = "\n=== מקורות רלוונטיים מהמאגר ===\n" +
              textMatches.slice(0, 5).map((m: any) => `- ${m.document_title} (${m.source_type})`).join("\n");
          }
        } catch { /* non-fatal */ }
      }

      // Include multi-file context if available (skipped for abstract)
      let fileContext = "";
      if (!isAbstractGeneration && documentTexts && Array.isArray(documentTexts) && documentTexts.length > 0) {
        fileContext = "\n=== מסמכים שהועלו ===\n" +
          documentTexts.map((dt: any) => `=== ${dt.name} ===\n${dt.text?.slice(0, 5000) || ""}`).join("\n\n");
      }

      const aiRes = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: isAbstractGeneration ? 1024 : 4096,
          messages: [
            { role: "system", content: subPrompt + localContext + fileContext },
            { role: "user", content: isAbstractGeneration ? "כתוב את התקציר עכשיו, עד 250 מילים בלבד." : question },
          ],
        }),
      }, 60000);

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error("Academic sub-mode AI error:", aiRes.status, errText);
        return new Response(JSON.stringify({ error: "שגיאה בשירות ה-AI." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const aiData = await aiRes.json();
      let answerText = aiData.choices?.[0]?.message?.content || "";

      // Defensive word-count guard for the abstract (≤250 words). Trim by sentence if exceeded.
      if (isAbstractGeneration && answerText) {
        const words = answerText.trim().split(/\s+/).filter(Boolean);
        if (words.length > 250) {
          console.warn(`Abstract exceeded 250 words (got ${words.length}). Trimming.`);
          // Trim to 250 words at a sentence boundary if possible.
          const truncated = words.slice(0, 250).join(" ");
          const lastStop = Math.max(
            truncated.lastIndexOf("."),
            truncated.lastIndexOf("!"),
            truncated.lastIndexOf("?")
          );
          answerText = lastStop > truncated.length * 0.6
            ? truncated.slice(0, lastStop + 1)
            : truncated + "…";
        }
      }

      console.log(`Academic sub-mode (${academicStep}${isAbstractGeneration ? ":abstract" : ""}): ${answerText.length} chars, ${Date.now() - t0}ms`);

      return new Response(
        JSON.stringify({ answer: answerText, footnotes: [], source_urls: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========= Case Summary short-circuit (strict full-text gate) =========
    if (taskMode === "case_summary") {
      let userSuppliedText = "";
      if (documentTexts && Array.isArray(documentTexts) && documentTexts.length > 0) {
        userSuppliedText = documentTexts.map((dt: any) => dt.text || "").join("\n\n");
      } else if (documentText && typeof documentText === "string") {
        userSuppliedText = documentText;
      }

      let verify: { source: "user" | "local" | "external" | "none"; fullText?: string; metadata?: Record<string, unknown>; refusal_message?: string } | null = null;
      try {
        const vRes = await fetchWithTimeout(`${Deno.env.get("SUPABASE_URL")}/functions/v1/verify-case-fulltext`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": authHeader },
          body: JSON.stringify({ question, userText: userSuppliedText }),
        }, 20000);
        if (vRes.ok) verify = await vRes.json();
      } catch (e) {
        console.error("verify-case-fulltext call failed:", e instanceof Error ? e.message : e);
      }

      if (!verify || verify.source === "none" || !verify.fullText) {
        console.log("case_summary: refusing — no full text available");
        const payload = await refundAndPayload("case_summary:no-fulltext", {
          refusal: true,
          source: "none",
          message: verify?.refusal_message || "פסק הדין אינו קיים במערכת ולא ניתן היה לאתר את הטקסט המלא שלו. כדי שאוכל לסכם אותו עבורך, אנא העלה את הקובץ או הדבק את הטקסט בתיבת הטקסט.",
          answer: "",
          footnotes: [],
          source_urls: [],
        });
        return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Defense-in-depth: Hebrew-ratio sanity gate. If the extracted text is mostly
      // non-Hebrew (e.g., binary garbage that slipped through), refuse rather than
      // hallucinate placeholders from noise.
      {
        const ft = verify.fullText as string;
        const sample = ft.slice(0, 20000);
        const total = sample.length || 1;
        const hebrew = (sample.match(/[\u0590-\u05FF]/g) || []).length;
        const ratio = hebrew / total;
        if (ratio < 0.05) {
          console.log(`case_summary: refusing — extracted text failed Hebrew-ratio gate (${(ratio * 100).toFixed(2)}%, source=${verify.source})`);
          const payload = await refundAndPayload("case_summary:hebrew-ratio-fail", {
            refusal: true,
            source: "none",
            message: "פסק הדין אינו קיים במערכת ולא ניתן היה לאתר את הטקסט המלא שלו. כדי שאוכל לסכם אותו עבורך, אנא העלה את הקובץ או הדבק את הטקסט בתיבת הטקסט.",
            answer: "",
            footnotes: [],
            source_urls: [],
          });
          return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      const md = verify.metadata || {};
      const headerHints = [
        md.case_number ? `מספר תיק: ${md.case_number}` : null,
        md.parties ? `צדדים: ${md.parties}` : null,
        md.court ? `ערכאה: ${md.court}` : null,
        md.year ? `שנה: ${md.year}` : null,
      ].filter(Boolean).join(" | ");

      const caseInstructions = getTaskModeInstructions("case_summary");
      const sumPrompt = `אתה עוזר משפטי מומחה לסיכום פסיקה ישראלית.
${caseInstructions}

מטא-דאטה זמינה לכותרת (אם חסר — כתוב "(לא צוין בפסק הדין)"):
${headerHints || "(לא נמסרה)"}

=== טקסט פסק הדין המלא — מקור האמת היחיד ===
${(verify.fullText as string).slice(0, 50000)}
=== סוף הטקסט ===

צור עכשיו את הדו"ח לפי המבנה המחייב. ללא הערות שוליים. ללא [N]. ללא ציטוט מקורות חיצוניים.`;

      const aiRes = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          max_tokens: 3500,
          messages: [
            { role: "system", content: sumPrompt },
            { role: "user", content: `סכם את פסק הדין הבא: ${question.trim() || (md.case_number || "פסק הדין שסופק")}` },
          ],
        }),
      }, 90000);

      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error("case_summary AI error:", aiRes.status, errText);
        const payload = await refundAndPayload("case_summary:ai-error", { error: "שגיאה בעיבוד הסיכום. נסו שוב." });
        return new Response(JSON.stringify(payload), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const aiData = await aiRes.json();
      const summary = (aiData.choices?.[0]?.message?.content || "").trim();
      console.log(`case_summary: produced ${summary.length} chars (source=${verify.source}, ${Date.now() - t0}ms)`);

      return new Response(JSON.stringify({
        answer: summary,
        footnotes: [],
        source_urls: md.source_url ? [md.source_url] : [],
        case_summary: true,
        verified_source: verify.source,
        case_metadata: md,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ========= Step 0: Document context (if uploaded) =========
    let documentContext = "";
    const isAcademicMode = taskMode === "academic_writing";
    const contextCharLimit = isAcademicMode ? 12000 : MAX_CONTEXT_CHARS;

    // Multi-file support
    if (documentTexts && Array.isArray(documentTexts) && documentTexts.length > 0) {
      documentContext = documentTexts.map((dt: any) => 
        `\n=== מסמך: ${dt.name || "ללא שם"} ===\n${(dt.text || "").slice(0, 15000)}\n=== סוף המסמך ===\n`
      ).join("\n");
      console.log(`Multi-file upload: ${documentTexts.length} files`);
    } else {
      const hasDocument = documentText && typeof documentText === "string" && documentText.trim().length > 100;
      if (hasDocument) {
        documentContext = `\n=== מסמך שהועלה: ${documentName || "ללא שם"} ===\n${documentText.slice(0, 15000)}\n=== סוף המסמך ===\n`;
        console.log(`Document uploaded: ${documentName}, ${documentText.length} chars`);
      }
    }
    const hasDocument = documentContext.length > 0;

    // ========= pleading_analysis: 150-word guard on audit subject =========
    // Subject = uploaded document text (if any) OR the typed question.
    if (taskMode === "pleading_analysis") {
      let auditSubject = "";
      if (documentTexts && Array.isArray(documentTexts) && documentTexts.length > 0) {
        auditSubject = documentTexts.map((dt: any) => dt.text || "").join("\n\n");
      } else if (documentText && typeof documentText === "string") {
        auditSubject = documentText;
      } else {
        auditSubject = question || "";
      }
      const wordCount = auditSubject.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount < 150) {
        const payload = await refundAndPayload("pleading_analysis:too-short", {
          answer: "המסמך שסופק קצר מדי לביקורת מהותית (פחות מ-150 מילים). אנא הדביקו או העלו מסמך מלא יותר.",
          footnotes: [],
          source_urls: [],
        });
        return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ========= Stage A+B: Decomposition + Query Plan (legal_research only) =========
    // INTERNAL — never exposed to UI. Recorded in qa_logs.metadata for diagnostics.
    let decomposedPlan: DecomposedPlan | null = null;
    let decompositionV2: LegalResearchDecomposition | null = null;
    // Per-stage runtime telemetry. Each stage pushes its `StageRun` here so we
    // can record honest "this model actually completed" data in qa_logs.metadata.
    // Aliased to the hoisted array so the outer catch can flush it on error.
    const stageRuns: StageRun[] = __checkpointStageRuns;

    // ─── Retrieval funnel telemetry ──────────────────────────────────
    // Per-source-type counters captured at each pipeline checkpoint.
    // Stashed on qa_logs.metadata.retrieval_funnel for diagnostics.
    // INSTRUMENTATION ONLY — does not change retrieval/filter behavior.
    type FunnelStage = {
      caselaw: number;
      knesset_research: number;
      journal_article: number;
      israeli_law: number;
      other: number;
      total: number;
    };
    const newFunnelStage = (): FunnelStage => ({
      caselaw: 0, knesset_research: 0, journal_article: 0,
      israeli_law: 0, other: 0, total: 0,
    });
    const tallyByType = (matches: Array<{ source_type?: string }>): FunnelStage => {
      const s = newFunnelStage();
      for (const m of matches) {
        const t = (m.source_type || "").toLowerCase();
        if (t === "caselaw" || t === "case_law" || t === "ruling") s.caselaw++;
        else if (t === "knesset_research") s.knesset_research++;
        else if (t === "journal_article") s.journal_article++;
        else if (t === "israeli_law") s.israeli_law++;
        else s.other++;
        s.total++;
      }
      return s;
    };
    const retrievalFunnel: {
      raw_keyword: FunnelStage;
      raw_vector: FunnelStage;
      raw_caselaw_filtered: FunnelStage;
      after_dedup_quota: FunnelStage;
      after_rerank: FunnelStage;
      after_broken_title_filter: FunnelStage;
      source_cards_local: FunnelStage;
      drop_reasons: Record<string, number>;
      rerank_dropped_docs: Array<{ title: string; source_type: string; score: number; reason: string }>;
      soft_min_supplementary?: {
        missing_types: string[];
        threshold: number;
        per_type_cap: number;
        considered_by_type: Record<string, number>;
        added_by_type: Record<string, number>;
      };
      // Milestone B — Stage E.5 Perplexity completion telemetry.
      perplexity_completion?: {
        triggered: boolean;
        reason: string;
        status: string;
        core_before: number;
        core_after: number;
        candidates_returned: number;
        candidates_kept: number;
        candidates_by_type: { statute: number; caselaw: number };
        promoted_to_core: number;
        duration_ms: number;
        drops?: Record<string, number>;
        debug_candidates?: Array<{ kept: boolean; reason?: string; preview: string }>;
      };
      // Deep mode — Stage E.6 round-2 retrieval telemetry.
      round_2?: {
        triggered: boolean;
        reason: string;
        queries: string[];
        new_cards: number;
        new_doc_ids: number;
        duration_ms: number;
      };
    } = {
      raw_keyword: newFunnelStage(),
      raw_vector: newFunnelStage(),
      raw_caselaw_filtered: newFunnelStage(),
      after_dedup_quota: newFunnelStage(),
      after_rerank: newFunnelStage(),
      after_broken_title_filter: newFunnelStage(),
      source_cards_local: newFunnelStage(),
      drop_reasons: {},
      rerank_dropped_docs: [],
    };
    const bumpDrop = (reason: string, n = 1) => {
      retrievalFunnel.drop_reasons[reason] = (retrievalFunnel.drop_reasons[reason] || 0) + n;
    };

    // ─── Early checkpoint persistence ────────────────────────────────
    // Pre-allocate a qa_logs row id so we can write a CHECKPOINT row right
    // after each pipeline stage. If the client disconnects (HTTP "connection
    // closed before message completed") the row still exists with the latest
    // stage_runs, so admins can see how far the pipeline got.
    // The final block at the bottom of this handler upserts on this id with
    // the full payload (answer, footnotes, complete metadata).
    const preallocatedQaLogId: string = crypto.randomUUID();
    // Wire to hoisted state so the outer catch can flush a final error snapshot.
    __checkpointQaLogId = preallocatedQaLogId;
    __checkpointAdmin = adminClient;
    __checkpointUserId = user.id;
    __checkpointQuestion = question;
    __checkpointTaskMode = taskMode;

    const writeCheckpoint = (phase: "decomposition" | "claim_map" | "drafting_started"): void => {
      if (!enableDeepPipeline) return;
      // Snapshot current state — note that drafting_path is "in_progress" until
      // the final block decides between "structured" / "fallback".
      const snapshot = {
        checkpoint: phase,
        checkpoint_at: new Date().toISOString(),
        drafting_path: "in_progress",
        decomposition: decomposedPlan?.decomposition ?? null,
        stage_runs: [...stageRuns],
        // models_used computed at finalization time; here we just expose
        // raw stage_runs so admins can correlate timing.
      };
      const payload = {
        id: preallocatedQaLogId,
        user_id: user.id,
        question: question.substring(0, 500),
        answer: null,
        footnotes: [],
        task_mode: taskMode,
        local_footnotes_count: 0,
        perplexity_footnotes_count: 0,
        total_footnotes: 0,
        metadata: snapshot,
      };
      const op = __checkpointInserted
        ? adminClient.from("qa_logs").update({ metadata: snapshot }).eq("id", preallocatedQaLogId)
        : adminClient.from("qa_logs").insert(payload);
      // Fire-and-forget; never block the pipeline on a logging write.
      const promise = (op as unknown as Promise<{ error: unknown }>).then((res) => {
        if (res?.error) console.error(`[checkpoint:${phase}] write failed (non-fatal):`, res.error);
        else if (!__checkpointInserted) __checkpointInserted = true;
      });
      // deno-lint-ignore no-explicit-any
      const er = (globalThis as any).EdgeRuntime;
      if (er && typeof er.waitUntil === "function") {
        er.waitUntil(promise);
      } else {
        promise.catch(() => {});
      }
    };

    // ─── Tier-1 tuning: kick off decomposition CONCURRENTLY with retrieval ───
    // Previously this was awaited serially BEFORE localSearchPromise was even
    // constructed, which cost ~25s on the wall clock and pushed total runs
    // over the 150s edge-function ceiling. Now decomposition races local
    // search; the plan-derived sub-issue queries are consumed inside
    // localSearchPromise via `await decompPromise` only at the point they're
    // actually needed (after the first wave of embeddings is in flight).
    let decompPromise: Promise<{ data: DecomposedPlan | null; run: StageRun; retryRun?: StageRun }> | null = null;
    if (enableDeepPipeline && !evalForceLegacy) {
      const tDecompStart = Date.now();
      decompPromise = decomposeAndPlan(question)
        .then((res) => {
          if (res.data) {
            console.log(
              `[plan] ${res.data.decomposition.sub_issues.length} sub-issues, ${res.data.query_plan.length} plans (${Date.now() - tDecompStart}ms; ${res.run.provider}/${res.run.model}, status=${res.run.status})`,
            );
          } else {
            console.log(`[plan] decompose+plan returned null (status=${res.run.status}, ${res.run.duration_ms}ms) — falling back to legacy retrieval`);
          }
          return res;
        })
        .catch((decompErr) => {
          console.error("[plan] decompose+plan failed (non-fatal):", decompErr);
          // Synthesize a failed StageRun so telemetry stays consistent.
          const now = new Date().toISOString();
          return {
            data: null as DecomposedPlan | null,
            run: {
              stage: "decomposition",
              provider: "openai" as const,
              model: "unknown",
              started_at: now,
              completed_at: now,
              duration_ms: Date.now() - tDecompStart,
              status: "error" as const,
              error_message: (decompErr as Error)?.message ?? String(decompErr),
            },
          };
        });
    }

    // ========= Step 1: Local search (hybrid: keyword + vector) + Perplexity IN PARALLEL =========


    // Helper: generate query embedding for vector search
    async function getQueryEmbedding(text: string): Promise<number[] | null> {
      try {
        const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
        if (!OPENAI_API_KEY) { console.error("OPENAI_API_KEY not configured"); return null; }
        const res = await fetchWithTimeout("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: text.slice(0, 4000),
            dimensions: 768,
          }),
        }, 5000);
        if (!res.ok) {
          console.error("Query embedding error:", res.status);
          return null;
        }
        const data = await res.json();
        const embedding = data.data?.[0]?.embedding;
        if (!embedding || !Array.isArray(embedding)) {
          console.error(`Embedding returned null for query "${text.slice(0, 40)}..."`);
          return null;
        }
        const sample = embedding.slice(0, 3).map((v: number) => v.toFixed(3));
        console.log(`Embedding generated for query "${text.slice(0, 40)}...": dim=${embedding.length}, sample=[${sample.join(", ")}]`);
        return embedding;
      } catch (err) {
        console.error("Query embedding failed (non-fatal):", err);
        return null;
      }
    }

    const localSearchPromise = (async (): Promise<{ matches: LocalMatch[]; used: boolean }> => {
      try {
        // Step A: optionally expand short queries to a fuller legal phrasing
        const expandedQuery = await expandShortQuery(question, LOVABLE_API_KEY);
        // Stage B: enrich vector search with sub-issue queries from the planner.
        // Tier-1 tuning: decomposition runs CONCURRENTLY with retrieval. We
        // await the plan only here, after `expandShortQuery` (cheap LLM call,
        // ~1-3s) has already overlapped most of the planner's runtime. If the
        // plan still isn't ready, we don't wait — we proceed without sub-issue
        // queries; the plan will be picked up later by the claim_map stage.
        let planForRetrieval: DecomposedPlan | null = null;
        if (decompPromise) {
          // Race: plan vs. a grace window. We've already burned ~1-3s on
          // expandShortQuery, so most successful plans will still be in flight.
          //
          // Fast (#3 parallelization, v7.14): retrieval uses the ORIGINAL
          // question as the primary signal — sub-issue queries are an
          // enrichment, not a dependency. Give the plan only a 3s grace
          // window so retrieval starts almost immediately on the original
          // question. If the plan lands after retrieval kicked off, it will
          // still be consumed by claim_map downstream.
          //
          // Deep keeps the longer 25s window because it benefits more from
          // plan-derived sub-issue queries seeding round-1 (round-2 is also
          // gated on plan availability) and its overall wall budget is
          // already higher.
          const planGraceMs = modeProfile.retrievalRounds >= 2 ? 25000 : 3000;
          const planRace = await Promise.race([
            decompPromise.then((r) => ({ ready: true as const, plan: r.data })),
            new Promise<{ ready: false }>((resolve) => setTimeout(() => resolve({ ready: false }), planGraceMs)),
          ]);
          if (planRace.ready) planForRetrieval = planRace.plan;
        }
        const planQueries: string[] = [];
        if (planForRetrieval?.query_plan) {
          for (const p of planForRetrieval.query_plan) {
            if (p.legislation_query) planQueries.push(p.legislation_query);
            if (p.caselaw_query) planQueries.push(p.caselaw_query);
            if (p.literature_query) planQueries.push(p.literature_query);
          }
        }
        // Cap total parallel vector queries at 4. Each match_legal_chunks RPC
        // contends for the same HNSW index and PG worker pool; pushing 6+ in
        // parallel was causing 5-6 statement_timeouts per Deep run (see logs
        // 2026-04-24). Budget: question + optional expansion + remaining slots
        // for plan-derived sub-issues. Keeps retrieval breadth while ensuring
        // each query gets enough server time to complete.
        const MAX_PARALLEL_VECTOR_QUERIES = 4;
        const planQueriesUnique = Array.from(
          new Set(planQueries.map((q) => q.trim()).filter(Boolean)),
        );
        const reservedSlots = 1 + (expandedQuery ? 1 : 0); // question + maybe expansion
        const planSlots = Math.max(0, MAX_PARALLEL_VECTOR_QUERIES - reservedSlots);
        const planQueriesCapped = planQueriesUnique.slice(0, planSlots);
        const queriesForEmbedding = [
          question,
          ...(expandedQuery ? [expandedQuery] : []),
          ...planQueriesCapped,
        ];
        if (planQueriesCapped.length > 0) {
          console.log(`[plan] adding ${planQueriesCapped.length} sub-issue queries to vector search (capped at ${MAX_PARALLEL_VECTOR_QUERIES} total parallel; ${planQueriesUnique.length - planQueriesCapped.length} dropped)`);
        } else if (decompPromise) {
          console.log(`[plan] proceeding with retrieval before plan landed (or plan was null)`);
        }
        const keywordSourceText = expandedQuery ? `${question} ${expandedQuery}` : question;

        const keywords = extractKeywords(keywordSourceText);
        console.log(`Search keywords: "${keywords}" (from: "${question.slice(0, 80)}"${expandedQuery ? ` + expanded` : ""})`);

        // Keyword search (single combined query)
        const keywordPromise = adminClient.rpc("search_legal_chunks_text", {
          search_query: keywords,
          match_count: 15,
        });

        // Vector search — run for original AND expanded query in parallel, merge
        // Threshold 0.45: short Hebrew queries top out ~0.55 raw; re-ranker filters noise downstream.
        const vectorPromises = queriesForEmbedding.map(async (q) => {
          const embedding = await getQueryEmbedding(q);
          if (!embedding) return { data: null, error: null, embedding: null as number[] | null, query: q };
          const result = await adminClient.rpc("match_legal_chunks", {
            query_embedding: JSON.stringify(embedding),
            match_threshold: 0.45,
            match_count: 15,
          });
          return { ...result, embedding, query: q };
        });

        // Fix #2: Parallel caselaw-only vector query so precedent competes against itself
        // (not against denser academic prose). Use the original (non-expanded) question
        // since expansion often drifts toward academic phrasing.
        // Layer 3: lowered threshold 0.40→0.25 and expanded top 8→16 (caselaw embeds lower
        // than academic prose; rerank still gates downstream).
        const caselawVectorPromise = (async () => {
          const embedding = await getQueryEmbedding(question);
          if (!embedding) return { data: null, error: null };
          return await adminClient.rpc("match_legal_chunks_filtered", {
            query_embedding: JSON.stringify(embedding),
            filter_source_type: "caselaw",
            match_threshold: 0.25,
            match_count: 16,
          });
        })();

        // Layer 2: Landmark-case direct injection. When a question matches a topic trigger,
        // unconditionally fetch known landmark cases by case_number and inject them into the
        // candidate pool. They still go through rerank, so off-topic landmarks get filtered.
        const LANDMARK_CASES: Array<{ triggers: RegExp[]; case_numbers: string[] }> = [
          {
            triggers: [/יועמ["״']?ש/, /יועצת\s+המשפטית/, /יועץ\s+המשפטי/],
            case_numbers: ["18225-06-25", "4267/93"],
          },
        ];
        const questionForLandmark = `${question} ${expandedQuery || ""}`;
        const landmarkCaseNumbers = Array.from(new Set(
          LANDMARK_CASES
            .filter(lc => lc.triggers.some(t => t.test(questionForLandmark)))
            .flatMap(lc => lc.case_numbers)
        ));
        const landmarkPromise = (async (): Promise<LocalMatch[]> => {
          if (landmarkCaseNumbers.length === 0) return [];
          const { data: docs, error: docsErr } = await adminClient
            .from("legal_documents")
            .select("id, title, citation, source_type, source_url, metadata, case_number")
            .in("case_number", landmarkCaseNumbers);
          if (docsErr || !docs || docs.length === 0) {
            if (docsErr) console.error(`Landmark fetch error: ${docsErr.message}`);
            return [];
          }
          const docIds = docs.map(d => d.id);
          const { data: chunks, error: chunksErr } = await adminClient
            .from("legal_document_chunks")
            .select("id, document_id, content, chunk_index")
            .in("document_id", docIds)
            .order("chunk_index", { ascending: true });
          if (chunksErr || !chunks) {
            console.error(`Landmark chunks error: ${chunksErr?.message}`);
            return [];
          }
          // Take first 2 chunks per doc to match RPC behavior
          const perDocCount = new Map<string, number>();
          const injected: LocalMatch[] = [];
          for (const c of chunks) {
            const n = perDocCount.get(c.document_id) || 0;
            if (n >= 2) continue;
            perDocCount.set(c.document_id, n + 1);
            const doc = docs.find(d => d.id === c.document_id);
            if (!doc) continue;
            injected.push({
              chunk_id: c.id,
              document_id: c.document_id,
              chunk_content: c.content,
              document_title: doc.title,
              document_citation: doc.citation,
              source_type: doc.source_type,
              source_url: doc.source_url,
              metadata: (doc.metadata || {}) as Record<string, unknown>,
              similarity: 0.50, // moderate floor so it survives merge but doesn't dominate
            });
          }
          console.log(`Landmark injection: triggers=[${landmarkCaseNumbers.join(", ")}] matched ${docs.length} docs / ${injected.length} chunks`);
          return injected;
        })();

        const [keywordResult, caselawResult, landmarkInjected, ...vectorResults] = await Promise.all([
          keywordPromise,
          caselawVectorPromise,
          landmarkPromise,
          ...vectorPromises,
        ]);

        const caselawMatches: LocalMatch[] = (!caselawResult.error && caselawResult.data) ? caselawResult.data as LocalMatch[] : [];
        if (caselawResult.error) {
          console.error(`match_legal_chunks_filtered (caselaw) error: ${caselawResult.error.message || JSON.stringify(caselawResult.error)}`);
        } else {
          console.log(`Caselaw-filtered vector search: ${caselawMatches.length} chunks`);
        }

        const keywordMatches: LocalMatch[] = (!keywordResult.error && keywordResult.data) ? keywordResult.data : [];

        // Surface RPC errors instead of silently dropping
        for (const r of vectorResults) {
          if (r.error) {
            console.error(`match_legal_chunks RPC error for query "${(r.query || "").slice(0, 40)}...": ${r.error.message || JSON.stringify(r.error)}`);
          }
        }
        let vectorMatches: LocalMatch[] = vectorResults.flatMap(r =>
          (!r.error && r.data) ? r.data as LocalMatch[] : []
        );
        // Merge in caselaw-filtered results (Fix #2) AND landmark-injected docs (Layer 2):
        // dedupe by chunk_id, keeping higher similarity
        const vecMap = new Map<string, LocalMatch>();
        for (const m of vectorMatches) vecMap.set(m.chunk_id, m);
        for (const m of caselawMatches) {
          const existing = vecMap.get(m.chunk_id);
          if (!existing || (m.similarity || 0) > (existing.similarity || 0)) {
            vecMap.set(m.chunk_id, m);
          }
        }
        for (const m of landmarkInjected) {
          const existing = vecMap.get(m.chunk_id);
          if (!existing || (m.similarity || 0) > (existing.similarity || 0)) {
            vecMap.set(m.chunk_id, m);
          }
        }
        vectorMatches = Array.from(vecMap.values());

        // Safety-net: if 0 vector hits at 0.45, retry once at 0.35 with the first available embedding
        if (vectorMatches.length === 0) {
          const firstEmbedding = vectorResults.find(r => r.embedding)?.embedding;
          if (firstEmbedding) {
            console.log("Vector search safety-net retry at threshold 0.35");
            const retry = await adminClient.rpc("match_legal_chunks", {
              query_embedding: JSON.stringify(firstEmbedding),
              match_threshold: 0.35,
              match_count: 8,
            });
            if (retry.error) {
              console.error(`Safety-net match_legal_chunks RPC error: ${retry.error.message || JSON.stringify(retry.error)}`);
            } else if (retry.data) {
              vectorMatches = retry.data as LocalMatch[];
              console.log(`Safety-net returned ${vectorMatches.length} chunks at threshold 0.35`);
            }
          }
        }

        // Diagnostic: top-3 raw vector similarities
        const topVectorSims = [...vectorMatches]
          .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
          .slice(0, 3)
          .map(m => (m.similarity || 0).toFixed(3));
        console.log(`Vector search: top 3 raw similarities = [${topVectorSims.join(", ")}]`);
        console.log(`Keyword search: ${keywordMatches.length} results | Vector search: ${vectorMatches.length} results (across ${queriesForEmbedding.length} ${queriesForEmbedding.length === 1 ? "query" : "queries"})`);
        if (keywordMatches.length === 0) {
          console.log(`Keyword search returned 0 results — check Postgres NOTICE logs for fallback chain (top-2 → top-1 → plainto)`);
        }

        // FUNNEL CHECKPOINT 1–3: raw retrieval per source_type
        retrievalFunnel.raw_keyword = tallyByType(keywordMatches);
        retrievalFunnel.raw_vector = tallyByType(vectorMatches);
        retrievalFunnel.raw_caselaw_filtered = tallyByType(caselawMatches);
        console.log(`FUNNEL raw_keyword: ${JSON.stringify(retrievalFunnel.raw_keyword)}`);
        console.log(`FUNNEL raw_vector: ${JSON.stringify(retrievalFunnel.raw_vector)}`);
        console.log(`FUNNEL raw_caselaw_filtered: ${JSON.stringify(retrievalFunnel.raw_caselaw_filtered)}`);

        // ── Content-aware similarity bonus ──────────────────────────
        // Pair the question's action verbs with their nominal/legal counterparts
        // and award a small bonus to chunks whose content contains the counterpart.
        // This rescues on-topic chunks (e.g. בג"ץ גילון on AG dismissal) that
        // get out-scored by broader articles when the expanded query is generic.
        const VERB_TOPIC_PAIRS: Array<{ trigger: RegExp; topicTerms: string[] }> = [
          { trigger: /(לפטר|פיטור|להדיח|הדחה|להפסיק|הפסקת|לסיים|סיום\s+כהונ)/, topicTerms: ["פיטור", "פיטורי", "הפסקת כהונ", "סיום כהונ", "הדחה", "מנגנון הפסקת", "להפסיק את כהונ", "סיים את כהונ"] },
          { trigger: /(למנות|מינוי|להחליף)/, topicTerms: ["מינוי", "ועדת המינויים", "הליך מינוי", "מתמנה"] },
          { trigger: /(לעצור|מעצר|לעכב|עיכוב)/, topicTerms: ["מעצר", "עיכוב הליכים", "מעצר עד תום ההליכים"] },
          { trigger: /(להחרים|חילוט|תפיסה)/, topicTerms: ["חילוט", "תפיסת רכוש", "החרמה"] },
        ];
        const questionFull = `${question} ${expandedQuery || ""}`;
        const activePairs = VERB_TOPIC_PAIRS.filter(p => p.trigger.test(questionFull));
        if (activePairs.length > 0) {
          console.log(`Content-aware bonus active for triggers: ${activePairs.map(p => p.topicTerms[0]).join(", ")}`);
        }
        const applyBonus = (m: LocalMatch): LocalMatch => {
          if (activePairs.length === 0 || !m.chunk_content) return m;
          const content = m.chunk_content;
          let bonus = 0;
          for (const pair of activePairs) {
            if (pair.topicTerms.some(t => content.includes(t))) {
              bonus = 0.08;
              break;
            }
          }
          return bonus > 0 ? { ...m, similarity: (m.similarity || 0) + bonus } : m;
        };

        // Merge and deduplicate by chunk_id, keeping higher similarity (after bonus)
        const mergedMap = new Map<string, LocalMatch>();
        for (const m of keywordMatches.map(applyBonus)) {
          mergedMap.set(m.chunk_id, m);
        }
        for (const m of vectorMatches.map(applyBonus)) {
          const existing = mergedMap.get(m.chunk_id);
          if (!existing || m.similarity > existing.similarity) {
            mergedMap.set(m.chunk_id, m);
          }
        }

        // Fix #1: Reserve a quota for caselaw so precedent isn't crowded out by
        // denser academic prose. Layer 3: top 6 caselaw + top 6 non-caselaw (was 4/8).
        const sortedAll = Array.from(mergedMap.values())
          .sort((a, b) => b.similarity - a.similarity);
        const caselawTop = sortedAll.filter(m => m.source_type === "caselaw").slice(0, 6);
        const otherTop = sortedAll.filter(m => m.source_type !== "caselaw").slice(0, 6);
        const reservedIds = new Set([...caselawTop, ...otherTop].map(m => m.chunk_id));
        const mergedBase = [...caselawTop, ...otherTop]
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 12);

        // ── Soft guaranteed minimum w/ relevance floor ──────────────────
        // For each "must-have" source type that ended up with 0 representation
        // in the candidate pool, run a per-type supplementary vector search
        // (top 3, similarity >= 0.45). If nothing clears the floor, accept
        // absence — never stuff irrelevant chunks just to hit a quota.
        // The reranker still has the final say.
        const SOFT_MIN_TYPES = ["israeli_law", "knesset_research"] as const;
        const SOFT_MIN_THRESHOLD = 0.45;
        const SOFT_MIN_PER_TYPE = 3;
        const presentTypes = new Set(mergedBase.map(m => m.source_type));
        const missingTypes = SOFT_MIN_TYPES.filter(t => !presentTypes.has(t));
        const supplementalAddedByType: Record<string, number> = {};
        const supplementalConsideredByType: Record<string, number> = {};
        if (missingTypes.length > 0) {
          const supplementalEmbedding = vectorResults.find(r => r.embedding)?.embedding;
          if (supplementalEmbedding) {
            console.log(`Soft-min supplementary: missing types = [${missingTypes.join(", ")}]`);
            const supplementalResults = await Promise.all(missingTypes.map(async (t) => {
              const r = await adminClient.rpc("match_legal_chunks_filtered", {
                query_embedding: JSON.stringify(supplementalEmbedding),
                filter_source_type: t,
                match_threshold: SOFT_MIN_THRESHOLD,
                match_count: SOFT_MIN_PER_TYPE,
              });
              if (r.error) {
                console.error(`Soft-min supplementary RPC error for ${t}: ${r.error.message || JSON.stringify(r.error)}`);
                return { type: t, matches: [] as LocalMatch[] };
              }
              return { type: t, matches: (r.data || []) as LocalMatch[] };
            }));
            const existingIds = new Set(mergedBase.map(m => m.chunk_id));
            for (const { type, matches } of supplementalResults) {
              supplementalConsideredByType[type] = matches.length;
              const fresh = matches.filter(m => !existingIds.has(m.chunk_id));
              for (const m of fresh) {
                mergedBase.push(m);
                existingIds.add(m.chunk_id);
              }
              supplementalAddedByType[type] = fresh.length;
              console.log(`Soft-min ${type}: considered=${matches.length} (>=${SOFT_MIN_THRESHOLD}), added=${fresh.length} (after dedup)`);
            }
          } else {
            console.log(`Soft-min supplementary skipped: no embedding available for missing types [${missingTypes.join(", ")}]`);
          }
        } else {
          console.log(`Soft-min supplementary: all target types present, skipping`);
        }

        const merged = mergedBase;
        const caselawKept = merged.filter(m => m.source_type === "caselaw").length;
        console.log(`Caselaw quota: ${caselawKept} caselaw / ${merged.length - caselawKept} other (total ${merged.length})`);
        // FUNNEL CHECKPOINT 4: after merge + dedup + 6/6 caselaw quota + soft-min supplements
        retrievalFunnel.after_dedup_quota = tallyByType(merged);
        retrievalFunnel.soft_min_supplementary = {
          missing_types: missingTypes,
          threshold: SOFT_MIN_THRESHOLD,
          per_type_cap: SOFT_MIN_PER_TYPE,
          considered_by_type: supplementalConsideredByType,
          added_by_type: supplementalAddedByType,
        };
        const droppedByQuota = (retrievalFunnel.raw_keyword.total + retrievalFunnel.raw_vector.total + retrievalFunnel.raw_caselaw_filtered.total) - merged.length;
        if (droppedByQuota > 0) bumpDrop("dedup_or_quota", droppedByQuota);
        console.log(`FUNNEL after_dedup_quota: ${JSON.stringify(retrievalFunnel.after_dedup_quota)}`);
        console.log(`FUNNEL soft_min_supplementary: ${JSON.stringify(retrievalFunnel.soft_min_supplementary)}`);
        // Suppress unused warning
        void reservedIds;

        // Layer 4 diagnostic: report rank/similarity of any landmark case in candidate pool
        if (landmarkCaseNumbers.length > 0) {
          const landmarkChunkIds = new Set(landmarkInjected.map(m => m.chunk_id));
          const landmarkInPool = sortedAll
            .map((m, idx) => ({ m, rank: idx + 1 }))
            .filter(x =>
              landmarkChunkIds.has(x.m.chunk_id) ||
              landmarkCaseNumbers.some(cn => (x.m.metadata as Record<string, unknown>)?.case_number === cn)
            );
          if (landmarkInPool.length === 0) {
            console.log(`Landmark diagnostic: NONE of [${landmarkCaseNumbers.join(", ")}] reached the candidate pool`);
          } else {
            for (const { m, rank } of landmarkInPool) {
              const cn = (m.metadata as Record<string, unknown>)?.case_number || "?";
              const inMerged = merged.some(x => x.chunk_id === m.chunk_id) ? "KEPT" : "DROPPED";
              console.log(`Landmark diagnostic: case_number=${cn} rank=${rank}/${sortedAll.length} sim=${(m.similarity || 0).toFixed(3)} → ${inMerged}`);
            }
          }
        }

        if (merged.length > 0) {
          console.log(`Hybrid search: ${merged.length} unique chunks after merge`);
          return { matches: merged, used: true };
        }

        // Fallback: try with fewer keywords
        if (keywords.split(" ").length > 3) {
          const fewerKeywords = keywords.split(" ").slice(0, 3).join(" ");
          console.log(`Retry with fewer keywords: "${fewerKeywords}"`);
          const { data: retryMatches, error: retryError } = await adminClient.rpc("search_legal_chunks_text", {
            search_query: fewerKeywords,
            match_count: 15,
          });
          if (!retryError && retryMatches && retryMatches.length > 0) {
            console.log(`Retry search: found ${retryMatches.length} matching chunks`);
            return { matches: retryMatches, used: true };
          }
        }
      } catch (err) {
        console.error("Hybrid search failed (non-fatal):", err);
      }
      return { matches: [], used: false };
    })();

    const perplexityPromise = (async (): Promise<{ content: string; citations: string[] }> => {
      const systemMsg = {
        role: "system" as const,
        content: `Israeli law research assistant. Find PRIMARY legal sources only: statutes with ס"ח/ק"ת page numbers, court decisions with exact case numbers, academic books/articles. No blogs or law firm sites.`,
      };
      // Stage B: append planner external_query hints to the Perplexity prompt
      const externalHints = (decomposedPlan?.query_plan || [])
        .map((p) => p.external_query)
        .filter((q): q is string => Boolean(q && q.trim()))
        .slice(0, 4);
      const perplexityQuestion = externalHints.length > 0
        ? `${question}\n\nהיבטים נוספים לחיפוש:\n${externalHints.map((h, i) => `${i + 1}. ${h}`).join("\n")}`
        : question;
      const userMsg = { role: "user" as const, content: perplexityQuestion };

      // Two attempts: full prompt with 30s, then short prompt with 20s on AbortError.
      const attempts = [
        { timeoutMs: 30000, messages: [systemMsg, userMsg], label: "primary" },
        { timeoutMs: 20000, messages: [userMsg], label: "retry-short" },
      ];

      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        try {
          const res = await fetchWithTimeout("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "sonar-pro",
              search_domain_filter: TRUSTED_LEGAL_DOMAINS,
              messages: attempt.messages,
            }),
          }, attempt.timeoutMs);

          if (res.ok) {
            const data = await res.json();
            const content = data.choices?.[0]?.message?.content || "";
            const cits = data.citations || [];
            console.log(`Perplexity ${attempt.label} returned ${cits.length} citations`);
            return { content, citations: cits };
          } else {
            const errText = await res.text();
            console.error(`Perplexity ${attempt.label} error (non-fatal):`, res.status, errText);
            // Non-timeout HTTP error: don't bother retrying.
            break;
          }
        } catch (err) {
          const isAbort = err instanceof DOMException && err.name === "AbortError";
          if (isAbort && i === 0) {
            console.log(`Perplexity ${attempt.label} timed out after ${attempt.timeoutMs}ms — retrying with shorter prompt...`);
            continue;
          }
          console.error(`Perplexity ${attempt.label} call failed (non-fatal):`, err);
          break;
        }
      }
      return { content: "", citations: [] };
    })();

    const [localResult, perplexityResult] = await Promise.all([localSearchPromise, perplexityPromise]);

    const localMatches = localResult.matches;
    const usedLocalSearch = localResult.used;
    const searchResults = perplexityResult.content;
    const citations = perplexityResult.citations;

    // ========= Step 1b: Enrich incomplete journal articles via Perplexity =========
    const incompleteArticles = localMatches.filter(m =>
      m.source_type === "journal_article" &&
      (!(m.metadata as Record<string, unknown>)?.author || !(m.metadata as Record<string, unknown>)?.year)
    );

    if (incompleteArticles.length > 0 && PERPLEXITY_API_KEY) {
      const journalMapEnrich: Record<string, string> = { mishpatim: "משפטים", tau_law_review: "עיוני משפט", hapraklit: "הפרקליט", runilawreview: "משפט ועסקים" };
      const enrichmentPromises = incompleteArticles.slice(0, 3).map(async (article) => {
        try {
          const artMeta = (article.metadata || {}) as Record<string, unknown>;
          const jName = (artMeta.journal as string) || journalMapEnrich[(artMeta.source_site as string) || ""] || "";
          const vName = (artMeta.volume as string) || "";
          const enrichPrompt = `מצא את שם המחבר ושנת הפרסום של המאמר האקדמי הישראלי: "${article.document_title}".${jName ? ` המאמר פורסם בכתב העת ${jName}` : ""}${vName ? ` ${vName}` : ""}. החזר רק בפורמט: מחבר: [שם], שנה: [שנה לועזית בת 4 ספרות]`;
          const res = await fetchWithTimeout("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "sonar",
              messages: [{ role: "user", content: enrichPrompt }],
            }),
          }, 8000);
          const data = await res.json();
          const text = data.choices?.[0]?.message?.content || "";
          const authorMatch = text.match(/מחבר:\s*(.+?)(?:,|\n|$)/);
          const yearMatch = text.match(/שנה:\s*(\d{4})/);
          if (authorMatch) article.metadata = { ...(article.metadata || {}), author: authorMatch[1].trim() };
          if (yearMatch) {
            const enrichedYear = yearMatch[1];
            // Reject if year looks like it was confused with volume number
            const volNum = vName.match(/\d+/)?.[0];
            const yearLastTwo = enrichedYear.slice(-2);
            if (volNum && (yearLastTwo === volNum || `20${volNum}` === enrichedYear || `19${volNum}` === enrichedYear)) {
              console.log(`Rejected suspicious year ${enrichedYear} (matches volume ${volNum}) for "${article.document_title.slice(0, 40)}"`);
            } else {
              article.metadata = { ...(article.metadata || {}), year: enrichedYear };
            }
          }
          console.log(`Enriched article "${article.document_title.slice(0, 40)}": author=${authorMatch?.[1] || "?"}, year=${yearMatch?.[1] || "?"}`);
        } catch (e) { /* skip enrichment on error */ }
      });
      await Promise.all(enrichmentPromises);
    }

    const tRetrieval = Date.now();
    console.log(`Retrieval took ${tRetrieval - t0}ms`);

    // ========= Step 1c: AI-based re-ranking of local sources =========
    let rankedMatches: RankedMatch[] = localMatches.map(m => ({ ...m }));
    if (localMatches.length > 0 && LOVABLE_API_KEY) {
      try {
        rankedMatches = await rerankLocalMatches(localMatches, question, LOVABLE_API_KEY);
        const tRerank = Date.now();
        console.log(`Re-ranking took ${tRerank - tRetrieval}ms, kept ${rankedMatches.length}/${localMatches.length} chunks`);

        // FUNNEL CHECKPOINT 5: per-source-type breakdown after rerank gate
        retrievalFunnel.after_rerank = tallyByType(rankedMatches);
        const keptDocIds = new Set(rankedMatches.map(m => m.document_id));
        const inputByDoc = new Map<string, { source_type: string; title: string }>();
        for (const m of localMatches) {
          if (!inputByDoc.has(m.document_id)) {
            inputByDoc.set(m.document_id, { source_type: m.source_type || "other", title: m.document_title || "" });
          }
        }
        let droppedRerankByType: Record<string, number> = {};
        for (const [docId, info] of inputByDoc) {
          if (!keptDocIds.has(docId)) {
            const t = (info.source_type || "other").toLowerCase();
            droppedRerankByType[t] = (droppedRerankByType[t] || 0) + 1;
            retrievalFunnel.rerank_dropped_docs.push({
              title: info.title.slice(0, 80),
              source_type: info.source_type,
              score: -1, // score not exposed by rerank fn; -1 = unknown
              reason: "rerank_gate_or_top6_slice",
            });
          }
        }
        const droppedRerankTotal = Object.values(droppedRerankByType).reduce((a, b) => a + b, 0);
        if (droppedRerankTotal > 0) bumpDrop("rerank_gate_or_top6_slice", droppedRerankTotal);
        console.log(`FUNNEL after_rerank: ${JSON.stringify(retrievalFunnel.after_rerank)}`);
        console.log(`FUNNEL rerank_dropped_by_type: ${JSON.stringify(droppedRerankByType)}`);
      } catch (err) {
        console.error("Re-ranking error (non-fatal):", err);
      }
    }

    if (rankedMatches.length === 0 && !searchResults && !hasDocument) {
      const payload = await refundAndPayload("legal-qa:no-sources", { error: "לא נמצאו מקורות רלוונטיים. נסו לנסח את השאלה אחרת." });
      return new Response(
        JSON.stringify(payload),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ========= Step 2: Build source cards (server-side) =========
    const sourceCards: SourceCard[] = [];
    let cardId = 1;

    // Local sources — build rich citations from structured fields (using re-ranked matches)
    if (rankedMatches.length > 0) {
      const seenDocs = new Set<string>();
      let filteredBrokenKnesset = 0;
      // FUNNEL: per-source-type rejections inside the source-card loop.
      const cardLoopDrops = { dedup_per_doc: {} as Record<string, number>, blog_url: {} as Record<string, number>, broken_title_knesset: 0, caselaw_no_usable_title: 0 };
      const bumpType = (bag: Record<string, number>, t: string) => { bag[t] = (bag[t] || 0) + 1; };
      for (const m of rankedMatches) {
        const stForLog = (m.source_type || "other").toLowerCase();
        if (seenDocs.has(m.document_id)) {
          bumpType(cardLoopDrops.dedup_per_doc, stForLog);
          continue;
        }
        seenDocs.add(m.document_id);
        if (isBlogUrl(m.source_url || undefined)) {
          bumpType(cardLoopDrops.blog_url, stForLog);
          continue;
        }

        // Filter broken-title Knesset research docs (placeholder title or flagged in metadata).
        // These have generic "פרטי מסמך" titles from a scraping failure and cannot be cited usefully.
        if (m.source_type === "knesset_research") {
          const titleTrim = (m.document_title || "").trim();
          const metaFlag = (m.metadata as Record<string, unknown> | null)?.broken_title === true;
          if (titleTrim === "פרטי מסמך" || titleTrim === "ללא כותרת" || titleTrim === "" || metaFlag) {
            filteredBrokenKnesset++;
            cardLoopDrops.broken_title_knesset++;
            continue;
          }
        }

        // Build a richer citation from structured metadata
        let richCitation = m.document_citation;
        const meta = (m.metadata || {}) as Record<string, unknown>;

        if (m.source_type === "caselaw") {
          // For case law: use case_number, court, decision_date, title.
          // Guard: skip cards without a usable title — emitting just "case_number (court)"
          // produces fake citations like "20.1.5931 (בתי משפט השלום)" without parties.
          const caseNumber = (meta.case_number as string) || "";
          const court = (meta.court as string) || "";
          const decisionDate = (meta.decision_date as string) || "";
          const titleTrim = (m.document_title || "").trim();
          const hasParties = /נ['"׳״]/.test(titleTrim);
          const isUsableTitle = titleTrim.length >= 8 && (hasParties || /[א-ת]{4,}/.test(titleTrim));
          if (!isUsableTitle) {
            console.log(`Skipping caselaw card without usable title: case=${caseNumber || "?"}, title="${titleTrim}"`);
            cardLoopDrops.caselaw_no_usable_title++;
            continue;
          }
          if (caseNumber) {
            richCitation = `${caseNumber} ${m.document_title}`;
            if (court) richCitation += ` (${court}`;
            if (decisionDate) richCitation += `, ${decisionDate}`;
            if (court) richCitation += ")";
          }
        } else if (m.source_type === "knesset_research") {
          // For knesset research: use title as-is
          richCitation = m.document_title || m.document_citation;
        } else if (m.source_type === "journal_article") {
          // For journal articles: build academic citation from metadata
          const author = (meta.author as string) || "";
          const journalMap: Record<string, string> = {
            mishpatim: "משפטים",
            tau_law_review: "עיוני משפט",
            hapraklit: "הפרקליט",
            runilawreview: "משפט ועסקים",
          };
          const journal = (meta.journal as string) || journalMap[(meta.source_site as string) || ""] || "";
          const vol = (meta.volume as string) || "";

          // Extract starting page from URL patterns (e.g. /article/{issue}/{page})
          let startPage = (meta.page as string) || "";
          if (!startPage && m.source_url) {
            const pageMatch = m.source_url.match(/\/article\/\d+\/(\d+)/);
            if (pageMatch) startPage = pageMatch[1];
          }

          richCitation = author ? `${author} "${m.document_title}"` : `"${m.document_title}"`;
          if (journal) richCitation += ` **${journal}**`;
          if (vol) richCitation += ` ${vol}`;
          if (startPage) richCitation += ` ${startPage}`;
          const year = (meta.year as string) || "";
          if (year) richCitation += ` (${year})`;
        }

        const sourceLabel = m.source_type === "caselaw" ? "פסיקה" :
          m.source_type === "knesset_research" ? "מחקר כנסת / חקיקה" :
          m.source_type === "journal_article" ? "מאמר אקדמי" :
          m.source_type === "israeli_law" ? "חקיקה ישראלית" : m.source_type;

        sourceCards.push({
          id: cardId++,
          citation: richCitation,
          source_type: sourceLabel,
          url: m.source_url || undefined,
          provenance: "local",
          excerpt: m.chunk_content.slice(0, 400),
          case_number: m.source_type === "caselaw" ? ((meta.case_number as string) || undefined) : undefined,
          // Milestone A.5: carry retrieval similarity through to the source pack
          // so assembleSourcePack can apply the relevance gate when promoting
          // knesset_research / journal_article items to `core`.
          relevance_score: typeof m.similarity === "number" ? m.similarity : 0,
        });
      }
      if (filteredBrokenKnesset > 0) {
        console.log(`Filtered ${filteredBrokenKnesset} broken-title knesset docs from source pool`);
      }
      // FUNNEL CHECKPOINT 6+7: per-source-type after the source-card loop
      // Tally local source cards by their *original* source_type (not the Hebrew label).
      const localCardsTallySource: Array<{ source_type: string }> = [];
      for (const sc of sourceCards) {
        if (sc.provenance !== "local") continue;
        // Map Hebrew labels back to source_type for funnel categorization
        const label = sc.source_type;
        const mapped =
          label === "פסיקה" ? "caselaw" :
          label === "מחקר כנסת / חקיקה" ? "knesset_research" :
          label === "מאמר אקדמי" ? "journal_article" :
          label === "חקיקה ישראלית" ? "israeli_law" : "other";
        localCardsTallySource.push({ source_type: mapped });
      }
      retrievalFunnel.after_broken_title_filter = tallyByType(localCardsTallySource);
      retrievalFunnel.source_cards_local = retrievalFunnel.after_broken_title_filter;
      // Roll up card-loop drops into drop_reasons
      for (const [t, n] of Object.entries(cardLoopDrops.dedup_per_doc)) bumpDrop(`card_dedup_${t}`, n);
      for (const [t, n] of Object.entries(cardLoopDrops.blog_url)) bumpDrop(`blog_url_${t}`, n);
      if (cardLoopDrops.broken_title_knesset > 0) bumpDrop("broken_title_knesset", cardLoopDrops.broken_title_knesset);
      if (cardLoopDrops.caselaw_no_usable_title > 0) bumpDrop("caselaw_no_usable_title", cardLoopDrops.caselaw_no_usable_title);
      console.log(`FUNNEL after_broken_title_filter (== source_cards_local): ${JSON.stringify(retrievalFunnel.after_broken_title_filter)}`);
      console.log(`FUNNEL drop_reasons: ${JSON.stringify(retrievalFunnel.drop_reasons)}`);
      console.log(`FUNNEL FULL: ${JSON.stringify(retrievalFunnel)}`);
    }

    // Perplexity sources — extract from citations array
    if (citations.length > 0) {
      const KNESSET_PROTOCOL_RE = /fs\.knesset\.gov\.il\/(\d+)\/(?:Committees|Plenum)\//i;
      for (const citUrl of citations.slice(0, 8)) {
        if (isBlogUrl(citUrl)) continue;
        const protMatch = citUrl.match(KNESSET_PROTOCOL_RE);
        const isProtocol = !!protMatch;
        sourceCards.push({
          id: cardId++,
          // For Knesset protocols, prefix the URL with a Rule 8.3 hint so the AI
          // formats it correctly instead of falling back to Rule 34.2 ("פורסם באתר כנסת").
          citation: isProtocol
            ? `[פרוטוקול ישיבה — עצב לפי כלל 8.3: הכנסת ה-${protMatch![1]}; השמט מספר ישיבה אם לא ידוע; אסור "פורסם באתר הכנסת"; אסור [חסר: שם מומחה/מחבר]] ${citUrl}`
            : citUrl,
          source_type: isProtocol ? "protocol" : "web",
          url: citUrl,
          provenance: "perplexity",
          excerpt: "",
        });
      }
    }

    // Document source
    if (hasDocument) {
      sourceCards.push({
        id: cardId++,
        citation: documentName || "מסמך שהועלה",
        source_type: "document",
        provenance: "document",
        excerpt: documentText.slice(0, 300),
      });
    }

    const localCount = sourceCards.filter(sc => sc.provenance === "local").length;
    const perplexityCount = sourceCards.filter(sc => sc.provenance === "perplexity").length;
    const docCount = sourceCards.filter(sc => sc.provenance === "document").length;
    console.log(`Source cards: ${localCount} local, ${perplexityCount} perplexity, ${docCount} document`);
    console.log(`Final source mix: ${localCount} local / ${perplexityCount} perplexity (+ ${docCount} doc)`);

    // ─── Tier-1.5 fix: finalize the parallel decomposition promise BEFORE
    // assembling source pack v2. Previously this await happened AFTER the
    // sourcePack block, so `decomposedPlan` was still null when we tried to
    // map decompositionV2 → forcing the structured drafter gate to fail
    // silently. Retrieval is already complete here, so awaiting is free.
    if (decompPromise) {
      const decompRes = await decompPromise;
      // Push the failed first attempt first (if any), then the final attempt,
      // so qa_logs.metadata.stage_runs reflects the true retry sequence.
      if (decompRes.retryRun) stageRuns.push(decompRes.retryRun);
      stageRuns.push(decompRes.run);
      decomposedPlan = decompRes.data;
      writeCheckpoint("decomposition");
    }

    // ========= Stage C: Source Pack assembly (legal_research only, INTERNAL) =========
    let sourcePack: SourcePackEntry[] = [];
    let sourcePackV2: LegalSourcePack | null = null;
    if (enableDeepPipeline) {
      sourcePack = sourceCards.map((sc) => {
        const excerpt = sc.excerpt || "";
        const anchorPresent = Boolean(sc.url) || sc.provenance === "local" || sc.provenance === "document";
        return {
          source_id: sc.id,
          title: sc.citation,
          source_type: sc.source_type,
          authority_class: classifyAuthority(sc.source_type, sc.citation, sc.url),
          url: sc.url,
          provenance: sc.provenance,
          excerpt,
          case_number: sc.case_number,
          usable_for_analysis: excerpt.length > 300,
          usable_for_citation: sc.citation.length > 15,
          anchor_present: anchorPresent,
          // Milestone A.5: carry through for assembleSourcePack relevance gate.
          relevance_score: sc.relevance_score ?? 0,
        };
      });
      console.log(`[source-pack] ${sourcePack.length} entries; anchored=${sourcePack.filter((s) => s.anchor_present).length}`);

      // V2 contract: assemble formal LegalSourcePack from internal entries.
      // Gate ≥2 entries (matches the claim-map prerequisite below).
      if (sourcePack.length >= 2) {
        sourcePackV2 = assembleSourcePack(sourcePack as InternalSourcePackEntry[]);
        // decomposedPlan is now resolved (we awaited above), so this mapping
        // succeeds whenever decomposition itself succeeded.
        if (decomposedPlan) {
          decompositionV2 = mapToDecompositionV2(decomposedPlan, hasDocument, question);
        }
        const sps = summarizeSourcePack(sourcePackV2);
        console.log(`[source-pack-v2] core=${sps.core} supporting=${sps.supporting} secondary=${sps.secondary} anchored=${sps.anchored}`);
      }
    }

    // ========= Stage E.5: Perplexity Completion (Milestone B) =========
    // Fires only if local source-pack assembly produced fewer than 2 core items.
    // Validated candidates are pushed into sourceCards/sourcePack with provenance
    // "perplexity_completion", then sourcePackV2 is re-assembled so they land in
    // the core bucket before Stage D builds the claim map.
    if (enableDeepPipeline && !evalForceLegacy) {
      const coreBefore = sourcePackV2 ? summarizeSourcePack(sourcePackV2).core : 0;
      if (coreBefore < modeProfile.perplexityCompletionMinAnchored) {
        const tE5 = Date.now();
        const subIssuesForCompletion = Array.isArray(decomposedPlan?.decomposition?.sub_issues)
          ? (decomposedPlan!.decomposition.sub_issues as string[]).filter((s) => typeof s === "string" && s.length > 0)
          : [];
        const externalHints: string[] = [];
        let completion;
        try {
          const decompV2ForCompletion = decompositionV2 ?? (decomposedPlan ? mapToDecompositionV2(decomposedPlan, hasDocument, question) : null);
          completion = await runPerplexityCompletion(
            question,
            decompV2ForCompletion,
            subIssuesForCompletion,
            externalHints,
          );
        } catch (e) {
          console.warn("[stage-e5] runPerplexityCompletion threw:", e);
          completion = null;
        }

        if (completion && completion.validated.length > 0) {
          for (const v of completion.validated) {
            const newCard: SourceCard = {
              id: cardId++,
              citation: v.citation,
              source_type: v.type === "caselaw" ? "caselaw" : "israeli_law",
              url: v.url,
              provenance: "perplexity_completion",
              excerpt: v.relevance_note || "",
              case_number: v.case_number,
              completion_candidate_type: v.type,
            };
            sourceCards.push(newCard);
            sourcePack.push({
              source_id: newCard.id,
              title: newCard.citation,
              source_type: newCard.source_type,
              authority_class: classifyAuthority(newCard.source_type, newCard.citation, newCard.url),
              url: newCard.url,
              provenance: "perplexity_completion",
              excerpt: newCard.excerpt,
              case_number: newCard.case_number,
              usable_for_analysis: false,         // citation-only anchor
              usable_for_citation: true,
              anchor_present: true,
              relevance_score: 0.9,
              completion_candidate_type: v.type,
            });
          }
          // Re-assemble the source pack so completion candidates land in core.
          sourcePackV2 = assembleSourcePack(sourcePack as InternalSourcePackEntry[]);
        }

        const coreAfter = sourcePackV2 ? summarizeSourcePack(sourcePackV2).core : coreBefore;
        retrievalFunnel.perplexity_completion = {
          triggered: completion?.result?.triggered ?? false,
          reason: completion?.result?.reason ?? "skipped",
          status: completion?.result?.status ?? "skipped",
          core_before: coreBefore,
          core_after: coreAfter,
          candidates_returned: completion?.result?.candidates_returned ?? 0,
          candidates_kept: completion?.result?.candidates_kept ?? 0,
          candidates_by_type: completion?.result?.candidates_by_type ?? { statute: 0, caselaw: 0 },
          promoted_to_core: completion?.result?.promoted_to_core ?? 0,
          duration_ms: Date.now() - tE5,
          drops: completion?.result?.drops,
          engine_resolved_count: completion?.result?.engine_resolved_count ?? 0,
          engine_unresolved_count: completion?.result?.engine_unresolved_count ?? 0,
          engine_drop_reasons: completion?.result?.engine_drop_reasons ?? {},
          debug_candidates: completion?.result?.debug_candidates,
        };
        console.log(
          `[stage-e5] triggered status=${completion?.result?.status} returned=${completion?.result?.candidates_returned ?? 0} kept=${completion?.result?.candidates_kept ?? 0} engine_resolved=${completion?.result?.engine_resolved_count ?? 0}/${completion?.result?.candidates_kept ?? 0} core ${coreBefore}→${coreAfter} (${Date.now() - tE5}ms)`,
        );
      } else {
        retrievalFunnel.perplexity_completion = {
          triggered: false,
          reason: "skipped_healthy",
          status: "skipped",
          core_before: coreBefore,
          core_after: coreBefore,
          candidates_returned: 0,
          candidates_kept: 0,
          candidates_by_type: { statute: 0, caselaw: 0 },
          promoted_to_core: 0,
          duration_ms: 0,
        };
      }
    }

    // ========= Stage E.6: Round-2 retrieval (Deep mode only) =========
    // Profile-gated: when modeProfile.retrievalRounds >= 2, run a second
    // local-search pass scoped to the planner's external_query items + any
    // remaining sub_issues. Only chunks whose document_id is NOT already
    // represented in sourceCards are added (deduped at the document level).
    // This widens the source pool for Deep before the claim map is built.
    if (
      enableDeepPipeline &&
      !evalForceLegacy &&
      modeProfile.retrievalRounds >= 2 &&
      decomposedPlan
    ) {
      const tR2Start = Date.now();
      // Build round-2 query set from planner external_query then sub_issues.
      const planQueries: string[] = (decomposedPlan.query_plan || [])
        .map((p) => (typeof p?.external_query === "string" ? p.external_query.trim() : ""))
        .filter((q): q is string => q.length >= 4);
      const subIssues: string[] = Array.isArray(decomposedPlan.decomposition?.sub_issues)
        ? (decomposedPlan.decomposition.sub_issues as unknown[])
            .filter((s): s is string => typeof s === "string" && s.trim().length >= 4)
            .map((s) => s.trim())
        : [];
      // De-dupe by lowercased text, keep first 4 to bound latency.
      const seenQ = new Set<string>();
      const round2Queries: string[] = [];
      for (const q of [...planQueries, ...subIssues]) {
        const key = q.toLowerCase();
        if (seenQ.has(key)) continue;
        seenQ.add(key);
        round2Queries.push(q);
        if (round2Queries.length >= 4) break;
      }

      if (round2Queries.length === 0) {
        retrievalFunnel.round_2 = {
          triggered: false,
          reason: "no_queries",
          queries: [],
          new_cards: 0,
          new_doc_ids: 0,
          duration_ms: 0,
        };
      } else {
        // Track doc_ids already present so we can dedupe.
        const existingDocIds = new Set<string>();
        for (const sc of sourceCards) {
          // sourceCards don't carry document_id directly; we use citation+url as
          // a stable key. This is fine because round-2 chunks come from the
          // same RPC and we have document_citation to compare against.
          existingDocIds.add(`${sc.citation}|${sc.url ?? ""}`);
        }

        // Run round-2 searches in parallel.
        const round2Results = await Promise.all(
          round2Queries.map(async (q) => {
            try {
              const { data } = await adminClient.rpc("search_legal_chunks_text", {
                search_query: q,
                match_count: 6,
              });
              return { q, matches: Array.isArray(data) ? data : [] };
            } catch (e) {
              console.warn(`[round-2] query "${q.slice(0, 40)}…" failed:`, (e as Error).message);
              return { q, matches: [] };
            }
          }),
        );

        // Collect new cards (deduped per document_citation+url).
        let newCardsAdded = 0;
        const newDocKeys = new Set<string>();
        for (const { matches } of round2Results) {
          for (const m of matches) {
            const docKey = `${m.document_citation}|${m.source_url ?? ""}`;
            if (existingDocIds.has(docKey) || newDocKeys.has(docKey)) continue;
            newDocKeys.add(docKey);

            const sourceLabel =
              m.source_type === "caselaw" ? "פסיקה" :
              m.source_type === "knesset_research" ? "מחקר כנסת / חקיקה" :
              m.source_type === "journal_article" ? "מאמר אקדמי" :
              m.source_type === "israeli_law" ? "חקיקה ישראלית" : m.source_type;

            const meta = (m.metadata || {}) as Record<string, unknown>;
            const newCard: SourceCard = {
              id: cardId++,
              citation: m.document_citation || m.document_title || "מקור משפטי",
              source_type: sourceLabel,
              url: m.source_url || undefined,
              provenance: "local",
              excerpt: (m.chunk_content || "").slice(0, 400),
              case_number: m.source_type === "caselaw" ? ((meta.case_number as string) || undefined) : undefined,
              relevance_score: typeof m.similarity === "number" ? m.similarity : 0.5,
            };
            sourceCards.push(newCard);
            sourcePack.push({
              source_id: newCard.id,
              title: newCard.citation,
              source_type: newCard.source_type,
              authority_class: classifyAuthority(newCard.source_type, newCard.citation, newCard.url),
              url: newCard.url,
              provenance: "local",
              excerpt: newCard.excerpt,
              case_number: newCard.case_number,
              usable_for_analysis: (newCard.excerpt?.length ?? 0) > 300,
              usable_for_citation: newCard.citation.length > 15,
              anchor_present: Boolean(newCard.url) || true, // local provenance
              relevance_score: newCard.relevance_score ?? 0.5,
            });
            newCardsAdded++;
          }
        }

        // Re-assemble V2 source pack so new cards can be classified into
        // core/supporting/secondary before Stage D consumes it.
        if (newCardsAdded > 0 && sourcePack.length >= 2) {
          sourcePackV2 = assembleSourcePack(sourcePack as InternalSourcePackEntry[]);
          const sps = summarizeSourcePack(sourcePackV2);
          console.log(`[round-2] +${newCardsAdded} cards (${newDocKeys.size} new docs); pack now core=${sps.core} supporting=${sps.supporting} secondary=${sps.secondary}`);
        }

        retrievalFunnel.round_2 = {
          triggered: true,
          reason: "profile_retrieval_rounds_2",
          queries: round2Queries,
          new_cards: newCardsAdded,
          new_doc_ids: newDocKeys.size,
          duration_ms: Date.now() - tR2Start,
        };
        console.log(`[round-2] ${round2Queries.length} queries, +${newCardsAdded} cards (${Date.now() - tR2Start}ms)`);
      }
    }

    // ========= Stage D: Claim Map (legal_research only, INTERNAL) =========
    let claimMap: ClaimMap | null = null;
    let claimMapAllowedCount = 0;
    let claimMapV2: LegalClaimMap | null = null;
    let draftingInput: LegalDraftingInput | null = null;
    if (enableDeepPipeline && !evalForceLegacy && decomposedPlan && sourcePack.length >= 2) {
      try {
        const tClaimStart = Date.now();
        // Trim before handing off to the planner. Final additional trimming
        // (220-char excerpt cap, 10-item cap) happens inside `buildClaimMap`,
        // but we also pre-truncate excerpts here so the JSON we send is small
        // even if the cap is later relaxed.
        const sourcePackBrief = sourcePack
          .filter((s) => s.usable_for_citation)
          .slice(0, 12)
          .map((s) => ({
            source_id: s.source_id,
            title: s.title,
            authority_class: s.authority_class,
            excerpt: (s.excerpt || "").slice(0, 300),
          }));
        const cmRes = await buildClaimMap(question, {
          decomposition: decomposedPlan.decomposition,
          sourcePackBrief,
        });
        stageRuns.push(cmRes.run);
        claimMap = cmRes.data;
        if (claimMap) {
          claimMapAllowedCount = claimMap.filter((c) => c.allowed_to_state).length;
          console.log(
            `[claim-map] ${claimMap.length} claims; ${claimMapAllowedCount} allowed (${Date.now() - tClaimStart}ms; ${cmRes.run.provider}/${cmRes.run.model}, status=${cmRes.run.status})`,
          );

          // V2 contract: map to LegalClaimMap + assemble LegalDraftingInput.
          if (decompositionV2 && sourcePackV2) {
            claimMapV2 = mapToClaimMapV2(claimMap, decompositionV2);
            const cms = summarizeClaimMapV2(claimMapV2);
            console.log(`[claim-map-v2] direct=${cms.direct} qualified=${cms.qualified} omit=${cms.omit} uncovered=${cms.uncovered_sub_issues.length}`);
            const allowedV2 = claimMapV2.claims.filter((c) => c.statementMode !== "omit").length;
            if (allowedV2 >= 2) {
              draftingInput = {
                userQuestion: question,
                decomposition: decompositionV2,
                sourcePack: sourcePackV2,
                claimMap: claimMapV2,
                userDocumentContext: hasDocument ? "available" : undefined,
                responseStyle: "regular",
              };
            }
          }
        } else {
          console.log(`[claim-map] returned null (status=${cmRes.run.status}, ${cmRes.run.duration_ms}ms) — drafter will fall back to legacy prompt`);
        }
      } catch (cmErr) {
        console.error("[claim-map] failed (non-fatal):", cmErr);
        claimMap = null;
      }
      // Persist checkpoint after claim_map regardless of success/failure.
      writeCheckpoint("claim_map");
    }

    // ========= Step 3: Build context for AI (without forcing tool_call) =========

    const contextParts: string[] = [];

    if (hasDocument) {
      contextParts.push(documentContext);
    }

    if (rankedMatches.length > 0) {
      const seenDocs = new Set<string>();
      let localContext = "\n=== [מאומת – מקור אמת לתוכן] מקורות מהמאגר המשפטי המקומי ===\n";
      localContext += "(תוכן הסעיפים, ההלכות והציטוטים המהותיים — חייב להיות מעוגן כאן בלבד)\n";
      for (const m of rankedMatches) {
        if (!seenDocs.has(m.document_id)) {
          seenDocs.add(m.document_id);
          const typeLabel = m.source_type === "caselaw" ? "פסיקה" :
            m.source_type === "knesset_research" ? "מחקר כנסת" :
            m.source_type === "journal_article" ? "מאמר אקדמי" :
            m.source_type === "israeli_law" ? "חקיקה ישראלית" : m.source_type;
          const relevanceTag = m.relevanceScore !== undefined ? ` | רלוונטיות: ${m.relevanceScore}/10` : "";
          localContext += `\n--- [מאומת] ${m.document_title} ---\nסוג מקור: ${typeLabel} | אזכור: ${m.document_citation}${relevanceTag}\n`;
          if (m.source_url) localContext += `קישור: ${m.source_url}\n`;
        }
        localContext += `${m.chunk_content.slice(0, 800)}\n`;
      }
      contextParts.push(localContext);
    }

    if (searchResults) {
      // Trim Perplexity body: keep only lines that look like bibliographic metadata
      // (years, ס"ח/ק"ת + page, volume references, journal/publisher hints).
      // Discard substantive prose so the model cannot lift content claims from it.
      const bibHintRe = /(ס"ח|ס״ח|ק"ת|ק״ת|פ"ד|פ״ד|פד"י|פד״י|כרך|חוברת|עמ['׳]?|עמוד|התש[א-ת"״''׳\-–]+|\b(19|20)\d{2}\b|נבו|תקדין|הוצאת|כתב\s+עת|משפטים|עיוני\s+משפט)/;
      const perplexityLines = searchResults
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l.length > 0 && l.length < 400 && bibHintRe.test(l))
        .slice(0, 30);
      const perplexityTrimmed = perplexityLines.join("\n");
      if (perplexityTrimmed) {
        contextParts.push(
          "\n=== [חיצוני – למטא-דאטה ביבליוגרפית בלבד] רמזים מ-Perplexity ===\n" +
          "(אסור לשאוב מכאן תוכן מהותי של סעיפים או הלכות — רק שנים, ס\"ח/ק\"ת, עמוד, כרך, מו\"ל, שם כתב עת)\n" +
          perplexityTrimmed.slice(0, 2000)
        );
      }
    }

    const combinedContext = truncateContext(contextParts.join("\n"), contextCharLimit);

    // Build source catalog string for the AI — tag local vs Perplexity distinctly
    const sourceCatalog = sourceCards.map(
      (sc) => {
        const tag =
          sc.provenance === "local"     ? " [מאומת – מקור אמת לתוכן]" :
          sc.provenance === "perplexity" ? " [חיצוני – למטא-דאטה בלבד]" :
          sc.provenance === "document"   ? " [מסמך משתמש]" : "";
        return `[${sc.id}]${tag} ${sc.citation}${sc.url ? ` (${sc.url})` : ""} — ${sc.source_type}`;
      }
    ).join("\n");

    // ========= Step 4: Gemini call — plain text, NO tool_call =========
    const taskInstructions = getTaskModeInstructions(taskMode);
    const citationInstructions = buildCitationInstructions();

    // For academic write_chapter: use the dedicated sub-mode prompt as additional instruction
    let academicChapterContext = "";
    if (isAcademicMode && academicStep === "write_chapter") {
      const subPrompt = getAcademicSubModePrompt("write_chapter", body);
      if (subPrompt) academicChapterContext = "\n\n" + subPrompt;
    }

    const systemPrompt = `אתה עוזר משפטי מומחה. כתוב חוות דעת משפטית מקצועית בעברית.
${taskInstructions}
${academicChapterContext}

כללי כתיבה:
- אורך: ${isAcademicChapter ? `${modeProfile.wordRangeMin}-${modeProfile.wordRangeMax}` : (isAcademicMode ? "500-1200" : "800-1500")} מילים. כל חלק חייב להיות מהותי.
- אל תשתמש בסימני # לכותרות. השתמש ב-**כותרת** (הדגשה) בלבד.
- השתמש בכותרות המודגשות שמפורטות במצב העבודה למעלה. אל תשתמש בכותרות אחרות.
- טון: פורמלי, אובייקטיבי ואנליטי. כל טענה משפטית חייבת להיות מעוגנת בהערת שוליים.
- העדף 8-12 הפניות איכותיות. השתמש אך ורק במקורות מהרשימה למעלה.
- אסור בהחלט לצטט מקורות שאינם מופיעים ברשימת המקורות הזמינים למעלה. אם אין מספיק מקורות ברשימה, כתוב פחות הערות שוליים — אל תמציא מקורות חדשים. עדיף מזכר עם 4 הערות שוליים אמיתיות מאשר 10 הערות שכוללות מקורות בדויים.

כלל קריטי – גוף טקסט נקי:
- בגוף הטקסט, אין לציין שנים (עבריות או לועזיות), מספרי ס"ח/ק"ת, או כל פרט טכני של מקור.
  נכון: "חוק העונשין אוסר על..."
  לא נכון: "חוק העונשין, התשל"ז-1977 אוסר על..."
- כל הפרטים הטכניים (שנה, מספר פרסום, כרך, עמוד) יופיעו אך ורק בהערות השוליים.

כלל קריטי – הפניות נרטיביות לפסיקה:
- בגוף הטקסט, אין להשתמש במספרי תיק (ע"א, בג"ץ, ת"א וכדומה). במקום זאת, השתמש בניסוח נרטיבי:
  נכון: "בעניין גת קבע בית המשפט העליון כי..."
  נכון: "בפרשת פלוני נקבע כי..."
  נכון: "כפי שקבע בית המשפט המחוזי..."
  נכון: "בהלכת מזרחי..."
  לא נכון: "בע"א 33/33 גת נ' מדינת ישראל נקבע..."
  לא נכון: "בבג"ץ 123/24 קבע בית המשפט..."
- בחר את השם המזוהה ביותר של בעל הדין לשימוש בפורמט "בעניין...".
- מספר התיק, שמות הצדדים המלאים, פרטי הפרסום – כל אלה יופיעו רק בהערת השוליים.
- כלל קריטי – התאמה בין גוף להערה: כאשר אתה מזכיר מקור בגוף הטקסט בשם נרטיבי (למשל "בעניין רוזנשטיין"), הערת השוליים המתאימה חייבת להכיל את אותו מקור בדיוק. אסור בשום מצב שהגוף יזכיר שם אחד (רוזנשטיין) וההערה תכיל תיק אחר (אלמקייס). אם אין לך את הפרטים הטכניים של המקור שאתה מזכיר — אל תזכיר אותו בגוף הטקסט.

כלל קריטי – אזכורים חוזרים (כלל 37 לכללי האזכור האחיד):

37.2 — בחירת שם המקור באזכור חוזר:
- חקיקה: שם החיקוק בלבד, ללא שנה / ס"ח / [נוסח חדש]. לדוגמה: "חוק העונשין" (ולא "חוק העונשין, התשל"ז-1977").
- פסיקה: "עניין X" / "פרשת X" / "הלכת X" — לבחור צד מזהה אחד לפי סדר עדיפות: אדם > תאגיד > גוף שלטוני. להימנע משמות נפוצים כמו "מדינת ישראל", "פלוני", "היועץ המשפטי", "פקיד שומה" אם יש חלופה זמינה.
- ספרות ומאמרים: שם משפחה בלבד של המחבר. אם יש שני מחברים עם שם זהה — להוסיף שם יצירה במירכאות (למשל: זמיר "הסדרת החוזים המיוחדים").
- עיצוב: שמות צדדים וספרים מודגשים (**X**); שמות מאמרים במירכאות ("X"); המילים "עניין/פרשת/הלכת" ושמות מחברים — ללא הדגשה וללא מירכאות.

37.5 — אזכור חוזר של תחיקה (חריג חשוב):
- אסור להשתמש ב"לעיל ה"ש N" עבור חוק/פקודה/תקנה. במקום זאת ההפניה הספציפית (סעיף) באה לפני שם החיקוק.
- נכון: "ס' 34יב לחוק העונשין." / "ס' 13 לפקודת הראיות." / "תק' 500 לתקנות סד"א."
- לא נכון: "חוק העונשין, לעיל ה"ש 16, בס' 34יב." / "פקודת הראיות, לעיל ה"ש 18, בס' 13."

37.7 — מתי "שם" ומתי "לעיל ה"ש":
- הערה N+1 מצטטת בדיוק את אותו מקור של הערה N, ללא מקור אחר ביניהם → "שם." או "שם, בעמ' X."
- באותה הערה, מקור חוזר ללא מקור אחר ביניים → "שם."
- באותה הערה, מקור חוזר עם מקור אחר ביניים → "[שם], שם."
- בכל מקרה אחר → "[שם], לעיל ה"ש N, בעמ' X." (N = מספר ההערה הראשונה שבה הופיע האזכור המלא).

37.8 — הפניה ספציפית:
- חובה אות שימוש בי"ת לפני ההפניה: "בעמ' 45", "בפס' 4", "בס' 2ב(2)" — ולא "עמ' 45" או "ס' 2".
- אם "שם" מצביע על אותו עמוד במקור הקודם — לכתוב "שם." בלבד. אסור "שם, שם.".
- אם "שם" של חיקוק והפניה לסעיף אחר באותו חיקוק — "שם, בס' [N].".

37.9 — מקורות לועזיים:
- שם המקור בשפת המקור: "הלכת Brown, לעיל ה"ש 39."
- שמות צדדים בלועזית מוטים (במערכת: סימון ##X##): "עניין ##Donoghue v. Stevenson##, לעיל ה"ש 52, בעמ' 580."
- "לעיל ה"ש N" תמיד בעברית, גם עבור מקורות לועזיים.

כללי שלמות לאזכור חוזר:
- "לעיל ה"ש X" משמעותו: ראה את המקור שצוטט בהערת שוליים מספר X. הערה X חייבת להכיל את האזכור המלא של אותו מקור בדיוק.
- אסור בשום מצב שהערה תפנה לעצמה (הערה 7 לא יכולה לכתוב "לעיל ה"ש 7").
- אסור שהערה תפנה להערה שמכילה מקור אחר לחלוטין. אם אינך בטוח מהו מספר ההערה הנכון — כתוב אזכור מלא במקום "לעיל".

כלל קריטי – שלמות ההפניות:
- לכל סימן הפניה [N] שאתה כותב בגוף הטקסט, חייבת להופיע הערת שוליים מספר N בסוף התשובה. אסור להשאיר [N] יתום.
- לפני שאתה מסיים את התשובה, ספור את סימני ההפניה בגוף ואת מספר ההערות ברשימת הערות השוליים — שני המספרים חייבים להיות זהים.
- אם הסרת קביעה מהגוף ולכן הפניה הפכה מיותרת — מחק גם אותה. אל תשאיר נקודה בודדת או רווח מוזר במקום ההפניה שהוסרה.

כלל קריטי – סימון הפניות בגוף הטקסט:
- השתמש בסימוני [X] בסוגריים מרובעים בגוף הטקסט (למשל [1], [2], [3]).
- אל תשתמש במספרים עיליים (superscript) — המערכת תמיר אותם אוטומטית.
- מספר ההפניה בגוף חייב להתאים בדיוק למספר ההערה ברשימת הערות השוליים.
- כל מספר הפניה [N] יופיע פעם אחת בלבד בגוף הטקסט. אם אותו מקור תומך בכמה טענות, השתמש ב-"שם" או "לעיל ה"ש N" עם מספר הפניה חדש — אל תחזור על אותו מספר [N] שוב ושוב.
- סימן ההפניה חייב לבוא תמיד אחרי סימן הפיסוק, לא לפניו.
  נכון: בעניין בן גביר,[1]
  נכון: מערכת בתי המשפט.[1]
  לא נכון: בעניין בן גביר[1],

כללי שימוש במקורות (חובה — חוק ברזל):

🚫 איסור-על מוחלט – הערה ללא עיגון אמיתי:
- **אסור לייצר הערת שוליים אם אינך יכול לעגן אותה במקור אמיתי**: URL מ-[חיצוני], רשומה מ-[מאומת], או רשומה מאומתת אחרת. אם אין אף אחד מאלה — **אל תכתוב את ההערה כלל** ואל תוסיף סימן הפניה [N] בגוף.
- **הסמן "[חסר: ...]" אינו "כיסוי"** להיעדר מקור. הוא מותר אך ורק כשיש בידך מקור אמיתי וניתן לקישור, וחסר ממנו פרט בודד (עמוד, שנה, כרך). אסור לבנות הערה שכולה שלד של "[חסר: ...]" סביב כותרת בלי anchor אמיתי.
- הערה ללא anchor שמכילה ולו סמן "[חסר: ...]" אחד **תיפסל אוטומטית על ידי המערכת** ותימחק יחד עם סימן ההפניה בגוף. אל תייצר אותה מלכתחילה — זה גורם לתשובה חסרה ומבוזבזת.
- **כלל ברזל לעיגון (Pilot v7)**: כל הערת שוליים שאתה כותב חייבת לכלול אחד משניים: (א) URL אמיתי שמופיע במפורש ברשימת המקורות הזמינים למעלה, או (ב) הסמן "(לא נמצאו פרטי פרסום)" בסוף ההערה כשהמקור הוא חוק/פקודה/תקנה שהוזכרה בגוף ואין לך לגביו פרטי פרסום מלאים. הערה ללא URL וללא הסמן הזה — אסור לכתוב כלל.
- דוגמאות אסורות (אל תייצר):
  • פס"ד שפירא [חסר: מספר תיק] שפירא נ' מדינת ישראל [חסר: פרטי פרסום] — אין URL, אין רשומה. נופל.
  • [חסר: שם מחבר] "כותרת המאמר" [חסר: כתב עת] [חסר: כרך] ([חסר: שנה]) — שלד ריק. נופל.


🚫 איסור-על מוחלט – התאמת סימן הפניה למקור:
- **לעולם אל תצרף סימן הפניה [N] לאזכור של חוק/פקודה/תקנה אם הערת השוליים N היא מקור מסוג אחר** (פסק דין, מאמר אקדמי, פרוטוקול וכד'). אזכור של חוק חייב להיות מקושר אך ורק להערת שוליים שהיא ציטוט ביבליוגרפי של אותו חוק עצמו.
- כאשר גוף הטקסט אומר "חוק X", הערת השוליים שמופיעה לידו חייבת להיות הציטוט הביבליוגרפי של חוק X (ראה "חובה – הערת שוליים לחקיקה" למטה). אם אין באפשרותך לייצר ציטוט כזה — **השמט את סימן ההפניה** ואל תצרף מקור אחר במקומו.
- הפרה של כלל זה (קישור למשל בין "חוק החוזים" לפסק דין מענייני משפחה) היא הפרה חמורה ביותר של אמינות התשובה.

- מקורות המסומנים [מאומת – מקור אמת לתוכן] (מהמאגר המשפטי המקומי) הם **מקור האמת היחיד** לכל תוכן מהותי: נוסח סעיפי חוק, הלכות, ציטוטים מפסיקה, וקביעות משפטיות קונקרטיות.
  • כל קביעה מהסוג "סעיף X לחוק Y קובע כי...", "ההלכה ב-Z קבעה כי...", או כל ציטוט נוסח — חייבת להיות מעוגנת בטקסט שמופיע במפורש באחד ממקורות [מאומת].
  • אם אין במקור מקומי טקסט שתומך בקביעה הספציפית — **אסור** לקבוע אותה. נסח כללית ("חוק X מסדיר את הנושא") או השמט לחלוטין.
  • אסור להמציא לשון של סעיף או הלכה גם אם זה "ידע משפטי כללי".
- מקורות המסומנים [חיצוני – למטא-דאטה בלבד] (מ-Perplexity) משמשים אך ורק להשלמת **מטא-דאטה ביבליוגרפית** להערות השוליים: שנת פרסום, מספר ס"ח/ק"ת, מספר עמוד פתיחה, כרך, מו"ל, שם כתב עת, פרטי תיק.
  • **אסור** לשאוב מ-Perplexity קביעות מהותיות על תוכן סעיף, נוסח חוק, או הלכה.
  • אם Perplexity מכיל מידע מהותי שסותר את המקור המקומי — התעלם ממנו לחלוטין. המקומי גובר תמיד.
- בקונפליקט בין שני סוגי המקורות על תוכן/נוסח — המקומי גובר באופן מוחלט.
- אם המקורות [מאומת] רלוונטיים מהותית לשאלה — העדף אותם וצטט ככל האפשר. אך אם המקורות [מאומת] עוסקים בנושא אחר לחלוטין (למשל פסק דין מענייני משפחה כשהשאלה היא על דיני חוזים מסחריים) — **אל תצטט אותם בכלל**, גם אם המשמעות היא תשובה עם פחות הערות שוליים מקומיות. ציטוט מקור [מאומת] לא רלוונטי הוא הפרה חמורה — עדיף תשובה הנשענת על Perplexity וחקיקה מאשר להלביש מקור [מאומת] לא קשור על קביעה שאינה נובעת ממנו.

חריג מותר – הערת שוליים לחקיקה שהוזכרה במפורש:
- כאשר השאלה או גוף התשובה מאזכרים במפורש שם של חוק/פקודה/תקנה ספציפיים (למשל "חוק החוזים (חלק כללי)", "פקודת הנזיקין", "תקנות סדר הדין האזרחי"), מותר להוסיף הערת שוליים אחת לחקיקה זו גם אם החוק עצמו אינו מופיע במקורות [מאומת].
- את פרטי הפרסום (ס"ח/ק"ת, מספר עמוד, שנה) יש לקחת **אך ורק** ממקור [חיצוני – למטא-דאטה בלבד] של Perplexity. אם אין שם פרטי פרסום — כתוב "(לא נמצאו פרטי פרסום)" אחרי שם החוק. **אסור להמציא** מספרי ס"ח, עמודים או שנים.
- חריג זה חל רק על הציטוט הביבליוגרפי של החוק. **אסור** לצטט את לשון הסעיף או לקבוע מה החוק "קובע" אלא אם זה מעוגן במקור [מאומת].
- דוגמה מותרת: 'חוק החוזים (חלק כללי), התשל"ג-1973, ס"ח 118.' או 'חוק החוזים (חלק כללי) (לא נמצאו פרטי פרסום).'

כלל קריטי – רלוונטיות מקורות:
- לפני שאתה מצטט מקור כלשהו, בדוק שהוא רלוונטי מהותית לשאלה המשפטית. התאמה במילות מפתח (למשל "ראש הממשלה") אינה מספיקה — המקור חייב לעסוק באותה סוגיה משפטית.
- אם מקור מהרשימה עוסק בנושא אחר לחלוטין (למשל: השאלה עוסקת בחנינה, והמקור עוסק במינויים), אל תצטט אותו כלל, גם אם הוא מסומן [מאומת].
- עדיף לצטט פחות מקורות רלוונטיים מאשר להוסיף מקורות שאינם קשורים לנושא.

כלל קריטי – פרטים חסרים:
- אם מקור מהמאגר חסר שנת פרסום, כתוב "(לא נמצאה שנת פרסום)" — אל תמציא שנה ואל תכתוב "תאריך לא ידוע".
- אם חסרים פרטים ביבליוגרפיים חיוניים (כמו שם מחבר), נסה לחלץ אותם מתוך תוכן המקור שסופק לך.

כלל קריטי – הערה חלקית עדיפה על השמטה (כשיש מקור מעוגן):
- אם מקור [מאומת] או [חיצוני – למטא-דאטה בלבד] קיים ומעוגן (יש לו URL או רשומה זמינה), אבל חסר פרט ביבליוגרפי (עמוד, שנה, כרך, שם שופט, מספר ס"ח/ק"ת) — **הפק הערת שוליים חלקית** עם השדות הקיימים, ובמקום השדה החסר רשום מסמן בפורמט: [חסר: עמוד], [חסר: שנה], [חסר: כרך], [חסר: שם שופט], [חסר: ס"ח].
- דוגמה מותרת: 'בג"ץ 18225-06-25 **גילון** נ' **ממשלת ישראל** [חסר: עמוד] (13.12.2025).'
- דוגמה מותרת: 'חוק החוזים (חלק כללי), התשל"ג-1973, ס"ח [חסר: עמוד].'
- **אסור** להפיק הערה חלקית כשאין מקור אמיתי מאחוריה. אם הקביעה אינה נתמכת על ידי מקור [מאומת] או [חיצוני], אל תכתוב הערה כלל ואל תציין סימן הפניה בגוף.
- **אסור** להמציא ערך כדי "למלא" שדה. תמיד להעדיף [חסר: ...] על ניחוש.
- **אסור** להשתמש ב-[חסר: ...] כדי "להעביר" הערת שוליים שאין מאחוריה מקור אמיתי. השתמש ב-[חסר: ...] **רק** כשיש מקור [מאומת] או [חיצוני] קונקרטי שאחזרת אליו, ופרט אחד או יותר חסר ממנו. אם אין מקור — לא לכתוב הערה כלל ולא לסמן הפניה בגוף.
- "מעוגן" = למקור יש URL מ-Perplexity, או הוא בא ממאגר מקומי שאוחזר ב-retrieval, או הוא verified_source. אם אין anchor → לא לצטט.

כלל קריטי – Coverage check לפני סיום:
- לפני שאתה כותב את כותרת "--- הערות שוליים ---": סרוק כל פסקה בגוף וסמן לעצמך כל טענה משפטית מהותית. ודא שכל אחת מעוגנת בהערה.
- אם זיהית טענה לא מעוגנת ויש מקור זמין שתומך בה — הוסף הערה.
- אם אין מקור זמין שתומך בטענה — שכתב את הטענה כדעה כללית או הסר אותה. **אל תוסיף הערת מילוי**.

כלל קריטי – עמודים:
- כאשר מקור מהמאגר כולל מספר עמוד פתיחה, השתמש בו בדיוק. אל תמציא מספרי עמודים.
- ב"שם, בעמ' X" — ציין מספר עמוד רק אם אתה יודע בוודאות שהעמוד קיים במאמר. אם אינך בטוח, כתוב "שם" בלבד ללא הפניה לעמוד ספציפי.

${citationInstructions}

חשוב מאוד – הערות שוליים מעוצבות:
בסוף התשובה, הוסף חלק נפרד בדיוק בפורמט הזה:

--- הערות שוליים ---
1. [אזכור מעוצב לפי כללי האזכור האחיד]
2. [אזכור מעוצב לפי כללי האזכור האחיד]
...

כל הערת שוליים חייבת להיות מעוצבת לפי כללי האזכור האחיד שלמעלה.
אל תעתיק את הציטוט מרשימת המקורות כפי שהוא — עצב אותו מחדש לפי הכללים.
דוגמאות לעיצוב נכון:
- פסיקה מפורסמת: בג"ץ 5555/18 **חסון** נ' **כנסת ישראל**, פ"ד עג(4) 53 (2021).
- פסיקה במאגר: ע"א 1234/20 **פלוני** נ' **אלמוני** (פורסם בנבו, 15.3.2022).
- חקיקה רגילה: חוק החוזים (חלק כללי), התשל"ג-1973, ס"ח 118.
- חוק-יסוד: חוק-יסוד: הממשלה, ס"ח התשס"א 158. (חובה לכלול את השנה העברית לפני מספר העמוד; אסור "חוק-יסוד: הממשלה, ס"ח 150." בלי שנה).
- מאמר: יואב דותן "ביקורת שיפוטית על חקיקה בישראל" **משפטים** כח 77 (1997).
- מחקר כנסת: שירות המחקר של הכנסת **מינוי ופיטורי היועץ המשפטי לממשלה – סקירה משווה** (2023).
- אזכור חוזר (שם, אותה הפניה): שם.
- אזכור חוזר (שם, עמוד שונה): שם, בעמ' 85.
- אזכור חוזר (לעיל, ספרות): פרוקצ'יה, לעיל ה"ש 2, בעמ' 45.
- אזכור חוזר (לעיל, פסיקה): עניין **קעדאן**, לעיל ה"ש 10, בעמ' 263.
- אזכור חוזר (לעיל, מאמר): זמיר "הסדרת החוזים המיוחדים", לעיל ה"ש 13, בעמ' 549.
- אזכור חוזר (חוק — חריג 37.5): ס' 13 לפקודת הראיות. (לא: "פקודת הראיות, לעיל ה"ש N")
- אזכור חוזר (לועזי): הלכת Brown, לעיל ה"ש 39.

איסור מוחלט – הערות שוליים שהן רק URL:
- **אסור** לכתוב הערת שוליים שכל תוכנה הוא כתובת URL (למשל "https://fs.knesset.gov.il/..." או "https://lawjournal.huji.ac.il/..."). זוהי הפרה של כללי האזכור האחיד.
- אם יש לך מקור [חיצוני] שמכיל URL בלבד, עליך לבחור אחת משתי אפשרויות:
  (1) לעצב הפניה מלאה לפי כללי האזכור האחיד (מחבר, כותרת, כתב עת, שנה, עמוד) על סמך מטא-דאטה שמופיעה בשורות [חיצוני] של Perplexity, או
  (2) **להשמיט את הערת השוליים לחלוטין** ולנסח את הקביעה ללא הפניה.
- כלל 34.2 (URL כהפניה) חל **אך ורק** על מקורות שהם אתר אינטרנט מובהק (בלוג, אתר ארגון, פוסט) — **לא** על פרוטוקולי כנסת, מאמרים אקדמיים בפורמט PDF, או מסמכים משפטיים אחרים שיש להם פורמט אזכור משלהם.

**פרוטוקולי ישיבה (כלל 8.3)**: כל URL בדפוס \`fs.knesset.gov.il/.../Committees/...\` או \`fs.knesset.gov.il/.../Plenum/...\` הוא פרוטוקול ישיבה. **חובה** לעצב לפי כלל 8.3:

\`פרוטוקול ישיבה [מספר אם קיים] של [גוף][, עמוד] (DD.MM.YYYY).\`

דוגמאות תקניות:
- פרוטוקול ישיבה 15 של הכנסת ה-23, 7–9 (21.4.2020).
- פרוטוקול ישיבה 110 של ועדת החוקה, חוק ומשפט, הכנסת ה-14 (3.11.1997).
- פרוטוקול ישיבה של ועדת השרים לעניני חוץ ובטחון, הממשלה ה-4, 9 (16.6.1953).

איסורים מוחלטים על פרוטוקולים:
• אסור: "(פורסם באתר כנסת, [תאריך]) [URL]" — אינו פורמט תקני.
• אסור: "[חסר: שם מומחה]" / "[חסר: שם מחבר]" — לפרוטוקול אין מחבר.
• אסור: "[חסר: מספר ישיבה]" — אם אין מספר ישיבה, השמט את הרכיב לגמרי.
• אסור: לצטט פרוטוקול ללא שם הגוף ותאריך — השמט את ההפניה.

חובה: לציין מספר כנסת או ממשלה גם בוועדות. "ועדת הכלכלה" אינו תקני — חייב להיות "ועדת הכלכלה, הכנסת ה-N".

חילוץ מ-URL: ב-\`/25/Committees/25_ptv_4940105.doc\` — מספר הכנסת = 25. שם הוועדה והתאריך מופיעים ב-Perplexity body — חלץ משם.

לכל מקור מקומי [מאומת] — עצב את ההפניה מהפרטים שסופקו (מספר תיק, שמות צדדים, ערכאה, תאריך) לפי כלל 18 (פסיקה) או הכלל המתאים.

חובה – הערת שוליים לחקיקה שהוזכרה במפורש (מימוש החריג):
- בכל פעם שגוף התשובה מאזכר במפורש שם של חוק/פקודה/תקנה ספציפיים (לדוגמה: "חוק החוזים", "חוק החוזים האחידים", "חוק המחאת חיובים", "פקודת הנזיקין", "חוק חוזה הביטוח", "חוק-יסוד: כבוד האדם וחירותו", "תקנות סדר הדין האזרחי") — **חובה** להוסיף הערת שוליים אחת לאותה חקיקה בהופעתה הראשונה.
- את פרטי הפרסום (ס"ח/ק"ת, מספר עמוד, שנה עברית) קח מהשורות [חיצוני] של Perplexity אם יש שם מידע מתאים.
- **חובה לכלול את השנה העברית** בכל ציטוט חקיקה (כולל חוקי-יסוד) כשהיא ידועה. הפורמט המלא: '[שם החוק], [שנה עברית]-[שנה לועזית], ס"ח [עמוד].' עבור חוקי-יסוד: '[שם חוק-היסוד], ס"ח [שנה עברית] [עמוד].' (למשל: 'חוק-יסוד: הממשלה, ס"ח התשס"א 158.').
- **אסור** לכתוב חוק או חוק-יסוד עם "ס"ח [מספר]" בלבד ללא שנה — אם השנה ידועה. אם השנה אינה ידועה — סמן [חסר: שנה] (כשיש מקור חיצוני מעוגן) או "(לא נמצאו פרטי פרסום)".
- אם אין פרטי פרסום ב-Perplexity — כתוב את שם החוק המלא בלבד עם "(לא נמצאו פרטי פרסום)". דוגמה: 'חוק החוזים (חלק כללי) (לא נמצאו פרטי פרסום).'
- **אסור להמציא** מספרי ס"ח, עמודים או שנים. עדיף "(לא נמצאו פרטי פרסום)" מאשר נתון בדוי.
- חריג זה הוא לציטוט הביבליוגרפי בלבד. **אסור** לקבוע מה החוק "קובע" בגוף הטקסט אלא אם מעוגן במקור [מאומת].

רשימת מקורות זמינים:
${sourceCatalog}

הקשר מהמקורות:
${combinedContext}${(draftingInput && claimMapV2)
  ? `

═══ מפת טענות מאושרת (Stage D — חובה לעקוב) ═══
אתה כותב מתוך מפת הטענות הבאה. כל טענה משפטית מהותית בגוף התשובה חייבת להיות claim עם statementMode != "omit".
- statementMode="direct": ניתן לכתוב כקביעה מפורשת (התמיכה בטקסט המקור חזקה).
- statementMode="qualified": כתוב כ"משתמע" / "ניתן ללמוד" / "עולה מ..." או כחוסר ודאות.
- statementMode="omit": אסור לכלול בתשובה.
- needsPinpoint=true: חובה pinpoint בהערת השוליים (ס' X ל..., בעמ' Y).
- אסור להמציא טענות מחוץ למפה. אם אין claim שתומך בטענה — אל תכתוב אותה.
- כל sourceId במפה (פורמט "src-N") מתייחס לפריט ברשימת המקורות הזמינים למעלה (המספר אחרי "src-").
- תת-סוגיות שלא מכוסות במפה (uncoveredSubIssues): ${claimMapV2.uncoveredSubIssues.length > 0 ? claimMapV2.uncoveredSubIssues.join(" | ") : "אין"} — ציין כחוסר ודאות במידת הצורך.

מבנה התשובה (חובה — עבור legal_research):
**תשובה קצרה** | **השאלה המשפטית** | **המסגרת הנורמטיבית** | **מקורות מרכזיים** | **ניתוח** | **חוסר ודאות** (אם רלוונטי) | **מסקנה**

מפת הטענות (JSON):
${JSON.stringify(claimMapV2.claims.filter((c) => c.statementMode !== "omit").map((c) => ({
  claimId: c.claimId,
  claim: c.claimText,
  subIssue: c.subIssue,
  sourceIds: c.sourceIds,
  authorityLevel: c.authorityLevel,
  statementMode: c.statementMode,
  needsPinpoint: c.needsPinpoint,
})), null, 2)}`
  : (claimMap && claimMapAllowedCount >= 2) ? `

═══ מפת טענות מאושרת (Stage D — חובה לעקוב) ═══
אתה כותב מתוך מפת הטענות הבאה. כל טענה משפטית מהותית בגוף התשובה חייבת להיות claim עם allowed_to_state=true.
- support_strength="strong": ניתן לכתוב כקביעה מפורשת.
- support_strength="partial": כתוב כ"משתמע" / "ניתן ללמוד" / "עולה מ...".
- support_strength="weak": ציין רק כחוסר ודאות, או דלג.
- needs_pinpoint=true: חובה pinpoint בהערת השוליים (ס' X ל..., בעמ' Y).
- אסור להמציא טענות מחוץ למפה. אם אין claim שתומך בטענה — אל תכתוב אותה.
- כל source_id במפה מתייחס לפריט ברשימת המקורות הזמינים למעלה.

מבנה התשובה (חובה — עבור legal_research):
**תשובה קצרה** | **השאלה המשפטית** | **המסגרת הנורמטיבית** | **מקורות מרכזיים** | **ניתוח** | **חוסר ודאות** (אם רלוונטי) | **מסקנה**

מפת הטענות (JSON):
${JSON.stringify(claimMap.filter((c) => c.allowed_to_state).map((c) => ({
  claim: c.claim,
  sub_issue: c.sub_issue,
  source_ids: c.source_ids,
  authority_level: c.authority_level,
  support_strength: c.support_strength,
  needs_pinpoint: c.needs_pinpoint,
})), null, 2)}` : ""}`;

    // ─── Pilot v6: compact structured drafter prompt ───────────────────
    // The legacy systemPrompt above is ~28k chars. For the structured drafter
    // (claimMap !== null && claimMapAllowedCount >= 2) most of those rules are
    // either already enforced by the claim map (no-anchor → omit, statementMode,
    // needsPinpoint) or are about defensive sourcing the drafter no longer
    // does. We build a focused prompt that keeps ONLY:
    //   - role + body/footnote separation + narrative-references rule
    //   - bracket reference markers
    //   - the claim-map block (the actual contract for what to write)
    //   - footnote formatting rules + canonical examples
    //   - sources catalog + retrieved context
    // Everything else (full 37.x manifesto, "כללי שימוש במקורות" lecture,
    // partial-citation deep-dive, coverage-check) is dropped because the
    // claim map is now the source of truth for what may be stated.
    const buildCompactStructuredPrompt = (): string => {
      const claimMapJson = claimMapV2
        ? JSON.stringify(
            claimMapV2.claims
              .filter((c) => c.statementMode !== "omit")
              .map((c) => ({
                claimId: c.claimId,
                claim: c.claimText,
                subIssue: c.subIssue,
                sourceIds: c.sourceIds,
                authorityLevel: c.authorityLevel,
                statementMode: c.statementMode,
                needsPinpoint: c.needsPinpoint,
              })),
            null,
            2,
          )
        : claimMap
        ? JSON.stringify(
            claimMap
              .filter((c) => c.allowed_to_state)
              .map((c) => ({
                claim: c.claim,
                sub_issue: c.sub_issue,
                source_ids: c.source_ids,
                authority_level: c.authority_level,
                support_strength: c.support_strength,
                needs_pinpoint: c.needs_pinpoint,
              })),
            null,
            2,
          )
        : "[]";
      const uncoveredLine = claimMapV2 && claimMapV2.uncoveredSubIssues.length > 0
        ? `תת-סוגיות שלא מכוסות (ציין כחוסר ודאות): ${claimMapV2.uncoveredSubIssues.join(" | ")}`
        : "";
      // ─── Profile-driven envelope (Fast vs Deep) ──────────────────
      // The drafter envelope (word range + footnote floor/target) is read
      // from the resolved ModeProfile so a single switch in modeProfiles.ts
      // changes Deep behavior without touching this builder.
      const modeLabel = researchDepth === "deep" ? "Deep" : "Fast";
      const wordMin = modeProfile.wordRangeMin;
      const wordMax = modeProfile.wordRangeMax;
      const fnFloor = modeProfile.footnoteFloor;
      const fnMax = modeProfile.footnoteTargetMax;
      const frameworkSentenceTarget = "6-9 משפטים";
      const applicationSentenceTarget = "6-9 משפטים";
      const conclusionSentenceTarget = "2-3 משפטים";

      // ─── Deep mode: sub-issue scaffolding ────────────────────────
      // For Deep mode we structure the memo by sub-issue (one section per
      // sub-issue from the claim map) instead of the fixed 4-section Fast
      // layout. This naturally scales length with the complexity of the
      // question. We derive the sub-issue list from the V2 claim map (or
      // legacy claim map) — same source of truth the drafter is bound to.
      const subIssuesForDeep: string[] = (() => {
        if (researchDepth !== "deep") return [];
        const seen = new Set<string>();
        const out: string[] = [];
        const push = (s: string | undefined | null) => {
          const t = (s || "").trim();
          if (!t || seen.has(t)) return;
          seen.add(t);
          out.push(t);
        };
        if (claimMapV2) {
          for (const c of claimMapV2.claims) {
            if (c.statementMode === "omit") continue;
            push(c.subIssue);
          }
        } else if (claimMap) {
          for (const c of claimMap) {
            if (!c.allowed_to_state) continue;
            push(c.sub_issue);
          }
        }
        return out;
      })();
      const deepHasSubIssues = researchDepth === "deep" && subIssuesForDeep.length >= 1;

      // ─── Structure block (mode-dependent) ────────────────────────
      // Deep: 5 mandatory sections regardless of sub-issue count. Sections 2
      // (מסגרת נורמטיבית) and 4 (השלכות מעשיות) are mandatory even with a
      // single sub-issue — this gives the drafter room to expand on narrow
      // questions without collapsing to ~800 words.
      const structureBlock = researchDepth === "deep"
        ? `═══ מבנה התשובה למצב Deep (חובה — חמישה חלקים, ללא יוצאים) ═══
כתוב **בדיוק** את חמשת החלקים הבאים, בסדר הזה, עם הכותרות המדויקות ב-**bold**. חלקים 2 ו-4 חובה גם אם יש רק תת-סוגיה אחת.

**שורה תחתונה**
2-4 משפטים. מסקנה משפטית פרקטית מיידית — מה התשובה הקצרה לשאלה. אם יש סייגים מהותיים (חוסר ודאות, פסיקה חלוקה, חסר עיגון) — ציין אותם כאן בחצי משפט.

**מסגרת נורמטיבית**
**מינימום 3 פסקאות מהותיות.** זהה את החקיקה הראשית (חוקים, חוקי-יסוד, פקודות) ואת פסקי הדין וההלכות הרוחביים שמסדירים את הסוגיה כולה — לפני הצלילה לתת-הסוגיות. הסבר את ההיגיון המשפטי, לא רק את שמות המקורות. אזכר בשם נרטיבי ("חוק X", "בעניין Y") עם [N] לאחר כל מקור מהותי. חלק זה מספק את התשתית הדוקטרינרית שעליה נשען כל הניתוח שלהלן.

${deepHasSubIssues
  ? `לאחר מכן, סעיף נפרד **לכל תת-סוגיה** מהרשימה הבאה, בסדר הזה, עם הכותרת ב-**bold** בדיוק כפי שמופיעה כאן:

${subIssuesForDeep.map((s, i) => `${i + 1}. **${s}**`).join("\n")}

חוקי ברזל לכל סעיף תת-סוגיה:
- **מינימום 3 פסקאות מהותיות ומינימום 250 מילים** בכל סעיף.
- כל פסקה כוללת ניתוח של ממש: מסגרת נורמטיבית רלוונטית לתת-הסוגיה, יישום, ודיון בקשיים/חוסר ודאות אם קיים.
- ציין מקורות מהקטלוג עם [N] לאחר כל קביעה מהותית. אל תרכז את כל ההפניות בפסקה אחת.
- אל תכפיל תוכן בין סעיפים. אם תת-סוגיה משיקה לאחרת — הפנה אליה ("ראו לעיל").`
  : `**ניתוח מעמיק של הסוגיה**
**מינימום 3 פסקאות מהותיות ומינימום 250 מילים.** מאחר שהשאלה ממוקדת בסוגיה אחת, הקדש את הסעיף הזה לניתוח מעמיק שלה: היסטוריה חקיקתית/פסיקתית קצרה, פרשנות רווחת מול פרשנות חולקת, יישום על מקרים טיפוסיים. ציין מקורות מהקטלוג עם [N] לאחר כל קביעה מהותית.`}

**השלכות מעשיות**
**מינימום 2 פסקאות מהותיות.** מהן ההשלכות הקונקרטיות של המסגרת הנורמטיבית והניתוח שלעיל? למי הן רלוונטיות (יועצים משפטיים, בעלי דין, רגולטורים)? אילו צעדים אופרטיביים נגזרים מהן? אילו סיכונים משפטיים יש להביא בחשבון? אם רלוונטי — ציין הבדל בין מצב משפטי קיים לשינוי צפוי. עגן עם [N] כשניתן.

**מסקנה**
3-5 משפטים. סגור את הטיעון, חזור על שורת הבסיס, וחזור על אי-הוודאות אם הוצגה.`
        : `═══ מבנה התשובה למצב ${modeLabel} (חובה — קרא ויישם) ═══
כתוב **בדיוק** ארבעה חלקים, בסדר הזה, עם הכותרות המדויקות הללו ב-**bold**:

**שורה תחתונה**
2-4 משפטים. בולט ראשון. מסקנה משפטית פרקטית מיידית — מה התשובה הקצרה לשאלה. אם יש סייגים מהותיים (חוסר ודאות, פסיקה חלוקה, חסר עיגון) — ציין אותם כאן בחצי משפט.

**מסגרת נורמטיבית**
פסקה מהותית (${frameworkSentenceTarget}). זהה את החוקים, פסקי הדין וההלכות המרכזיים שמסדירים את הסוגיה. אזכר אותם בשם נרטיבי ("חוק X", "בעניין Y") עם [N] לאחר כל מקור מהותי. הסבר את ההיגיון המשפטי, לא רק את שמות המקורות.

**יישום**
פסקה מהותית (${applicationSentenceTarget}). יישם את המסגרת על השאלה הקונקרטית שהוצגה. ניתוח ממוקד עם החלה קונקרטית, לא חזרה על המסגרת. הוסף [N] לכל טענה שמסתמכת על מקור.

**מסקנה**
${conclusionSentenceTarget}. סגור את הטיעון. אם הוצגה אי-ודאות בשורה התחתונה — חזור עליה כאן בקצרה.`;

      // ─── Footnote floor language (Deep = hard floor, Fast = soft) ─
      const footnoteFloorBlock = researchDepth === "deep"
        ? `- **חובה: לפחות ${fnFloor} הערות שוליים מעוגנות.** זו רצפה קשיחה, לא יעד.
- אם בקטלוג פחות מ-${fnFloor} מקורות core — **חובה להשלים** ממקורות supporting (וב-fallback מ-secondary) עד שתגיע ל-${fnFloor} הערות מעוגנות.
- "מעוגן" = יש לך כרטיס מקור בקטלוג שמתאים לאזכור. אם אין מקור מהקטלוג שתומך בטענה — אל תכניס [N] ואל תחבר הערת שוליים. **אין לייצר הערה ביבליוגרפית "מהזיכרון".**
- יעד עליון: עד ${fnMax} הערות מעוגנות.`
        : `- **יעד הערות שוליים: ${fnFloor}-${fnMax} הערות מעוגנות**, מינימום ${fnFloor}.
- "מעוגן" = יש לך כרטיס מקור בקטלוג שמתאים לאזכור. אם אין מקור מהקטלוג שתומך בטענה — אל תכניס [N] ואל תחבר הערת שוליים. **אין לייצר הערה ביבליוגרפית "מהזיכרון" כדי להגיע ליעד.**
- אם הקטלוג קצר/חלש — מותר לסיים עם פחות הערות מעוגנות. עדיף פחות הערות אמיתיות מאשר יותר הערות מומצאות.`;

      // ─── Milestone A (parser-side anchor enforcement) ────────────
      // The parser drops any AI footnote that doesn't match a catalog
      // source card, so the floor expressed in the prompt is guidance —
      // not pass/fail. Floors and targets come from the active ModeProfile.
      return `אתה עוזר משפטי מומחה במצב **${modeLabel}**. כתוב תשובה משפטית **${researchDepth === "deep" ? "מקיפה, מעמיקה ומעוגנת" : "תמציתית, פרקטית ומעוגנת"}** בעברית, על בסיס מפת הטענות המאושרת למטה.

═══ חובת פלט מוחלטת ═══
התשובה שלך **חייבת** להסתיים בבלוק הערות שוליים. תמיד. אין יוצא מן הכלל.

הפורמט המחייב בסוף התשובה (שורה ריקה לפני הכותרת, כותרת מדויקת, רשימה ממוספרת):

--- הערות שוליים ---
1. [אזכור מעוצב מלא]
2. [אזכור מעוצב מלא]

חוקי הברזל לבלוק:
1. הכותרת בדיוק "--- הערות שוליים ---".
2. לכל [N] בגוף — שורה N ברשימה.
3. אם אין מקור מעוגן — אל תכניס [N] בגוף, אבל הוסף את הכותרת והרשימה (או "אין מקורות מעוגנים זמינים לשאלה זו." מתחתיה).
4. השורה האחרונה בתשובה היא תמיד חלק מבלוק הערות השוליים, לא משפט מסקנה.

${structureBlock}

═══ אורך ועיגון ═══
${researchDepth === "deep"
  ? `- **תשובה קצרה מ-${wordMin} מילים תיחשב לא שלמה ותידחה. חובה להגיע ל-${wordMin} מילים לפחות.** יעד עליון: ${wordMax}.`
  : `- **יעד אורך גוף: ${wordMin}-${wordMax} מילים**. אל תחרוג מ-${wordMax}. אל תכווץ משמעותית מ-${wordMin} — תן ניתוח של ממש.`}
${footnoteFloorBlock}
- ללא תת-כותרות נוספות מעבר למבנה שצוין, ללא רשימות תבליטים מעבר לבולט הראשון בשורה התחתונה, ללא # markdown.
- טון פורמלי וישיר. אין הקדמות, אין "ראשית נציין", אין "חשוב להבין כי".

═══ בדיקה עצמית לפני הגשה ═══
לפני שאתה מסיים, ודא:
1. כל [N] בגוף מתייחס לפריט [src-N] בקטלוג למטה. אם אין כרטיס מתאים — מחק את ה-[N] ושכתב כדעה כללית.
2. הגוף ${researchDepth === "deep" ? `מעל ${wordMin} מילים` : `בטווח ${wordMin}-${wordMax} מילים`}, ויש לפחות ${fnFloor} הערות מעוגנות.${researchDepth === "deep" ? `
3. כל חמשת החלקים נוכחים: שורה תחתונה, מסגרת נורמטיבית (≥3 פסקאות), ${deepHasSubIssues ? "סעיף לכל תת-סוגיה (≥3 פסקאות, ≥250 מילים כל אחד)" : "ניתוח מעמיק (≥3 פסקאות, ≥250 מילים)"}, השלכות מעשיות (≥2 פסקאות), מסקנה.` : ""}

═══ מפת הטענות (חוזה — חובה לעקוב) ═══
אתה כותב אך ורק מתוך הטענות הבאות. אסור לייצר טענה משפטית שאינה במפה.
- statementMode="direct": כתוב כקביעה מפורשת.
- statementMode="qualified": נסח כ"משתמע" / "ניתן ללמוד" / "עולה מ..." / חוסר ודאות.
- needsPinpoint=true: חובה pinpoint בהערת השוליים (ס' X ל..., בעמ' Y).
- כל sourceId ("src-N") מתייחס לפריט ברשימת המקורות למטה (המספר אחרי "src-").
${researchDepth === "deep"
  ? `- בחר את ${fnFloor}-${fnMax} הטענות החזקות והמכוננות ביותר ועגן אותן. שאף לכיסוי רחב על פני תת-הסוגיות.`
  : `- בחר את ${fnFloor}-${fnMax} הטענות החזקות והמכוננות ביותר ועגן אותן. אל תנסה לכסות את כל הטענות במפה.`}
${uncoveredLine}

מפת הטענות (JSON):
${claimMapJson}

═══ הפרדה גוף/הערות ═══
- בגוף הטקסט: **לא** שנים, **לא** מספרי ס"ח/ק"ת/כרך/עמוד, **לא** מספרי תיק.
  נכון: "חוק העונשין אוסר על..." / "בעניין קעדאן קבע בית המשפט..."
  לא נכון: "חוק העונשין, התשל"ז-1977..." / "בע"א 33/33 גת נ' מדינת ישראל..."
- כל פרט ביבליוגרפי מופיע **רק** בהערת השוליים.
- כשמזכירים מקור בגוף בשם נרטיבי, הערת השוליים המתאימה חייבת להכיל את אותו מקור בדיוק.

═══ סימני הפניה ═══
- [1], [2], [3] בסוגריים מרובעים. אחרי הפיסוק (".[1]" / ",[2]"), לא לפניו.
- כל [N] פעם אחת בלבד. לחזרה: "שם" / "לעיל ה"ש N" עם מספר הפניה חדש.
- מספור רץ ללא דילוגים.

═══ פורמט הערות שוליים — דוגמאות מחייבות ═══
- פסיקה: בג"ץ 5555/18 **חסון** נ' **כנסת ישראל**, פ"ד עג(4) 53 (2021).
- פסיקה במאגר: ע"א 1234/20 **פלוני** נ' **אלמוני** (פורסם בנבו, 15.3.2022).
- חקיקה: חוק החוזים (חלק כללי), התשל"ג-1973, ס"ח 118.
- חוק-יסוד: חוק-יסוד: הממשלה, ס"ח התשס"א 158.
- מאמר: יואב דותן "ביקורת שיפוטית על חקיקה בישראל" **משפטים** כח 77 (1997).
- מחקר כנסת: שירות המחקר של הכנסת **כותרת המחקר** (2023).
- פרוטוקול ישיבה (כלל 8.3): פרוטוקול ישיבה 110 של ועדת החוקה, חוק ומשפט, הכנסת ה-14 (3.11.1997).
- שם / לעיל: שם, בעמ' 85. / פרוקצ'יה, לעיל ה"ש 2, בעמ' 45.

═══ כללי ברזל ═══
- אסור הערה ללא anchor אמיתי. אין מקור — אין [N] ואין הערה.
- חסר פרט בודד (עמוד/שנה/כרך) במקור מעוגן? — [חסר: עמוד] / [חסר: שנה].
- שמות צדדים בעברית מודגשים (**X**); שמות מאמרים במירכאות ("X").
- שנים עבריות עם 'ה' (התשס"א).

═══ רשימת מקורות זמינים ═══
${sourceCatalog}

═══ הקשר מהמקורות ═══
${combinedContext}

═══ תזכורת אחרונה ═══
זהו מצב **${modeLabel}**: יעד ${wordMin}-${wordMax} מילים${researchDepth === "deep" ? `, רצפה קשיחה של ${fnFloor} הערות מעוגנות` : `, ${fnFloor}-${fnMax} הערות מעוגנות (מינימום ${fnFloor})`}, בלוק הערות שוליים בסוף. כל [N] בגוף חייב להיות מגובה בכרטיס מקור מהקטלוג. אל תמציא הערות.

הפורמט בסוף התשובה (חובה לעקוב אחריו אות באות):

--- הערות שוליים ---
1. [אזכור מעוצב לפי הדוגמאות למעלה]
2. [אזכור מעוצב לפי הדוגמאות למעלה]
...`;
    };

    // Decide which prompt to send. The structured drafter (gpt-5-mini) gets
    // the compact one; legacy/fallback path keeps the full one for safety.
    // Pilot v7.2 — gate relaxed from >=2 to >=1 to stop the same question
    // ping-ponging between structured/fallback when Flash conservatively
    // marks 1-2 claims allowed_to_state. The compact drafter prompt + claim
    // map already handle single-claim drafting cleanly via statementMode.
    const useStructuredDrafterPath = enableDeepPipeline && claimMap !== null && claimMapAllowedCount >= 1;
    let drafterSystemPrompt = useStructuredDrafterPath
      ? buildCompactStructuredPrompt()
      : systemPrompt;
    // Academic chapter writes: prepend the academic persona/style block to the
    // structured drafter prompt so the chapter inherits Deep scaffolding AND
    // the high-register academic voice / narrative-citation rules.
    if (useStructuredDrafterPath && isAcademicChapter) {
      const academicHeader = getAcademicSubModePrompt("write_chapter", body);
      if (academicHeader) {
        drafterSystemPrompt = `${academicHeader}\n\n${drafterSystemPrompt}`;
      }
    }
    const promptLen = drafterSystemPrompt.length;
    console.log(`Prompt length: ${promptLen} chars (variant=${useStructuredDrafterPath ? "compact" : "full"}${isAcademicChapter ? "+academic" : ""}), ${sourceCards.length} source cards`);

    // Token budget: structured drafter ceiling scales with the profile's
    // word range (~1.6 tokens per Hebrew word, plus footnote-block headroom).
    // Fast (≤700 words) → 2048; Deep (≤2000 words) → 6144.
    const structuredDrafterMaxTokens = modeProfile.wordRangeMax >= 1500 ? 6144 : 2048;
    const aiMaxTokens = isAcademicMode ? 12288 : (useStructuredDrafterPath ? structuredDrafterMaxTokens : 8192);
    // For pleading_analysis with an uploaded document: the document IS the audit subject,
    // and the typed `question` becomes optional user instructions/focus directives.
    const isPleadingWithDoc = taskMode === "pleading_analysis" && (bodyHasDocument || hasDocument);
    const userMessage = isPleadingWithDoc
      ? `המסמך לבדיקה צורף בהקשר המקורות שלמעלה (תחת "=== מסמך: ... ==="). בצע עליו את פרוטוקול הביקורת המלא.

הנחיות נוספות מהמשתמש (אם קיימות — תן להן עדיפות בנוסף לפרוטוקול המלא):
${question.trim() || "ללא הנחיות נוספות — בצע ביקורת מקיפה לפי כל הפרוטוקולים."}`
      : `השאלה המשפטית: ${question}`;

    const aiBody = JSON.stringify({
      model: "google/gemini-2.5-flash",
      max_tokens: aiMaxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    // Pilot v6: structured drafter uses compact prompt (~6-8k chars vs 28k+
    // for legacy) + gpt-5-mini with 120s timeout. The trim shaves significant
    // input-token latency on top of the model swap.
    const useNewDrafter = useStructuredDrafterPath;
    // Profile-driven timeout: Deep gets more headroom for the heavier model.
    const drafterTimeoutMs = useNewDrafter ? modeProfile.drafterTimeoutMs : 90000;
    const drafterVariant: "structured" | "legacy" = useNewDrafter ? modeProfile.drafterVariant : "legacy";
    console.log(`AI call starting (drafter=${drafterVariant}, ${drafterTimeoutMs / 1000}s timeout)...`);
    let answerText = "";
    let drafterModelUsed = "google/gemini-2.5-flash";
    const drafterStartedAt = new Date();
    const drafterStartMs = Date.now();
    if (useNewDrafter) {
      const drafterRes = await callDrafter(drafterSystemPrompt, userMessage, aiMaxTokens, drafterTimeoutMs, drafterVariant);
      const tAi = Date.now();
      console.log(`Drafter call took ${tAi - tRetrieval}ms (used=${drafterRes?.modelUsed || "FAILED"}, variant=${drafterVariant})`);
      if (!drafterRes || drafterRes.text.length < 50) {
        stageRuns.push({
          stage: "drafting",
          provider: Deno.env.get("OPENAI_API_KEY") ? "openai" : "gemini",
          model: MODEL_CONFIG.STRUCTURED_DRAFTER_OPENAI,
          started_at: drafterStartedAt.toISOString(),
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - drafterStartMs,
          status: "error",
          error_message: "drafter returned empty or null",
        });
        return new Response(
          JSON.stringify({ error: "העוזר המשפטי לא הצליח לייצר תשובה. נסו שוב." }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      answerText = drafterRes.text;
      drafterModelUsed = drafterRes.modelUsed;
      stageRuns.push({
        stage: "drafting",
        provider: drafterModelUsed.startsWith("gpt-") ? "openai" : "gemini",
        model: drafterModelUsed,
        started_at: drafterStartedAt.toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - drafterStartMs,
        status: "success",
      });
    } else {
      try {
        const aiRes = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: aiBody,
        }, 90000);

        const tAi = Date.now();
        console.log(`AI call took ${tAi - tRetrieval}ms`);

        if (!aiRes.ok) {
          if (aiRes.status === 429) {
            return new Response(JSON.stringify({ error: "יותר מדי בקשות. נסו שוב בעוד דקה." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          if (aiRes.status === 402) {
            return new Response(JSON.stringify({ error: "נגמרו הקרדיטים. יש להוסיף קרדיטים בהגדרות." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          const errText = await aiRes.text();
          console.error("AI gateway error:", aiRes.status, errText);
          return new Response(JSON.stringify({ error: "שגיאה בשירות ה-AI. נסו שוב בעוד רגע." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const aiData = await aiRes.json();
        answerText = aiData.choices?.[0]?.message?.content || "";
        const finishReason = aiData.choices?.[0]?.finish_reason || "unknown";
        console.log(`AI response: ${answerText.length} chars, finish_reason=${finishReason}`);

        if (!answerText || answerText.length < 50) {
          return new Response(JSON.stringify({ error: "העוזר המשפטי לא הצליח לייצר תשובה. נסו שוב." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        // Legacy Gemini drafter path — record telemetry too.
        if (enableDeepPipeline) {
          stageRuns.push({
            stage: "drafting",
            provider: "gemini",
            model: "google/gemini-2.5-flash",
            started_at: drafterStartedAt.toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - drafterStartMs,
            status: "success",
          });
        }
      } catch (err) {
        console.error("AI call error:", err);
        if (enableDeepPipeline) {
          stageRuns.push({
            stage: "drafting",
            provider: "gemini",
            model: "google/gemini-2.5-flash",
            started_at: drafterStartedAt.toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: Date.now() - drafterStartMs,
            status: /abort/i.test((err as Error).message ?? "") ? "timeout" : "error",
            error_message: (err as Error).message,
          });
        }
        return new Response(JSON.stringify({ error: "תם הזמן לעיבוד השאלה. נסו שוב או קצרו את השאלה." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }


    // ========= Step 4b: Anchor pass (Pilot v7, Fast-mode) =========
    // Post-draft Gemini Flash call: scan the drafted body for substantive
    // sentences that lack a [N] marker but have a real supporting source in
    // the source pack, and inject `[N]` + a numbered footnote line.
    //
    // Pilot v7.1 — runs on BOTH the structured AND the fallback drafter
    // path. The fallback drafter (Q21-class regression) was producing
    // unanchored statute citations; running anchor pass on its output too
    // gives the same anchoring lift the structured path already gets.
    // Requires: drafted body + source pack present. Claim map is used when
    // available (structured), otherwise anchorClaims is empty and the model
    // falls back to source-pack-only matching.
    // 15s timeout; empty/timeout → ship draft as-is.
    // Pilot v7.6: skip anchor pass on the Fast structured path. The new
    // shaped prompt (400-700 words, 4-6 footnotes) intentionally restricts
    // citation count, so the anchor pass — which adds up to 4 extra
    // footnotes — works against the Fast contract. Anchor pass remains on
    // the legacy fallback path (where the longer mini-memo benefits from
    // additional anchoring) and will be re-enabled with a higher ceiling
    // for a future Deep mode.
    let anchorPassApplied = 0;
    // Anchor pass gate is purely profile-driven. Fast = false (structured
    // path shaped to 4-6 footnotes), Deep = true (richer envelope benefits
    // from additional anchoring). The redundant fast+structured carve-out
    // was removed — the profile flag is the single source of truth.
    const skipAnchorPass = !modeProfile.anchorPassEnabled;
    if (!skipAnchorPass && answerText.length > 200 && sourcePack.length >= 2) {
      const tAnchorStart = Date.now();
      const anchorSourcePack: AnchorPassSourcePackItem[] = sourceCards.map((sc) => ({
        id: sc.id,
        citation: sc.citation,
        source_type: sc.source_type,
        url: sc.url,
        anchor_present: Boolean(sc.url) || sc.provenance === "local" || sc.provenance === "document",
      }));
      const anchorClaims: AnchorPassClaim[] = claimMapV2
        ? claimMapV2.claims
            .filter((c) => c.statementMode !== "omit")
            .map((c) => ({
              claim: c.claimText,
              sourceIds: c.sourceIds.map((sid) => parseInt(sid.replace(/^src-/, ""), 10)).filter((n) => !isNaN(n)),
              authorityLevel: c.authorityLevel,
            }))
        : claimMap
        ? claimMap
            .filter((c) => c.allowed_to_state)
            .map((c) => ({ claim: c.claim, sourceIds: c.source_ids, authorityLevel: c.authority_level }))
        : [];

      try {
        const anchorRes = await runAnchorPass({
          body: answerText,
          sourcePack: anchorSourcePack,
          claims: anchorClaims,
        });
        stageRuns.push(anchorRes.run);
        if (anchorRes.patches.length > 0) {
          const applyRes = applyAnchorPatches(answerText, anchorRes.patches, anchorSourcePack);
          if (applyRes.appliedCount > 0) {
            answerText = applyRes.text;
            anchorPassApplied = applyRes.appliedCount;
          }
        }
        console.log(
          `[anchor-pass] proposed=${anchorRes.patches.length} applied=${anchorPassApplied} (${Date.now() - tAnchorStart}ms; status=${anchorRes.run.status})`,
        );
      } catch (err) {
        console.error("[anchor-pass] unexpected error — shipping draft as-is:", (err as Error).message);
      }
    }


    // ========= Step 5: Parse AI footnotes section =========
    // The AI appends a footnotes header followed by numbered citations.
    // Try multiple separator patterns from strict to loose.
    const separatorPatterns = [
      /---\s*הערות שוליים\s*---/,          // strict: --- הערות שוליים ---
      /\*\*\s*הערות שוליים\s*\*\*/,        // bold: **הערות שוליים**
      /^#{1,3}\s*הערות שוליים/m,           // markdown heading: ## הערות שוליים
      /^הערות שוליים\s*:?\s*$/m,           // standalone line: הערות שוליים or הערות שוליים:
    ];

    let separatorMatch: RegExpMatchArray | null = null;
    for (const pattern of separatorPatterns) {
      separatorMatch = answerText.match(pattern);
      if (separatorMatch && separatorMatch.index !== undefined) {
        console.log(`Footnote separator matched pattern: ${pattern}`);
        break;
      }
    }

    let answerBody = answerText;
    const aiFootnoteLines: Array<{ num: number; text: string }> = [];

    if (separatorMatch && separatorMatch.index !== undefined) {
      answerBody = answerText.slice(0, separatorMatch.index).trim();
      const footnotesSection = answerText.slice(separatorMatch.index + separatorMatch[0].length);

      const linePattern = /^(\d{1,2})\.\s+(.+)$/gm;
      let lineMatch;
      while ((lineMatch = linePattern.exec(footnotesSection)) !== null) {
        aiFootnoteLines.push({
          num: parseInt(lineMatch[1], 10),
          text: lineMatch[2].trim(),
        });
      }
      console.log(`Parsed ${aiFootnoteLines.length} AI-formatted footnotes`);
    } else {
      // Final fallback: detect a trailing block of consecutive numbered lines (1. 2. 3. ...)
      const lines = answerText.split("\n");
      let firstFootnoteLine = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (/^\d{1,2}\.\s+.+/.test(lines[i].trim())) {
          firstFootnoteLine = i;
        } else if (firstFootnoteLine !== -1) {
          break; // stop when we hit a non-numbered line
        }
      }
      if (firstFootnoteLine !== -1 && firstFootnoteLine > 0) {
        // Verify the block starts with "1." to confirm it's footnotes
        const firstNum = lines[firstFootnoteLine].trim().match(/^(\d{1,2})\./);
        if (firstNum && parseInt(firstNum[1], 10) === 1) {
          answerBody = lines.slice(0, firstFootnoteLine).join("\n").trim();
          const footnoteBlock = lines.slice(firstFootnoteLine).join("\n");
          const linePattern = /^(\d{1,2})\.\s+(.+)$/gm;
          let lineMatch;
          while ((lineMatch = linePattern.exec(footnoteBlock)) !== null) {
            aiFootnoteLines.push({
              num: parseInt(lineMatch[1], 10),
              text: lineMatch[2].trim(),
            });
          }
          console.log(`Fallback: parsed ${aiFootnoteLines.length} trailing footnotes`);
        }
      }
      if (aiFootnoteLines.length === 0) {
        console.log("No footnote separator found — falling back to source card citations");
      }
    }

    // ========= Step 5b: Match AI footnotes to source cards for provenance =========
    // STRICT matcher: only attach a card's URL when we have high-confidence identifier overlap.
    // Returns null when uncertain — the footnote will be dropped to avoid wrong-URL leaks.
    const STOPWORDS = new Set([
      "בית", "המשפט", "העליון", "המחוזי", "השלום", "של", "את", "לפי", "על", "עם",
      "אל", "מן", "כי", "או", "גם", "זה", "זו", "אשר", "כפי", "כמו", "אך", "אם",
      "פסק", "דין", "פסקדין", "הלכה", "ערעור", "בקשה", "החלטה", "סעיף", "חוק",
      "ישראל", "מדינת", "המדינה", "נגד", "נ׳", "פרשת", "עניין", "פרשה",
      "עמוד", "בעמ", "פסקה", "ראו", "ראה", "השוו", "וכן",
      // High-frequency Knesset / government / legislative boilerplate that
      // produces false matches against generic page titles.
      "כנסת", "דיון", "ישיבה", "הצעת", "חוקים", "ועדה", "פרוטוקול",
      "מליאה", "ממשלה", "משרד", "הוראות", "תיקון", "מספר", "לעניין",
    ]);

    function normalize(s: string): string {
      return s.toLowerCase().replace(/[״"׳'.,;:()\[\]{}]/g, " ").replace(/\s+/g, " ").trim();
    }

    function matchFootnoteToCard(fnText: string, cards: SourceCard[], fnNum?: number): SourceCard | null {
      const fnLower = fnText.toLowerCase();
      const fnNorm = normalize(fnText);

      // ===== Tier 1: strict identifier matches =====

      // 1a. Exact case number match (e.g., 1234/22) — check both citation text and structured field
      const fnCaseNums = Array.from(fnText.matchAll(/\b(\d{2,5}\/\d{2,4})\b/g)).map(m => m[1]);
      if (fnCaseNums.length > 0) {
        for (const card of cards) {
          for (const cn of fnCaseNums) {
            if (card.citation.includes(cn)) return card;
            if (card.case_number && card.case_number.includes(cn)) return card;
          }
        }
      }

      // 1b. URL substring match (domain + identifier)
      for (const card of cards) {
        if (!card.url) continue;
        try {
          const cardUrl = new URL(card.url);
          const domain = cardUrl.hostname.replace(/^www\./, "");
          if (!fnLower.includes(domain)) continue;
          // Domain present — require additional identifier to confirm same document
          if (domain.includes("nevo.co.il")) {
            const dParam = cardUrl.searchParams.get("d");
            const uParam = cardUrl.searchParams.get("u");
            if (dParam && fnLower.includes(dParam)) return card;
            if (uParam && uParam.length >= 8 && fnLower.includes(uParam.slice(0, 8))) return card;
          } else {
            // Generic: require a path segment of >=6 chars to also appear
            const segments = cardUrl.pathname.split("/").filter(s => s.length >= 6);
            for (const seg of segments) {
              if (fnLower.includes(seg.toLowerCase())) return card;
            }
          }
        } catch { /* skip malformed */ }
      }

      // 1c. Exact normalized title match
      for (const card of cards) {
        const titleNorm = normalize(card.citation);
        if (titleNorm.length >= 15 && fnNorm.includes(titleNorm)) return card;
      }

      // ===== Tier 2: significant-word overlap =====
      // Significant = length ≥ 4, not a stopword.
      // Both local DB cards and Perplexity cards require ≥3 overlap.
      // Perplexity cards additionally require ≥1 "topic-bearing" word (length ≥5,
      // not a stopword) to overlap — this prevents matches that rely only on
      // generic Knesset/legislative boilerplate (e.g. "כנסת"/"דיון"/"הצעת"/"חוק").
      for (const card of cards) {
        const cardWords = normalize(card.citation)
          .split(/\s+/)
          .filter(w => w.length >= 4 && !STOPWORDS.has(w));
        if (cardWords.length < 2) continue;
        const uniqueCardWords = Array.from(new Set(cardWords));
        const overlap = uniqueCardWords.filter(w => fnNorm.includes(w));
        const matchCount = overlap.length;
        if (matchCount < 3) continue;

        if (card.provenance === "perplexity") {
          const hasTopicWord = overlap.some(w => w.length >= 5 && !STOPWORDS.has(w));
          if (!hasTopicWord) {
            console.log(
              `Rejected Perplexity match for fn #${fnNum ?? "?"}: only generic words overlapped with card "${card.citation.slice(0, 80)}" — overlap=[${overlap.join(", ")}]`
            );
            continue;
          }
        }
        return card;
      }

      return null;
    }

    // Build footnotes: prefer AI-formatted text, fall back to source card raw data
    const footnotes: Array<{ number: number; citation: string; source_type: string; url?: string; source?: string }> = [];
    const usedSourceIds = new Set<number>();
    const newCitations: Array<{ citation: string; source_type: string }> = [];

    // Body-side dedup: if any [N] marker appears > 2 times, keep only the first occurrence.
    // Prevents the visual "several ¹" bug when the AI repeats the same reference number.
    {
      const counts = new Map<string, number>();
      const allMatches = Array.from(answerBody.matchAll(/\[(\d{1,2})\]/g));
      for (const m of allMatches) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
      const seen = new Set<string>();
      answerBody = answerBody.replace(/\[(\d{1,2})\]/g, (full, n) => {
        if ((counts.get(n) || 0) > 2) {
          if (seen.has(n)) return "";
          seen.add(n);
          return full;
        }
        return full;
      });
    }

    // Collect [X] and [NEW:...] refs from body
    const refPattern = /\[(\d{1,2})\]/g;
    let refMatch;
    while ((refMatch = refPattern.exec(answerBody)) !== null) {
      usedSourceIds.add(parseInt(refMatch[1], 10));
    }
    const newRefPattern = /\[NEW:([^\]]+)\]/g;
    let newMatch;
    while ((newMatch = newRefPattern.exec(answerBody)) !== null) {
      newCitations.push({ citation: newMatch[1].trim(), source_type: "unknown" });
    }

    const oldIdToNewNumber = new Map<number, number>();
    let fnNum = 1;
    // Milestone A: parser-side anchor enforcement.
    // Track every AI footnote that we drop because it has no catalog/fuzzy
    // anchor. These are surfaced in qa_logs.metadata.dropped_unanchored_count
    // so we can see — honestly — how often the drafter is fabricating
    // citations vs. citing the source pack.
    let droppedUnanchoredCount = 0;
    const droppedUnanchoredPreviews: string[] = [];

    // Footnote dedup telemetry — when the drafter cites the same source card
    // (or, in fuzzy fallback, the same URL) under two different note numbers,
    // we collapse them into one and rewrite the body's [N] markers via
    // oldIdToNewNumber. "שם" / "לעיל ה"ש" short-form notes are NOT touched —
    // those are intentional repeats handled elsewhere.
    const cardIdToNewNumber = new Map<number, number>();        // matched card → first emitted #
    const fuzzyUrlToNewNumber = new Map<string, number>();      // fuzzy URL → first emitted #
    let footnoteDedupMergedCount = 0;
    let footnoteDedupPinpointConflict = 0;
    const footnoteDedupSamples: Array<{ from: number; into: number; title: string; pinpoint_conflict: boolean }> = [];
    // Crude pinpoint detector: "בעמ' 12", "בעמוד 12", "ס' 17(א)", "סעיף 17"
    const PINPOINT_RE = /(בעמ['׳]?\s*\d+|בעמוד\s+\d+|ס['׳]\s*\d+[א-ת()()\d.\-–]*|סעיף\s+\d+[א-ת()()\d.\-–]*)/;
    const extractPinpoint = (s: string): string | null => {
      const m = s.match(PINPOINT_RE);
      return m ? m[1].replace(/\s+/g, " ").trim() : null;
    };

    if (aiFootnoteLines.length > 0) {
      // Use AI-formatted footnotes — match each to a source card for provenance
      for (const aiFn of aiFootnoteLines) {
        const matchedCard = matchFootnoteToCard(aiFn.text, sourceCards, aiFn.num);
        if (matchedCard) {
          // Dedup against an already-emitted card
          const existingNum = cardIdToNewNumber.get(matchedCard.id);
          if (existingNum !== undefined) {
            const existingFn = footnotes.find((f) => f.number === existingNum);
            const newPin = extractPinpoint(aiFn.text);
            const oldPin = existingFn ? extractPinpoint(existingFn.citation) : null;
            const pinpointConflict = !!(newPin && oldPin && newPin !== oldPin);
            if (pinpointConflict) footnoteDedupPinpointConflict++;
            footnoteDedupMergedCount++;
            if (footnoteDedupSamples.length < 3) {
              footnoteDedupSamples.push({
                from: aiFn.num,
                into: existingNum,
                title: matchedCard.citation.slice(0, 80),
                pinpoint_conflict: pinpointConflict,
              });
            }
            console.log(
              `Deduped AI footnote #${aiFn.num} → reusing existing #${existingNum} ` +
              `(same card "${matchedCard.citation.slice(0, 60)}...")` +
              (pinpointConflict ? ` [pinpoint conflict: "${oldPin}" vs "${newPin}"]` : ""),
            );
            oldIdToNewNumber.set(aiFn.num, existingNum);
            continue;
          }
        }
        if (!matchedCard) {
          // ── Fuzzy URL fallback: try to attach a URL via token overlap ──
          let fuzzyUrl: string | undefined;
          let fuzzyMatchedTitle: string | undefined;
          let fuzzyMatchedTokens: string[] = [];
          try {
            const fnText = aiFn.text;
            // Extract distinctive tokens:
            // 1) Case numbers like 338/60 or 35327-08-20
            const caseNumberMatches = Array.from(fnText.matchAll(/\b(\d{2,6}[-\/]\d{2,6}(?:[-\/]\d{2,6})?)\b/g)).map(m => m[1]);
            // 2) Latin all-caps tokens (≥3 letters), e.g. WOLT
            const latinTokens = Array.from(fnText.matchAll(/\b([A-Z]{3,}(?:\s+[A-Z]{2,})*)\b/g)).map(m => m[1]);
            // 3) Hebrew tokens between ** ** markers (party names)
            const boldTokens = Array.from(fnText.matchAll(/\*\*([^*]{2,40})\*\*/g)).map(m => m[1].trim());
            const distinctive = Array.from(new Set([...caseNumberMatches, ...latinTokens, ...boldTokens]));

            if (distinctive.length > 0) {
              for (const card of sourceCards) {
                if (!card.url) continue;
                const haystack = `${card.citation} ${card.case_number || ""} ${card.url} ${card.excerpt || ""}`.toLowerCase();
                const hits: string[] = [];
                for (const tok of distinctive) {
                  if (!tok) continue;
                  if (haystack.includes(tok.toLowerCase())) hits.push(tok);
                }
                // Match if: any case-number hit, OR ≥2 distinctive token hits
                const hasCaseNumberHit = caseNumberMatches.some(cn => hits.includes(cn));
                if (hasCaseNumberHit || hits.length >= 2) {
                  fuzzyUrl = card.url;
                  fuzzyMatchedTitle = card.citation.slice(0, 60);
                  fuzzyMatchedTokens = hits;
                  break;
                }
              }
            }
          } catch (e) {
            console.warn(`Fuzzy URL match error for footnote #${aiFn.num}:`, e);
          }

          if (fuzzyUrl) {
            // Dedup: same fuzzy URL already cited?
            const existingNum = fuzzyUrlToNewNumber.get(fuzzyUrl);
            if (existingNum !== undefined) {
              const existingFn = footnotes.find((f) => f.number === existingNum);
              const newPin = extractPinpoint(aiFn.text);
              const oldPin = existingFn ? extractPinpoint(existingFn.citation) : null;
              const pinpointConflict = !!(newPin && oldPin && newPin !== oldPin);
              if (pinpointConflict) footnoteDedupPinpointConflict++;
              footnoteDedupMergedCount++;
              if (footnoteDedupSamples.length < 3) {
                footnoteDedupSamples.push({
                  from: aiFn.num,
                  into: existingNum,
                  title: (fuzzyMatchedTitle || fuzzyUrl).slice(0, 80),
                  pinpoint_conflict: pinpointConflict,
                });
              }
              console.log(
                `Deduped AI footnote #${aiFn.num} → reusing existing #${existingNum} ` +
                `(same fuzzy URL "${fuzzyUrl}")` +
                (pinpointConflict ? ` [pinpoint conflict: "${oldPin}" vs "${newPin}"]` : ""),
              );
              oldIdToNewNumber.set(aiFn.num, existingNum);
              continue;
            }
            console.log(`Fuzzy URL match: footnote #${aiFn.num} → "${fuzzyMatchedTitle}" (matched on: ${fuzzyMatchedTokens.join(", ")})`);
            footnotes.push({
              number: fnNum,
              citation: aiFn.text,
              source_type: "unverified",
              source: "unverified",
              url: fuzzyUrl,
            });
            fuzzyUrlToNewNumber.set(fuzzyUrl, fnNum);
            oldIdToNewNumber.set(aiFn.num, fnNum);
            fnNum++;
            continue;
          }

          // Milestone A: no card match AND no fuzzy URL → drop the footnote
          // entirely. Previously we kept it with `source: "unverified"`,
          // which let the drafter game the floor by inventing bibliographic
          // entries that didn't tie back to the catalog. Anchoring is now
          // enforced at parse time, not in the prompt.
          droppedUnanchoredCount++;
          if (droppedUnanchoredPreviews.length < 5) {
            droppedUnanchoredPreviews.push(aiFn.text.slice(0, 120));
          }
          console.log(`Dropped unanchored AI footnote #${aiFn.num} (no card match, no fuzzy URL): ${aiFn.text.slice(0, 100)}...`);
          continue;
        }
        footnotes.push({
          number: fnNum,
          citation: aiFn.text,
          source_type: matchedCard.source_type,
          url: matchedCard.url,
          source: matchedCard.provenance || "local",
        });
        cardIdToNewNumber.set(matchedCard.id, fnNum);
        oldIdToNewNumber.set(aiFn.num, fnNum);
        fnNum++;
      }
    } else {
      // Fallback: use source card citations (old behavior)
      for (const srcId of Array.from(usedSourceIds).sort((a, b) => a - b)) {
        const card = sourceCards.find((sc) => sc.id === srcId);
        if (!card) continue;
        oldIdToNewNumber.set(srcId, fnNum);
        footnotes.push({
          number: fnNum,
          citation: card.citation,
          source_type: card.source_type,
          url: card.url,
          source: card.provenance,
        });
        fnNum++;
      }
      // Add new AI-generated citations
      for (const nc of newCitations) {
        footnotes.push({
          number: fnNum,
          citation: nc.citation,
          source_type: nc.source_type,
          source: "perplexity",
        });
        fnNum++;
      }
    }

    // ========= Step 5c: Normalize any raw superscripts back to [X] brackets =========
    // Safety: if the AI still produces Unicode superscripts instead of [X], convert them first
    const superscriptToDigitMap: Record<string, string> = {
      "\u2070": "0", "\u00B9": "1", "\u00B2": "2", "\u00B3": "3",
      "\u2074": "4", "\u2075": "5", "\u2076": "6",
      "\u2077": "7", "\u2078": "8", "\u2079": "9",
    };
    answerBody = answerBody.replace(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]+/g, (match) => {
      const num = match.split("").map(c => superscriptToDigitMap[c] || c).join("");
      return `[${num}]`;
    });
    console.log("Normalized superscripts to brackets in answer body");

    // ========= Step 6: Replace [X] markers with superscripts =========
    let answer = answerBody;

    answer = answer.replace(/\[(\d{1,2})\]/g, (_: string, num: string) => {
      const oldId = parseInt(num, 10);
      const newNum = oldIdToNewNumber.get(oldId);
      if (newNum) return toSuperscript(newNum);
      return "";
    });

    let newIdx = footnotes.length - newCitations.length + 1;
    answer = answer.replace(/\[NEW:[^\]]+\]/g, () => {
      return toSuperscript(newIdx++);
    });

    // ========= Step 6b: Reorder footnotes by first appearance in body =========
    const superscriptPattern = /[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]+/g;
    const superscriptToNum = (s: string) => {
      const reverseMap: Record<string, string> = {};
      for (const [digit, sup] of Object.entries(digitToSuperscript)) {
        reverseMap[sup] = digit;
      }
      return parseInt(s.split("").map(c => reverseMap[c] || c).join(""), 10);
    };

    // Collect footnote numbers in order of first appearance
    const appearanceOrder: number[] = [];
    let supMatch;
    while ((supMatch = superscriptPattern.exec(answer)) !== null) {
      const num = superscriptToNum(supMatch[0]);
      if (!isNaN(num) && !appearanceOrder.includes(num)) {
        appearanceOrder.push(num);
      }
    }

    // Build old→new mapping based on appearance order
    if (appearanceOrder.length > 0) {
      const reorderMap = new Map<number, number>();
      appearanceOrder.forEach((oldNum, idx) => {
        reorderMap.set(oldNum, idx + 1);
      });

      // Replace superscripts in body with placeholders, then with new numbers
      for (const [oldNum, newNum] of reorderMap) {
        answer = answer.replaceAll(toSuperscript(oldNum), `__REORDER_${newNum}__`);
      }
      for (const [, newNum] of reorderMap) {
        answer = answer.replaceAll(`__REORDER_${newNum}__`, toSuperscript(newNum));
      }

      // Reorder footnotes array to match
      const reorderedFootnotes: typeof footnotes = [];
      for (let i = 1; i <= appearanceOrder.length; i++) {
        const oldNum = appearanceOrder[i - 1];
        const fn = footnotes.find(f => f.number === oldNum);
        if (fn) {
          reorderedFootnotes.push({ ...fn, number: i });
        }
      }
      // Add any footnotes not referenced in body at the end
      for (const fn of footnotes) {
        if (!appearanceOrder.includes(fn.number)) {
          reorderedFootnotes.push({ ...fn, number: reorderedFootnotes.length + 1 });
        }
      }
    // Quote-agnostic pattern for "לעיל ה"ש" (matches ", ״, ", ")
      const SUPRA_QUOTE = '["\u05F4\u201C\u201D]';
      const SUPRA_PATTERN = `לעיל\\s+ה${SUPRA_QUOTE}ש\\s+`;

      // Update cross-references ("לעיל ה"ש X") inside footnote citations
      for (const fn of reorderedFootnotes) {
        fn.citation = fn.citation.replace(
          new RegExp(SUPRA_PATTERN + '(\\d{1,2})', 'g'),
          (match: string, num: string) => {
            const oldNum = parseInt(num, 10);
            const newNum = reorderMap.get(oldNum);
            return newNum ? `לעיל ה"ש ${newNum}` : match;
          }
        );
      }

      footnotes.length = 0;
      footnotes.push(...reorderedFootnotes);
    }

    // ========= Step 7: Post-processing =========
    // Fix superscripts that precede punctuation — move them after
    answer = answer.replace(/([\u00B9\u00B2\u00B3\u2074-\u2079]+)([,.\-;:!?])/g, '$2$1');

    // Strip titles from citations
    const titlePattern = /\b(פרופ['׳]|ד"ר|ד״ר|עו"ד|עו״ד|רו"ח|רו״ח|שופטת|שופט|המנוחה|המנוח|ז"ל|ז״ל)\s*/g;
    for (const fn of footnotes) {
      fn.citation = fn.citation.replace(titlePattern, "").replace(/\s{2,}/g, " ").trim();
    }

    // Remove placeholders — but PRESERVE [חסר: ...] markers (intentional partial-citation signal)
    const placeholderPattern = /\[missing:[^\]]*\]|\[פרט חסר[^\]]*\]/g;
    for (const fn of footnotes) {
      fn.citation = fn.citation.replace(placeholderPattern, "").trim();
      fn.citation = fn.citation.replace(/,?\s*עמ['׳]?\s*$/, "").trim();
    }

    // Strip [NEW:...] wrappers from footnotes and body
    for (const fn of footnotes) {
      fn.citation = fn.citation.replace(/^\[NEW:\s*/, "").replace(/\]$/, "").trim();
    }
    answer = answer.replace(/\[NEW:[^\]]+\]/g, "");

    // Fix self-referencing "לעיל ה"ש X" where X equals the footnote's own number
    const SUPRA_Q = '["\u05F4\u201C\u201D]';
    const SUPRA_P = `לעיל\\s+ה${SUPRA_Q}ש\\s+`;
    for (const fn of footnotes) {
      const selfRefPattern = new RegExp(SUPRA_P + `${fn.number}\\b`, "g");
      if (selfRefPattern.test(fn.citation)) {
        // Remove the self-referencing phrase and clean up
        fn.citation = fn.citation.replace(new RegExp(`,?\\s*` + SUPRA_P + `${fn.number}\\b`, "g"), "").trim();
        fn.citation = fn.citation.replace(/^[,،\s]+/, "").trim();
      }
    }

    // Validate cross-references: ensure "לעיל ה"ש X" points to a matching source
    for (const fn of footnotes) {
      const refMatch = fn.citation.match(new RegExp(SUPRA_P + '(\\d{1,2})'));
      if (refMatch) {
        const targetNum = parseInt(refMatch[1], 10);
        const targetFn = footnotes.find(f => f.number === targetNum);
        if (!targetFn) {
          // Target doesn't exist — remove the cross-reference phrase
          fn.citation = fn.citation.replace(new RegExp(`,?\\s*` + SUPRA_P + '\\d{1,2}'), "").trim();
          fn.citation = fn.citation.replace(/^[,،\s]+/, "").trim();
        }
      }
    }

    // Content-aware "לעיל ה"ש" validator: ensure target footnote actually contains the same source.
    // Extracts identity keys (author surname, case number, law name) from each footnote
    // and rewrites mismatched back-refs to point at the earliest matching full-citation.
    const SUPRA_FULL = new RegExp(SUPRA_P + '(\\d{1,2})');
    const normalizeKey = (s: string) =>
      s
        .replace(/["'\u05F4\u201C\u201D\u2018\u2019׳]/g, "")
        .replace(/[.,;:!?\-–—()\[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    // Extract identity keys from a citation. Returns multiple candidate keys (case#, law name, author).
    const extractIdentityKeys = (citation: string): string[] => {
      const keys: string[] = [];
      // Skip if this citation is itself just a back-ref (no full content)
      if (SUPRA_FULL.test(citation) && citation.length < 80) {
        // It's likely a short-form — still try to extract author/law for matching
      }

      // 1. Case number patterns (e.g., 35327-08-20, 10007/09)
      const caseNumMatches = citation.match(/\d{3,6}[-\/]\d{1,4}([-\/]\d{1,4})?/g);
      if (caseNumMatches) {
        for (const cn of caseNumMatches) keys.push(normalizeKey(cn));
      }

      // 2. Law/regulation name (text starting with חוק/פקודת/תקנות/חוק-יסוד up to first comma)
      const lawMatch = citation.match(/^\s*((?:חוק[- ]יסוד|חוק|פקודת|פקודה|תקנות|צו|כללי)\s+[\u0590-\u05FF"׳״\s'\-]+?)(?:,|$)/);
      if (lawMatch) keys.push(normalizeKey(lawMatch[1]));

      // 3. Author surname: first 1-2 Hebrew words appearing before an opening quote (article/book title)
      // Strip leading non-Hebrew/whitespace
      const authorMatch = citation.match(/^\s*([\u0590-\u05FF]+(?:\s+[\u0590-\u05FF]+)?)\s+["\u201C\u05F4]/);
      if (authorMatch) {
        const author = authorMatch[1];
        // Avoid matching law-prefix words as authors
        if (!/^(חוק|פקודת|פקודה|תקנות|צו|כללי|בג"ץ|בג״ץ)/.test(author)) {
          keys.push(normalizeKey(author));
        }
      }

      return Array.from(new Set(keys.filter((k) => k.length >= 3)));
    };

    // Extract back-ref key from a short-form footnote (text before ", לעיל ה"ש X")
    const extractBackRefKey = (citation: string): string[] => {
      const supraIdx = citation.search(new RegExp(SUPRA_P));
      if (supraIdx < 0) return [];
      // Take text before the supra phrase, strip trailing comma/pinpoint clauses
      let prefix = citation.slice(0, supraIdx).trim().replace(/[,،]\s*$/, "").trim();
      // Strip trailing pinpoint clause (last comma-separated segment if it looks like a pinpoint)
      const parts = prefix.split(/,\s*/);
      if (parts.length > 1) {
        const last = parts[parts.length - 1];
        if (/^(ס['׳]|סעיף|עמ['׳]|עמוד|פס['׳]|פסקה|פיסקה|תק['׳]|תקנה)\b/.test(last) || /^\d/.test(last)) {
          prefix = parts.slice(0, -1).join(", ").trim();
        }
      }
      return extractIdentityKeys(prefix + ' "x"'); // add fake quote so author regex hits
    };

    // Pre-compute identity keys for every footnote (only for those that look like full citations)
    const fnKeys = new Map<number, string[]>();
    for (const fn of footnotes) {
      // Skip footnotes that are themselves back-refs (no full content to match against)
      const isShortForm = SUPRA_FULL.test(fn.citation) || /^שם\b/.test(fn.citation.trim());
      if (isShortForm) {
        fnKeys.set(fn.number, []);
      } else {
        fnKeys.set(fn.number, extractIdentityKeys(fn.citation));
      }
    }

    // Validate and rewrite back-refs
    for (const fn of footnotes) {
      const refMatch = fn.citation.match(new RegExp(SUPRA_P + '(\\d{1,2})'));
      if (!refMatch) continue;
      const aiTargetNum = parseInt(refMatch[1], 10);
      const backRefKeys = extractBackRefKey(fn.citation);
      if (backRefKeys.length === 0) continue;

      // Find earliest-numbered footnote (before current) whose keys overlap
      let bestMatch: number | null = null;
      const sortedFns = [...footnotes].sort((a, b) => a.number - b.number);
      for (const candidate of sortedFns) {
        if (candidate.number >= fn.number) break;
        const candKeys = fnKeys.get(candidate.number) || [];
        if (candKeys.some((ck) => backRefKeys.some((bk) => ck === bk || ck.includes(bk) || bk.includes(ck)))) {
          bestMatch = candidate.number;
          break;
        }
      }

      if (bestMatch !== null && bestMatch !== aiTargetNum) {
        const before = fn.citation;
        fn.citation = fn.citation.replace(
          new RegExp(SUPRA_P + '\\d{1,2}'),
          `לעיל ה"ש ${bestMatch}`
        );
        console.log(
          `Corrected back-ref in FN #${fn.number}: "${backRefKeys.join("|").slice(0, 60)}" → ה"ש ${aiTargetNum} became ה"ש ${bestMatch}`
        );
        console.log(`  before: ${before.slice(0, 120)}`);
        console.log(`  after:  ${fn.citation.slice(0, 120)}`);
      }
    }

    // ========= Rule 37 post-processing — repeated citations cleanup =========
    // 37.5: Legislation must not use "לעיל ה"ש N" — rewrite as "ס' [pinpoint] ל[law name]."
    // Detects: "<law>, לעיל ה"ש N[, בס' X]." and rewrites to the section-first form.
    const LAW_PREFIX = '(?:חוק[- ]יסוד|חוק|פקודת|פקודה|תקנות|תקנה|צו|כללי)';
    const lawSupraRe = new RegExp(
      `^\\s*(${LAW_PREFIX}\\s+[^,]+?),\\s*${SUPRA_P}\\d{1,2}(?:,\\s*ב?ס['׳]\\s*([\\d\\u0590-\\u05FFא-ת()]+))?\\s*\\.?\\s*$`
    );
    for (const fn of footnotes) {
      const m = fn.citation.match(lawSupraRe);
      if (m) {
        const lawName = m[1].trim();
        const pinpoint = m[2]?.trim();
        const before = fn.citation;
        fn.citation = pinpoint ? `ס' ${pinpoint} ל${lawName}.` : `${lawName}.`;
        console.log(`Rule 37.5 fix in FN #${fn.number}: "${before.slice(0, 120)}" → "${fn.citation.slice(0, 120)}"`);
      }
    }

    // 37.8: collapse "שם, שם" → "שם" (never repeat "שם" with comma)
    for (const fn of footnotes) {
      fn.citation = fn.citation.replace(/\bשם\s*[,،]\s*שם\b/g, "שם");
    }

    // 37.8: enforce בי"ת prefix on pinpoint inside SHORT-FORM citations only
    // (citations that contain "שם" or "לעיל ה"ש"). Avoid touching full citations,
    // which already use a different formula (e.g. "פ"ד נד(1) 258, 263 (2000)").
    const beitPrefixRe = /,\s*(עמ['׳])\s+(\d)/g;
    const pisPrefixRe = /,\s*(פס['׳])\s+(\d)/g;
    const sectionPrefixRe = /,\s*(ס['׳])\s+(\d|[\u0590-\u05FFא-ת])/g;
    for (const fn of footnotes) {
      const isShortForm = SUPRA_FULL.test(fn.citation) || /\bשם\b/.test(fn.citation);
      if (!isShortForm) continue;
      fn.citation = fn.citation
        .replace(beitPrefixRe, ", ב$1 $2")
        .replace(pisPrefixRe, ", ב$1 $2")
        .replace(sectionPrefixRe, ", ב$1 $2");
    }

    for (const fn of footnotes) {
      fn.citation = fixHebrewYearPrefix(fn.citation);
    }

    // Rule 24.9.2: strip Hebrew year when both Hebrew and Gregorian appear in parens
    answer = normalizeArticleYearByRule2492(answer);
    for (const fn of footnotes) {
      fn.citation = normalizeArticleYearByRule2492(fn.citation);
    }

    // Ensure trailing period on every citation
    for (const fn of footnotes) {
      if (fn.citation && !/[.。]$/.test(fn.citation.trim())) {
        fn.citation = fn.citation.trim() + ".";
      }
    }

    // ========= Legislation year-completeness validator =========
    // Rule 2.4 / 2.8: legislation citations must include the Hebrew year before ס"ח/ק"ת page.
    // Pattern: "<חוק/פקודת/תקנות ...>, ס"ח <number>" without a Hebrew year anywhere before ס"ח.
    // Insert a [חסר: שנה] marker so the gap is visible (and so the placeholder_dominant filter
    // catches unanchored cases).
    // Skip short-form ("שם" / "לעיל ה"ש") and citations that already mark the missing year.
    const LEG_NO_YEAR_RE = /^(\s*(?:חוק[- ]יסוד[^,]*|חוק[^,]+|פקודת[^,]+|תקנות[^,]+|צו[^,]+))\s*,\s*(ס["״]ח|ק["״]ת)\s+(\d{1,4})\b/;
    const HEBREW_YEAR_RE = /\bה?תש[א-ת"״'׳\-]+/;
    for (const fn of footnotes) {
      if (SUPRA_FULL.test(fn.citation) || /\bשם\b/.test(fn.citation)) continue;
      if (/\[חסר:\s*שנה\]/.test(fn.citation)) continue;
      const m = fn.citation.match(LEG_NO_YEAR_RE);
      if (!m) continue;
      const headSegment = fn.citation.slice(0, fn.citation.indexOf(m[2]));
      if (HEBREW_YEAR_RE.test(headSegment)) continue;
      const before = fn.citation;
      fn.citation = fn.citation.replace(LEG_NO_YEAR_RE, `$1, [חסר: שנה], $2 $3`);
      console.log(`Legislation year fix in FN #${fn.number}: "${before.slice(0, 120)}" → "${fn.citation.slice(0, 120)}"`);
    }

    // ========= Rule 8.3 protocol cleanup =========
    // Cleanup ONLY — does not synthesize Rule 8.3 format.
    // Strips invalid patterns from Knesset/government meeting-protocol citations.
    // If nothing meaningful remains, the existing filter pipeline
    // (url_only / too_short / placeholder_dominant / broken_title) will drop the
    // footnote. Producing a valid Rule 8.3 citation
    // ("פרוטוקול ישיבה X של ועדת Y, הכנסת ה-N (date).") is the AI's responsibility,
    // driven by: prompt + source-card hint (KNESSET_PROTOCOL_RE) + citationRules.ts.
    const KNESSET_PUB_RE = /\s*\(פורסם\s+ב?(?:אתר\s+)?ה?כנסת[^)]*\)\s*/g;
    const MISSING_MEETING_NUM_RE = /\s*\[חסר:\s*מספר\s+ישיבה\s*\]\s*/g;
    const PROTOCOL_AUTHOR_RE = /^\s*\[חסר:\s*שם\s+(?:מומחה|מחבר)\s*\]\s*/;
    const KNESSET_PROTOCOL_URL_RE = /fs\.knesset\.gov\.il\/\d+\/(?:Committees|Plenum)\//i;
    for (const fn of footnotes) {
      const isProtocolCit =
        /פרוטוקול\s+ישיבה/.test(fn.citation) ||
        KNESSET_PROTOCOL_URL_RE.test(fn.url || "") ||
        KNESSET_PROTOCOL_URL_RE.test(fn.citation) ||
        KNESSET_PUB_RE.test(fn.citation);
      if (!isProtocolCit) continue;
      const before = fn.citation;
      fn.citation = fn.citation
        .replace(KNESSET_PUB_RE, " ")
        .replace(MISSING_MEETING_NUM_RE, " ")
        .replace(PROTOCOL_AUTHOR_RE, "")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([.,;:])/g, "$1")
        .trim();
      if (before !== fn.citation) {
        console.log(`Rule 8.3 cleanup FN #${fn.number}: "${before.slice(0, 100)}" → "${fn.citation.slice(0, 100)}"`);
      }
    }

    // Filter footnotes that are bare URLs / URL-only (violation of citation rules),
    // too short, or missing substantive words. Then renumber.
    const URL_ONLY_RE = /^(?:\[?\s*)?https?:\/\/\S+(?:\s*\([^)]*\))?\s*\.?\s*$/i;
    const isUrlOnly = (txt: string): boolean => {
      const t = txt.trim();
      if (!t) return false;
      // strip trailing parenthetical date like "(10.04.2024)" and trailing punctuation, then check
      const stripped = t.replace(/\s*\([^)]*\)\s*\.?$/, "").replace(/\.$/, "").trim();
      return URL_ONLY_RE.test(t) || /^https?:\/\/\S+$/i.test(stripped);
    };
    // A footnote needs at least one substantive word (3+ Hebrew/Latin letters)
    // beyond a leading case number — pure "20.1.5931 (בתי משפט השלום)" lacks parties.
    const HAS_SUBSTANTIVE_WORD_RE = /[א-תA-Za-z]{3,}/;
    const isMissingSubstance = (txt: string): boolean => {
      const t = txt.trim();
      if (!HAS_SUBSTANTIVE_WORD_RE.test(t)) return true;
      const withoutCaseHead = t
        .replace(/^[\d./\-א-ת"׳״']{2,30}\s*/, "")
        .replace(/\s*\([^)]*\)\s*\.?$/, "")
        .trim();
      return withoutCaseHead.length < 4 || !HAS_SUBSTANTIVE_WORD_RE.test(withoutCaseHead);
    };
    // hasAnchor: a footnote is "anchored" only if it points to a real, retrievable source —
    // a URL, or a `source` provenance from a real card (local DB / perplexity / verified_source).
    // The literal `"unverified"` source string means no card was matched, so it is NOT an anchor.
    // Critically: the [חסר: ...] marker itself is NOT proof of an anchor — the AI must not be
    // able to bypass the filter by sprinkling markers without a real source behind them.
    const hasAnchor = (fn: { url?: string; source?: string; citation: string }): boolean => {
      if (fn.url && fn.url.trim().length > 0) return true;
      const src = (fn.source || "").trim().toLowerCase();
      if (src && src !== "unverified") return true;
      return false;
    };
    const hasMissingMarker = (txt: string): boolean => /\[חסר:\s*[^\]]+\]/.test(txt);
    // Known broken/placeholder titles from ingestion failures (e.g., Knesset research
    // scrape fallback). These are never a valid citation — drop unconditionally,
    // even if anchored, since "פרטי מסמך" / "ללא כותרת" are non-titles.
    const BROKEN_TITLE_RE = /^\s*(?:["״"]?)\s*(?:פרטי\s+מסמך|ללא\s+כותרת|untitled|no\s+title)\b/i;
    const isBrokenTitle = (txt: string): boolean => BROKEN_TITLE_RE.test(txt.trim());
    const reasonFor = (fn: { citation: string; url?: string; source?: string }): string | null => {
      const t = fn.citation.trim();
      if (isUrlOnly(t)) return "url_only"; // hard fail always
      if (isBrokenTitle(t)) return "broken_title"; // hard fail always — invalid placeholder title
      const anchored = hasAnchor(fn);
      // NEW: unanchored + AI explicitly admitted missing fields ([חסר: ...]) → drop.
      // The marker alone is never proof of an anchor; without a real source it's a hallucinated skeleton.
      if (!anchored && hasMissingMarker(t)) return "placeholder_dominant";
      const minLen = anchored ? 12 : 25;
      if (t.length < minLen) return "too_short";
      // anchored footnotes may have partial info ([חסר: צד]) — don't drop them on missing_parties
      if (!anchored && isMissingSubstance(t)) return "missing_parties";
      return null;
    };
    const droppedDetails: { number: number; reason: string; preview: string; anchored: boolean; has_marker: boolean }[] = [];
    const validFootnotes = footnotes.filter((fn) => {
      const reason = reasonFor(fn);
      if (reason) {
        droppedDetails.push({
          number: fn.number,
          reason,
          preview: fn.citation.slice(0, 80),
          anchored: hasAnchor(fn),
          has_marker: hasMissingMarker(fn.citation),
        });
        return false;
      }
      return true;
    });
    const droppedFootnotesCount = droppedDetails.length;
    if (droppedFootnotesCount > 0) {
      for (const d of droppedDetails) {
        console.log(`Dropped footnote #${d.number} [${d.reason}, anchored=${d.anchored}, has_marker=${d.has_marker}]: "${d.preview}"`);
      }
      const removedNumbers = new Set(droppedDetails.map((d) => d.number));
      for (const num of removedNumbers) {
        answer = answer.replaceAll(toSuperscript(num), "");
      }
      validFootnotes.forEach((fn, idx) => {
        const oldSup = toSuperscript(fn.number);
        const newNum = idx + 1;
        if (fn.number !== newNum) {
          answer = answer.replaceAll(oldSup, `__FN_${newNum}__`);
        }
        fn.number = newNum;
      });
      for (const fn of validFootnotes) {
        answer = answer.replaceAll(`__FN_${fn.number}__`, toSuperscript(fn.number));
      }
    }

    // ========= Orphan superscript cleanup =========
    // After all renumbering: scan body for any superscript digits that don't map to a valid
    // footnote number, and strip them (along with a stray preceding space if it was created).
    {
      const validNums = new Set(validFootnotes.map((fn) => fn.number));
      // Match runs of superscript digits (possibly multi-digit like ¹²)
      answer = answer.replace(/([\u00B9\u00B2\u00B3\u2074-\u2079]+)/g, (match) => {
        const digits = match
          .split("")
          .map((c) => {
            const map: Record<string, string> = {
              "\u00B9": "1", "\u00B2": "2", "\u00B3": "3",
              "\u2074": "4", "\u2075": "5", "\u2076": "6",
              "\u2077": "7", "\u2078": "8", "\u2079": "9", "\u2070": "0",
            };
            return map[c] || "";
          })
          .join("");
        const num = parseInt(digits, 10);
        if (Number.isFinite(num) && validNums.has(num)) return match;
        return ""; // orphan — strip
      });
      // Clean up "word .  " (stray space before punctuation) created by orphan removal
      answer = answer.replace(/ +([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
    }

    const finalFootnotes = validFootnotes;

    // ===== Citation engine resolver — canonicalise chapter footnotes =====
    // For academic chapter writes, run each parsed footnote through the same
    // resolver Stage E.5 candidates use. When the engine resolves a citation,
    // we overwrite `citation` with the canonical re-emission (rule template).
    // Non-blocking: unresolved footnotes are kept as-is.
    let chapterEngineResolvedCount = 0;
    let chapterEngineUnresolvedCount = 0;
    const chapterEngineDropReasons: Record<string, number> = {};
    if (isAcademicChapter && finalFootnotes.length > 0) {
      for (const fn of finalFootnotes) {
        const text = fn.citation || "";
        // Skip footnotes that have a missing-data placeholder marker.
        if (/\[חסר/.test(text)) continue;
        // Cheap declared-type heuristic — same split the resolver expects.
        const declared: "statute" | "caselaw" =
          /[א-ת]{1,3}["״׳']+[א-ת]{1,2}\s+\d+\/\d+|פ["״]ד|פד["״]ע/.test(text)
            ? "caselaw"
            : "statute";
        const res = resolveCitation(text, declared);
        if (res.resolved) {
          fn.citation = res.canonical;
          chapterEngineResolvedCount++;
        } else {
          chapterEngineUnresolvedCount++;
          chapterEngineDropReasons[res.reason] = (chapterEngineDropReasons[res.reason] || 0) + 1;
        }
      }
      console.log(`[chapter-engine] resolved=${chapterEngineResolvedCount} unresolved=${chapterEngineUnresolvedCount} reasons=${JSON.stringify(chapterEngineDropReasons)}`);
    }

    console.log(`Final: answer=${answer.length} chars, footnotes=${finalFootnotes.length}, total time=${Date.now() - t0}ms`);

    // ===== Citation density diagnostic (log-only, non-blocking) =====
    try {
      const wordCount = answer.split(/\s+/).filter(Boolean).length;
      const ratio = wordCount > 0 ? (finalFootnotes.length / wordCount * 1000).toFixed(1) : "0";
      const cardsCount = Array.isArray(sourceCards) ? sourceCards.length : 0;
      console.log(`Citation density: ${finalFootnotes.length} footnotes / ${wordCount} words (${ratio} per 1000 words; cards available: ${cardsCount})`);
      if (finalFootnotes.length < 4 && cardsCount >= 6 && wordCount >= 600) {
        console.warn(`Possible under-citation: ${finalFootnotes.length} footnotes / ${wordCount} words despite ${cardsCount} available cards. Review prompt coverage.`);
      }
    } catch (e) {
      console.log(`Citation density check skipped: ${(e as Error).message}`);
    }

    // ===== Coverage gap instrumentation (Pilot v7 Step 1, log-only) =====
    // Measures how many source cards passed to the structured drafter were
    // actually cited, and how many substantive legal claims in the body lack
    // an adjacent footnote marker. This is the real "coverage gap" number
    // (vs the proxy of footnote count) that decides whether to ship an
    // anchor-pass stage. Heuristic + log-only; never blocks the response.
    try {
      const isStructured = enableDeepPipeline && useStructuredDrafterPath;
      if (isStructured) {
        const cardsIn = Array.isArray(sourceCards) ? sourceCards.length : 0;

        // Cards actually cited: a card is "cited" if its url appears on any
        // final footnote, OR if its title's first 3 distinctive tokens all
        // appear in any footnote citation text. Conservative — undercounts
        // rather than overcounts so the gap number is honest.
        const stop = new Set(["של","את","עם","על","אל","ולא","לא","הוא","היא","זה","זו","אך","או","גם","כי","כמו","כל","אם","פס\"ד","פסק","דין","חוק","סעיף"]);
        const tokensOf = (s: string): string[] =>
          (s || "")
            .replace(/["״׳'"().,:;\[\]{}]/g, " ")
            .split(/\s+/)
            .filter((t) => t.length >= 3 && !stop.has(t))
            .slice(0, 3);
        let cardsCited = 0;
        const cardsTotal = Array.isArray(sourceCards) ? sourceCards.length : 0;
        if (Array.isArray(sourceCards)) {
          for (const card of sourceCards) {
            const cardUrl: string | undefined = (card as { url?: string }).url;
            const cardTitle: string = (card as { title?: string }).title || "";
            const titleToks = tokensOf(cardTitle);
            const hit = finalFootnotes.some((fn) => {
              if (cardUrl && fn.url && fn.url === cardUrl) return true;
              const fnText = fn.citation || "";
              return titleToks.length >= 2 && titleToks.every((t) => fnText.includes(t));
            });
            if (hit) cardsCited++;
          }
        }

        // Substantive claims in the body that lack an adjacent footnote.
        // A "substantive claim" is a sentence containing one of the legal
        // anchor terms (חוק / סעיף / פס"ד / פסק דין / קבע / נפסק / הלכה / קובע / מורה).
        // "Adjacent footnote" = a digit (which has already been normalized
        // from superscript to e.g. ¹/[1]) within ~30 chars of the term, or
        // a "[\d+]" / superscript anywhere in the sentence.
        const sentences = answer
          .split(/(?<=[.!?])\s+|\n+/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 20);
        const claimRegex = /(חוק\s|סעיף\s|פס["״]ד|פסק\s+דין|נפסק|קבע\s|קובע\s|מורה\s|הלכה\s)/;
        const noteRegex = /[¹²³⁴⁵⁶⁷⁸⁹⁰]|\[\d{1,3}\]/;
        let claimsTotal = 0;
        let claimsAnchored = 0;
        const unanchoredSamples: string[] = [];
        for (const sent of sentences) {
          if (!claimRegex.test(sent)) continue;
          claimsTotal++;
          if (noteRegex.test(sent)) {
            claimsAnchored++;
          } else if (unanchoredSamples.length < 5) {
            unanchoredSamples.push(sent.slice(0, 120));
          }
        }
        const coveragePct = claimsTotal > 0 ? Math.round((claimsAnchored / claimsTotal) * 100) : 0;
        const cardsPct = cardsTotal > 0 ? Math.round((cardsCited / cardsTotal) * 100) : 0;

        console.log(
          `[coverage-gap] cards_in=${cardsTotal} cards_cited=${cardsCited} (${cardsPct}%) | ` +
          `claims_total=${claimsTotal} claims_anchored=${claimsAnchored} (${coveragePct}%) | ` +
          `footnotes=${finalFootnotes.length}`,
        );
        if (unanchoredSamples.length > 0) {
          for (const s of unanchoredSamples) {
            console.log(`[coverage-gap] unanchored: "${s}"`);
          }
        }
      }
    } catch (e) {
      console.log(`Coverage gap instrumentation skipped: ${(e as Error).message}`);
    }

    // ===== Fix 2: Post-draft statute completion (Deep + academic) =====
    // The drafter sometimes names a חוק / חוק-יסוד / פקודה / תקנה in the body
    // text but no footnote anchors it (Stage E.5 fires pre-draft on sub-issue
    // gaps; the anchor pass can only re-use existing cards). This stage scans
    // the *drafted* body for unanchored statute names and runs a targeted
    // Perplexity completion to fetch the missing bibliographic citation.
    // Validated entries are pushed as new SourceCards + footnotes, and a
    // `[N]` marker is inserted right after the first naked mention. Capped at
    // 3 statutes per run.
    const statuteCompletionTelemetry: {
      triggered: boolean;
      named_statutes: string[];
      completed_count: number;
      skipped_with_existing: number;
      drops?: Record<string, number>;
      status?: string;
      duration_ms?: number;
    } = {
      triggered: false,
      named_statutes: [],
      completed_count: 0,
      skipped_with_existing: 0,
    };
    if (enableDeepPipeline) {
      const tSC = Date.now();
      try {
        // 1. Scan body for Hebrew statute mentions
        const STATUTE_RE = /(חוק[- ]יסוד[^,.\n[\]]{2,80}|חוק [^,.\n[\]]{2,80}|פקודת [^,.\n[\]]{2,80}|תקנות [^,.\n[\]]{2,80})/g;
        const rawMatches: Array<{ name: string; index: number }> = [];
        let scanM: RegExpExecArray | null;
        while ((scanM = STATUTE_RE.exec(answer)) !== null) {
          const name = scanM[1].replace(/\s+/g, " ").trim().replace(/[,;:.]+$/, "");
          if (/^חוק\s+(זה|אחר|ה[^\s]+)\s*$/.test(name)) continue;
          rawMatches.push({ name, index: scanM.index });
        }
        // De-dup by normalized name, keep first occurrence
        const seenNorm = new Set<string>();
        const uniqueMentions: Array<{ name: string; index: number }> = [];
        for (const r of rawMatches) {
          const norm = r.name.toLowerCase();
          if (seenNorm.has(norm)) continue;
          seenNorm.add(norm);
          uniqueMentions.push(r);
        }

        // 2. Filter mentions that already have an anchor
        const NEAR_RADIUS = 120;
        const candidates: Array<{ name: string; index: number }> = [];
        for (const mention of uniqueMentions) {
          const nameKey = mention.name.replace(/^חוק[- ]יסוד\s*:?\s*/, "").trim();
          const inExistingFn = finalFootnotes.some(
            (fn) => fn.citation && (fn.citation.includes(mention.name) || (nameKey.length >= 6 && fn.citation.includes(nameKey))),
          );
          if (inExistingFn) {
            statuteCompletionTelemetry.skipped_with_existing++;
            continue;
          }
          const start = Math.max(0, mention.index);
          const end = Math.min(answer.length, mention.index + mention.name.length + NEAR_RADIUS);
          const window = answer.slice(start, end);
          if (/\[\d{1,3}\]|[¹²³⁴⁵⁶⁷⁸⁹⁰]/.test(window)) {
            statuteCompletionTelemetry.skipped_with_existing++;
            continue;
          }
          candidates.push(mention);
        }

        // 3. Cap at 3
        const targets = candidates.slice(0, 3);
        statuteCompletionTelemetry.named_statutes = targets.map((t) => t.name);
        statuteCompletionTelemetry.triggered = targets.length > 0;

        if (targets.length > 0) {
          console.log(`[statute-completion] triggered for ${targets.length} statute(s): ${targets.map((t) => t.name).join(" | ")}`);

          const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
          if (!PERPLEXITY_API_KEY) {
            statuteCompletionTelemetry.status = "no_perplexity_key";
          } else {
            const userPrompt = [
              `החזר ציטוט ביבליוגרפי מלא עבור החוקים/הפקודות/התקנות הבאים:`,
              ...targets.map((t, i) => `${i + 1}. ${t.name}`),
              "",
              `עבור כל פריט החזר type="statute" עם השדות:`,
              `- citation: שם מלא + שנה עברית + שנה לועזית + ס"ח/ק"ת + עמוד פתיחה. דוגמה: "חוק-יסוד: כבוד האדם וחירותו, ס\\"ח התשנ\\"ב 150."`,
              `- year_hebrew: בפורמט התש... (חובה)`,
              `- year_gregorian: שנת לועזית בת 4 ספרות (חובה)`,
              `- title: שם החוק עם פרטי פרסום (חובה — חייב לכלול ס"ח/ק"ת + מספר עמוד)`,
              `- url: קישור ישיר לנוסח הרשמי באתר nevo.co.il / fs.knesset.gov.il`,
              "",
              `אם אינך יכול לספק את כל השדות לפריט מסוים — אל תכלול אותו. רק JSON תקני.`,
            ].join("\n");

            const schema = {
              type: "object",
              properties: {
                candidates: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { type: "string", enum: ["statute"] },
                      title: { type: "string" },
                      citation: { type: "string" },
                      year_hebrew: { type: "string" },
                      year_gregorian: { type: "string" },
                      url: { type: "string" },
                    },
                    required: ["type", "title", "citation", "url"],
                  },
                },
              },
              required: ["candidates"],
            };

            const ctrl = new AbortController();
            const timeoutId = setTimeout(() => ctrl.abort(), 15_000);
            let raw: PerplexityCompletionCandidate[] = [];
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
                  response_format: { type: "json_schema", json_schema: { name: "statute_completion", schema } },
                  messages: [
                    {
                      role: "system",
                      content:
                        "You are a precise Israeli-law research assistant. Return ONLY statute citations you can cite with FULL bibliographic detail (Hebrew year התש..., 4-digit Gregorian year, ס\"ח or ק\"ת + opening page). If any required field is unknown, OMIT the entire entry — never invent. Output JSON matching the schema exactly.",
                    },
                    { role: "user", content: userPrompt },
                  ],
                }),
              });
              clearTimeout(timeoutId);
              if (res.ok) {
                const data = await res.json();
                const content = data.choices?.[0]?.message?.content || "";
                try {
                  const parsed = JSON.parse(content);
                  if (Array.isArray(parsed?.candidates)) raw = parsed.candidates.slice(0, 3);
                } catch (parseErr) {
                  console.warn("[statute-completion] JSON parse failed:", parseErr);
                  statuteCompletionTelemetry.status = "parse_failed";
                }
              } else {
                console.warn("[statute-completion] HTTP", res.status);
                statuteCompletionTelemetry.status = "request_failed";
              }
            } catch (err) {
              clearTimeout(timeoutId);
              const isAbort = err instanceof DOMException && err.name === "AbortError";
              statuteCompletionTelemetry.status = isAbort ? "timeout" : "request_failed";
              console.warn("[statute-completion] fetch failed:", err);
            }

            // 5. Validate + insert
            const drops: Record<string, number> = {};
            let nextCardId = sourceCards.reduce((mx, c) => Math.max(mx, c.id), 0) + 1;
            let nextFnNum = finalFootnotes.reduce((mx, f) => Math.max(mx, f.number), 0) + 1;

            for (let i = 0; i < raw.length; i++) {
              const c = raw[i];
              const v = validatePerplexityCandidate(c);
              if (!v.ok) {
                drops[v.reason] = (drops[v.reason] || 0) + 1;
                continue;
              }
              // Pair to a target by index, with name-overlap fallback
              let target = targets[i];
              if (!target && v.candidate.title) {
                target = targets.find((t) => {
                  const key = t.name.replace(/^חוק[- ]יסוד\s*:?\s*/, "").trim();
                  return key.length >= 6 && (v.candidate.title?.includes(key) ?? false);
                });
              }
              const matchedName = target?.name || "";
              const matchedIndex = target?.index ?? -1;

              const newCard: SourceCard = {
                id: nextCardId++,
                citation: v.candidate.citation,
                source_type: "israeli_law",
                url: v.candidate.url,
                provenance: "perplexity_completion",
                excerpt: "",
                completion_candidate_type: "statute",
              };
              sourceCards.push(newCard);

              const newFnNumber = nextFnNum++;
              finalFootnotes.push({
                number: newFnNumber,
                citation: v.candidate.citation,
                source_type: "israeli_law",
                url: v.candidate.url,
                source: "perplexity_completion",
              });

              // Insert [N] marker after first naked mention
              if (matchedName) {
                const idx = matchedIndex >= 0 && answer.slice(matchedIndex, matchedIndex + matchedName.length) === matchedName
                  ? matchedIndex
                  : answer.indexOf(matchedName);
                if (idx >= 0) {
                  const insertAt = idx + matchedName.length;
                  answer = `${answer.slice(0, insertAt)}[${newFnNumber}]${answer.slice(insertAt)}`;
                }
              }

              statuteCompletionTelemetry.completed_count++;
              console.log(`[statute-completion] added FN#${newFnNumber} for "${matchedName}" → ${v.candidate.citation.slice(0, 80)}`);
            }

            if (Object.keys(drops).length > 0) statuteCompletionTelemetry.drops = drops;
            if (!statuteCompletionTelemetry.status) statuteCompletionTelemetry.status = "ok";
          }
        }
        statuteCompletionTelemetry.duration_ms = Date.now() - tSC;
      } catch (err) {
        console.warn("[statute-completion] stage threw:", err);
        statuteCompletionTelemetry.status = "exception";
        statuteCompletionTelemetry.duration_ms = Date.now() - tSC;
      }
    }

    // ===== Post-response grounding sanity check (log-only, non-blocking) =====
    // Detect substantive statutory claims (סעיף X ל-Y ... קובע/מורה/מגדיר/אוסר/מחייב/מתיר)
    // and verify the section number + law name hint appear in at least one local chunk.
    try {
      const localCorpus = rankedMatches.map((m) => m.chunk_content || "").join("\n");
      const claimRe = /סעיף\s+([\dא-ת()'״"׳./\\–-]+)\s+ל([^\s,.;:()\[\]{}"״']{2,40})\s+[^.]{0,80}?(קובע|מורה|מגדיר|אוסר|מחייב|מתיר)/g;
      const violations: string[] = [];
      let cm: RegExpExecArray | null;
      while ((cm = claimRe.exec(answer)) !== null) {
        const sectionNum = cm[1];
        const lawHint = cm[2];
        const escSec = sectionNum.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const sectionInLocal = new RegExp(`סעיף\\s+${escSec}\\b`).test(localCorpus);
        const lawInLocal = localCorpus.includes(lawHint);
        if (!sectionInLocal || !lawInLocal) {
          violations.push(`סעיף ${sectionNum} ל${lawHint} (section=${sectionInLocal}, law=${lawInLocal})`);
        }
      }
      if (violations.length > 0) {
        console.warn(
          `[content-grounding-violation] ${violations.length} ungrounded statutory claim(s):`,
          violations.slice(0, 5)
        );
      }
    } catch (gErr) {
      console.error("Grounding check failed (non-fatal):", gErr);
    }

    // Log — canonical server-side log with internal diagnostics in metadata.
    try {
      const localCount = finalFootnotes.filter((f) => f.source === "local").length;
      const perplexityCount = finalFootnotes.filter((f) => f.source === "perplexity").length;

      // Build internal metadata snapshot (admin-only, never exposed to UI).
      let metadata: Record<string, unknown> | null = null;
      if (enableDeepPipeline) {
        const byStrength = { strong: 0, partial: 0, weak: 0 } as Record<string, number>;
        if (claimMap) {
          for (const c of claimMap) {
            if (c.allowed_to_state && c.support_strength in byStrength) {
              byStrength[c.support_strength]++;
            }
          }
        }
        const sourcePackV2Summary = sourcePackV2 ? summarizeSourcePack(sourcePackV2) : null;
        const claimMapV2Summary = claimMapV2 ? summarizeClaimMapV2(claimMapV2) : null;
        const draftingPath: "structured" | "fallback" = draftingInput && useNewDrafter ? "structured" : "fallback";
        metadata = {
          decomposition: decomposedPlan?.decomposition ?? null,
          decomposition_v2: decompositionV2,
          query_plan_summary: (decomposedPlan?.query_plan ?? []).map((p) => ({
            sub_issue: p.sub_issue,
            has_legislation_q: Boolean(p.legislation_query),
            has_caselaw_q: Boolean(p.caselaw_query),
            has_literature_q: Boolean(p.literature_query),
            has_external_q: Boolean(p.external_query),
          })),
          source_pack_summary: sourcePackV2Summary ?? sourcePack.map((s) => ({
            source_id: s.source_id,
            authority_class: s.authority_class,
            anchor_present: s.anchor_present,
          })),
          // Milestone A.5: per-source-type counts for fast diagnosis of `core=0` regressions.
          // Pulls from the raw entries (full type fidelity) AND the assembled pack
          // (so we can also see how many were promoted into core via the A.5 gate).
          source_type_counts: countSourcesByType(
            sourcePack as InternalSourcePackEntry[],
            sourcePackV2,
          ),
          // Retrieval funnel: per-source-type counts at each pipeline checkpoint
          // + drop reasons. Instrumentation only — read with:
          //   select metadata->'retrieval_funnel' from qa_logs order by created_at desc limit 1;
          retrieval_funnel: retrievalFunnel,
          claim_map_summary: claimMapV2Summary
            ?? (claimMap ? { total: claimMap.length, allowed: claimMapAllowedCount, by_strength: byStrength } : null),
          drafting_path: draftingPath,
          draft_path: useNewDrafter ? "claim_map" : "fallback",   // legacy alias for back-compat
          // Milestone A: how many AI footnotes were dropped because they had
          // no catalog/fuzzy anchor. >0 means the drafter is fabricating
          // citations to satisfy a floor — read alongside total_footnotes.
          dropped_unanchored_count: droppedUnanchoredCount,
          dropped_unanchored_previews: droppedUnanchoredPreviews,
          // Citation engine resolver pass on chapter footnotes (academic only).
          chapter_engine: isAcademicChapter ? {
            resolved_count: chapterEngineResolvedCount,
            unresolved_count: chapterEngineUnresolvedCount,
            drop_reasons: chapterEngineDropReasons,
          } : null,
          // Honest models_used: only record a model as "used" if its stage
          // actually completed successfully. Otherwise expose null + the failure
          // status, so admins don't get the false impression that gpt-5-mini ran.
          stage_runs: stageRuns,
          models_used: (() => {
            const find = (s: string) => stageRuns.find((r) => r.stage === s);
            const decomp = find("decomposition");
            const claim = find("claim_map");
            const draft = find("drafting");
            const reduce = (r: StageRun | undefined) =>
              r && r.status === "success"
                ? { provider: r.provider, model: r.model, status: "success" as const, duration_ms: r.duration_ms }
                : r
                  ? { provider: r.provider, model: null, status: r.status, duration_ms: r.duration_ms, error: r.error_message ?? null }
                  : { provider: null, model: null, status: "not_run" as const };
            return {
              decomposition: reduce(decomp),
              claim_map: reduce(claim),
              drafting: reduce(draft),
              // Legacy aliases (kept for back-compat with existing dashboards/queries)
              planner: decomp?.status === "success" ? `${decomp.provider}/${decomp.model}` : `${plannerProviderLabel()} (failed:${decomp?.status ?? "not_run"})`,
              drafter: draft?.status === "success" ? draft.model : `${drafterModelUsed} (failed:${draft?.status ?? "not_run"})`,
            };
          })(),
          model_config: LEGAL_RESEARCH_MODELS,
          // Mode profile actually used for this run. Read with:
          //   select metadata->'profile_used' from qa_logs ...
          profile_used: { depth: researchDepth, ...modeProfile },
          ...(evalRunId ? { eval_run_id: evalRunId } : {}),
          ...(evalVariant ? { eval_variant: evalVariant } : {}),
          ...(evalForceLegacy ? { eval_force_legacy: true } : {}),
        };
      }

      // For research mode we pre-allocated an id and may have written
      // checkpoint rows. Use upsert so we end up with a single canonical row
      // containing the full payload + final metadata. For other task modes,
      // keep the original plain insert behavior.
      const finalRow = {
        user_id: user.id,
        question: question.substring(0, 500),
        answer,
        footnotes: finalFootnotes as unknown as Record<string, unknown>[],
        task_mode: taskMode,
        local_footnotes_count: localCount,
        perplexity_footnotes_count: perplexityCount,
        total_footnotes: finalFootnotes.length,
        ...(metadata ? { metadata } : {}),
      };
      const { data: insertedLog, error: insertErr } = enableDeepPipeline
        ? await adminClient
            .from("qa_logs")
            .upsert({ id: preallocatedQaLogId, ...finalRow }, { onConflict: "id" })
            .select("id")
            .maybeSingle()
        : await adminClient
            .from("qa_logs")
            .insert(finalRow)
            .select("id")
            .maybeSingle();

      if (insertErr) {
        console.error("Failed to insert qa_logs row (non-fatal):", insertErr);
      }

      // Shadow A/B logger — only when we actually used the structured path.
      // Runs in the background after the user response returns; never blocks.
      const qaLogId = insertedLog?.id as string | undefined;
      if (
        qaLogId &&
        taskMode === RESEARCH_MODE &&
        draftingInput &&
        useNewDrafter &&
        typeof systemPrompt === "string" &&
        typeof userMessage === "string"
      ) {
        const shadowPromise = runShadowAbComparison({
          question,
          legacySystemPrompt: buildLegacyShadowPrompt(systemPrompt),
          userMessage,
          maxTokens: aiMaxTokens,
          productionAnswer: answer,
          productionFootnoteCount: finalFootnotes.length,
          productionDrafterModel: drafterModelUsed,
          draftingInput,
          qaLogId,
          adminClient,
        });
        // Prefer EdgeRuntime.waitUntil so the response can return immediately
        // while the shadow drafter call continues in the background.
        // deno-lint-ignore no-explicit-any
        const er = (globalThis as any).EdgeRuntime;
        if (er && typeof er.waitUntil === "function") {
          er.waitUntil(shadowPromise);
        } else {
          // Fallback: detach the promise. Errors are already swallowed inside
          // runShadowAbComparison, so this is safe.
          shadowPromise.catch(() => {});
        }
      }
    } catch (logErr) {
      console.error("Failed to log QA stats (non-fatal):", logErr);
    }

    return buildResponse(answer, finalFootnotes, citations, {
      dropped_footnotes_count: droppedFootnotesCount,
    });
  } catch (e) {
    console.error("legal-qa error:", e);
    // Best-effort: persist a final "error" checkpoint so admins can see how
    // far the pipeline got before the error/disconnect. Wrapped in its own
    // try so a logging failure never masks the original error.
    try {
      if (
        __checkpointQaLogId &&
        __checkpointAdmin &&
        __checkpointUserId &&
        __checkpointTaskMode === RESEARCH_MODE
      ) {
        const errSnapshot = {
          checkpoint: "error",
          checkpoint_at: new Date().toISOString(),
          drafting_path: "error",
          stage_runs: __checkpointStageRuns,
          error_message: (e as Error)?.message ?? String(e),
        };
        const op = __checkpointInserted
          ? __checkpointAdmin
              .from("qa_logs")
              .update({ metadata: errSnapshot })
              .eq("id", __checkpointQaLogId)
          : __checkpointAdmin.from("qa_logs").insert({
              id: __checkpointQaLogId,
              user_id: __checkpointUserId,
              question: __checkpointQuestion.substring(0, 500),
              answer: null,
              footnotes: [],
              task_mode: __checkpointTaskMode,
              local_footnotes_count: 0,
              perplexity_footnotes_count: 0,
              total_footnotes: 0,
              metadata: errSnapshot,
            });
        const promise = (op as unknown as Promise<{ error: unknown }>).catch(() => {});
        // deno-lint-ignore no-explicit-any
        const er = (globalThis as any).EdgeRuntime;
        if (er && typeof er.waitUntil === "function") er.waitUntil(promise);
      }
    } catch (cpErr) {
      console.error("[checkpoint:error] flush failed (non-fatal):", cpErr);
    }
    let refunded = false;
    if (__creditsCharged && __creditRequestId && __userClientForRefund) {
      try {
        const { data: refundData } = await __userClientForRefund.rpc("refund_credits", {
          _request_id: __creditRequestId,
          _reason: "auto-refund: legal-qa runtime error",
        });
        refunded = Boolean((refundData as Record<string, unknown> | null)?.ok);
      } catch (rfErr) {
        console.error("refund_credits failed in catch (non-fatal):", rfErr);
      }
    }
    return new Response(
      JSON.stringify({ error: "שגיאה בעיבוד השאלה. נסו שוב.", refunded, refundReason: refunded ? "runtime-error" : undefined }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Peek at the body to decide whether to wrap in SSE. Only Deep mode opts in
  // (Fast finishes well within the default HTTP window). The body is consumed
  // here, so the SSE wrapper rebuilds a fresh Request for the inner handler.
  let parsedBody: Record<string, unknown> | null = null;
  try {
    const cloned = req.clone();
    parsedBody = await cloned.json();
  } catch {
    // Body unparsable / empty — let the inner handler return its own 4xx.
  }

  const wantsStream = Boolean(
    parsedBody &&
      parsedBody.stream === true &&
      parsedBody.depth === "deep",
  );

  if (wantsStream && parsedBody) {
    return runHandlerSSE(req, parsedBody, handleLegalQARequest);
  }

  return handleLegalQARequest(req);
});
