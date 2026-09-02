// local_primary_anchor_resolution_v1
//
// Local DB first. Official/web second. Metadata-only never.
//
// Nominated primary anchors (statutes, Basic Laws, regulations, judgments) are
// resolved against the local legal corpus *before* any official PDF/web
// acquisition is attempted. External acquisition is unchanged — it simply
// becomes the fallback for anchors the corpus cannot serve.
//
// Nothing here relaxes a gate:
//   - a local judgment body must pass the same strict identity validation as
//     an externally fetched one;
//   - a local statute body without a locatable section may support the general
//     statutory framework only, never an exact "סעיף N קובע" claim;
//   - bodies below the substantive floor are never usable anchors.

import { classifySourceIntegrity } from "./sourceIntegrity.ts";
import { buildSectionVariants, normalizeSectionMarker } from "./statuteSectionDetection.ts";

export const LOCAL_PRIMARY_ANCHOR_VERSION = "local_primary_anchor_resolution_v1";

export const LOCAL_ANCHOR_LIMITS = {
  /** Substantive floor for any local body to become a primary anchor. */
  MIN_BODY_CHARS: 400,
  /** A whole statute may be admitted as framework support only when short. */
  WHOLE_STATUTE_MAX_CHARS: 40_000,
  MAX_ROWS: 8,
  QUERY_TIMEOUT_MS: 6_000,
} as const;

export const LOCAL_STATUTE_SOURCE_TYPES = ["israeli_law"] as const;
export const LOCAL_JUDGMENT_SOURCE_TYPES = ["caselaw", "supreme_court_il"] as const;

/** Authority tiers that may carry a *primary* anchor. */
const PRIMARY_TIERS = new Set(["official_primary", "statute_mirror", "official_court"]);

/** Tiers a *local* judgment body may carry and still anchor a holding. */
const LOCAL_JUDGMENT_TIERS = new Set([
  "official_primary",
  "official_court",
  "court_mirror",
  "statute_mirror",
]);

export function isLocalJudgmentTierAcceptable(tier: string | null | undefined): boolean {
  return LOCAL_JUDGMENT_TIERS.has(String(tier ?? ""));
}

// deno-lint-ignore no-explicit-any
type Admin = any;

// ── Title normalization ────────────────────────────────────────────────────

const HEAD_VARIANTS = /חוק\s*[-־–]\s*יסוד|חוק\s+יסוד/g;

/**
 * Canonical form used for matching: one Basic-Law head spelling, no colon,
 * no quotes/geresh, single spaces.
 */
export function normalizeStatuteTitleForMatch(raw: string | null | undefined): string {
  let s = String(raw ?? "")
    // Strip niqqud/cantillation but keep U+05BE MAQAF — it is a hyphen.
    .replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, "")
    .replace(/["'`׳״]/g, "")
    .replace(/[־–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(HEAD_VARIANTS, "חוק-יסוד");
  s = s.replace(/חוק-יסוד\s*:\s*/g, "חוק-יסוד ");
  // Drop a nominated section prefix ("סעיף 8 לחוק-יסוד ...").
  s = s.replace(/^סעיף\s+[\dא-ת()]+\s+ל/, "");
  // Drop trailing year clause / gazette reference.
  s = s.replace(/,?\s*הת?ש[א-ת]{0,3}\s*[-–]\s*\d{4}.*$/, "");
  s = s.replace(/,\s*(ס"?ח|ק"?ת|נ"?ח)\b.*$/, "");
  return s.replace(/[,.;:]+$/, "").trim();
}

/** Spelling variants worth trying against the corpus. */
export function statuteTitleVariants(raw: string | null | undefined): string[] {
  const base = normalizeStatuteTitleForMatch(raw);
  if (!base) return [];
  const out = new Set<string>([base]);
  if (base.startsWith("חוק-יסוד")) {
    const rest = base.slice("חוק-יסוד".length).trim();
    out.add(`חוק יסוד ${rest}`.trim());
    out.add(`חוק־יסוד: ${rest}`.trim());
    out.add(`חוק-יסוד: ${rest}`.trim());
    out.add(rest);
  }
  return [...out].filter((s) => s.length >= 4);
}

const TITLE_STOP = new Set([
  "חוק", "חוקי", "יסוד", "פקודת", "פקודה", "תקנות", "צו", "סעיף", "של", "על",
  "את", "עם", "או", "נוסח", "חדש", "משולב", "כללי", "חלק", "לחוק",
]);

/** Distinctive tokens used for the title ilike chain and for scoring. */
export function statuteMatchTokens(raw: string | null | undefined): string[] {
  const base = normalizeStatuteTitleForMatch(raw);
  return base
    .replace(/[()[\]{}]/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !TITLE_STOP.has(t))
    .slice(0, 5);
}

/** 0..1 title-match strength between a nominated title and a DB row title. */
export function scoreLocalStatuteMatch(dbTitle: string, nominated: string): number {
  const a = normalizeStatuteTitleForMatch(dbTitle);
  const b = normalizeStatuteTitleForMatch(nominated);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const toks = statuteMatchTokens(b);
  if (toks.length === 0) return 0;
  const hits = toks.filter((t) => a.includes(t)).length;
  return hits / toks.length * 0.8;
}

const STRONG_MATCH = 0.75;

// ── Section location ───────────────────────────────────────────────────────

export interface LocalStatuteSectionLocation {
  doc_id: string | null;
  statute_title: string | null;
  requested_section: string | null;
  explicit_marker_found: boolean;
  textual_anchor_found: boolean;
  exact_section_text_matched: boolean;
  section_located: boolean;
  whole_statute_fallback_used: boolean;
  allowed_claim_scope: "exact_section" | "general_statutory_framework" | "none";
  limitation_note: string | null;
  /** Body slice handed to the pipeline (section window, or whole statute). */
  text: string;
}

export const SECTION_NOT_LOCATED_NOTE_HE =
  "לשון הסעיף המדויק לא אותרה בגוף החוק שבמאגר המקומי; ניתן להסתמך על החוק כמסגרת נורמטיבית כללית בלבד, ולא לייחס נוסח לסעיף מסוים.";

/**
 * Locate a requested section inside a local statute body.
 *
 * Order: explicit marker → textual/heading anchor → exact section-text match.
 * When none succeeds the whole statute may still support *framework* claims,
 * and the limitation note is passed to the drafter.
 */
export function locateStatuteSection(
  body: string,
  section: string | null,
  opts: { doc_id?: string | null; statute_title?: string | null; exact_title_match?: boolean } = {},
): LocalStatuteSectionLocation {
  const text = String(body ?? "");
  const base: LocalStatuteSectionLocation = {
    doc_id: opts.doc_id ?? null,
    statute_title: opts.statute_title ?? null,
    requested_section: section ? normalizeSectionMarker(section) : null,
    explicit_marker_found: false,
    textual_anchor_found: false,
    exact_section_text_matched: false,
    section_located: false,
    whole_statute_fallback_used: false,
    allowed_claim_scope: "none",
    limitation_note: null,
    text: "",
  };

  if (text.trim().length < LOCAL_ANCHOR_LIMITS.MIN_BODY_CHARS) {
    base.limitation_note = null;
    return base;
  }

  if (!section) {
    base.allowed_claim_scope = "general_statutory_framework";
    base.text = text.slice(0, LOCAL_ANCHOR_LIMITS.WHOLE_STATUTE_MAX_CHARS);
    return base;
  }

  const s = normalizeSectionMarker(section);
  const variants = buildSectionVariants(s);
  const explicit = new RegExp(`(^|\\n)\\s*${escapeRe(s)}\\s*\\.`, "m").test(text);
  // A bare digit ("8") is NOT an anchor — it matches any number in the body.
  // Only qualified forms ("סעיף 8", "§8") count as a textual anchor.
  const anchorHit = variants.find((v) => /סעיף|§/.test(v) && text.includes(v)) ?? null;
  base.explicit_marker_found = explicit;
  base.textual_anchor_found = !!anchorHit && !explicit;

  if (explicit || anchorHit) {
    base.section_located = true;
    base.exact_section_text_matched = true;
    base.allowed_claim_scope = "exact_section";
    const i = Math.max(0, text.indexOf(anchorHit ?? s) - 400);
    base.text = text.slice(i, i + 12_000);
    return base;
  }


  // Section-less ingest: the statute is still an admissible primary source for
  // framework claims when the title matched exactly and the body is short.
  if (opts.exact_title_match && text.length <= LOCAL_ANCHOR_LIMITS.WHOLE_STATUTE_MAX_CHARS) {
    base.whole_statute_fallback_used = true;
    base.allowed_claim_scope = "general_statutory_framework";
    base.limitation_note = SECTION_NOT_LOCATED_NOTE_HE;
    base.text = text;
  }
  return base;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Telemetry shapes ───────────────────────────────────────────────────────

export interface LocalStatuteAnchorResolution {
  nominated_target: string;
  normalized_title: string;
  requested_section: string | null;
  local_lookup_attempted: boolean;
  tables_or_rpcs_used: string[];
  local_matches: number;
  selected_doc_id: string | null;
  selected_title: string | null;
  source_type: string | null;
  authority_tier: string | null;
  body_chars: number;
  section_located: boolean;
  usable_primary_anchor: boolean;
  fallback_to_external: boolean;
  failure_reason: string | null;
}

export interface LocalJudgmentAnchorResolution {
  nominated_target: string;
  docket: string | null;
  local_lookup_attempted: boolean;
  tables_or_rpcs_used: string[];
  local_matches: number;
  selected_doc_id: string | null;
  selected_title: string | null;
  body_chars: number;
  identity_check_started: boolean;
  identity_passed: boolean | null;
  usable_primary_anchor: boolean;
  fallback_to_court_egress: boolean;
  failure_reason: string | null;
}

export interface PrimaryAnchorResolutionPath {
  target: string;
  local_attempted: boolean;
  local_status: string;
  external_attempted: boolean;
  external_status: string;
  final_status: string;
  selected_source: string | null;
  usable_primary_anchor: boolean;
}

export interface LocalDoc {
  id: string;
  title: string;
  citation: string | null;
  source_type: string;
  source_url: string | null;
  content: string;
  authority_tier: string;
}

// ── DB resolution ──────────────────────────────────────────────────────────

async function withDbTimeout<T>(p: PromiseLike<T>): Promise<T | null> {
  const timer = new Promise<null>((res) =>
    setTimeout(() => res(null), LOCAL_ANCHOR_LIMITS.QUERY_TIMEOUT_MS)
  );
  return (await Promise.race([p, timer])) as T | null;
}

function tierFor(row: { title: string; source_url: string | null; source_type: string }): string {
  const integ = classifySourceIntegrity({
    title: row.title,
    url: row.source_url,
    snippet: "",
    source_type: row.source_type,
    role: row.source_type === "israeli_law" ? "primary_statute" : "binding_case_law",
  });
  return String(integ.authority_tier ?? "unknown");
}

export interface LocalStatuteResolveResult {
  telemetry: LocalStatuteAnchorResolution;
  section: LocalStatuteSectionLocation | null;
  doc: LocalDoc | null;
  usable: boolean;
}

/**
 * Resolve a nominated statute / Basic Law / regulation from the local corpus.
 * Returns `usable: false` (and `fallback_to_external: true`) when the corpus
 * cannot serve the anchor — the caller then runs external acquisition.
 */
export async function resolveLocalStatuteAnchor(
  admin: Admin,
  input: { label: string; statute_title: string | null; section: string | null },
): Promise<LocalStatuteResolveResult> {
  const normalized_title = normalizeStatuteTitleForMatch(input.statute_title ?? input.label);
  const requested_section = input.section ? normalizeSectionMarker(input.section) : null;
  const tel: LocalStatuteAnchorResolution = {
    nominated_target: input.label,
    normalized_title,
    requested_section,
    local_lookup_attempted: false,
    tables_or_rpcs_used: [],
    local_matches: 0,
    selected_doc_id: null,
    selected_title: null,
    source_type: null,
    authority_tier: null,
    body_chars: 0,
    section_located: false,
    usable_primary_anchor: false,
    fallback_to_external: true,
    failure_reason: null,
  };

  const tokens = statuteMatchTokens(normalized_title);
  if (!normalized_title || tokens.length === 0) {
    tel.failure_reason = "no_normalizable_title";
    return { telemetry: tel, section: null, doc: null, usable: false };
  }

  tel.local_lookup_attempted = true;
  tel.tables_or_rpcs_used = ["legal_documents"];

  let rows: Array<Record<string, unknown>> = [];
  try {
    // deno-lint-ignore no-explicit-any
    let q: any = admin
      .from("legal_documents")
      .select("id,title,citation,source_type,source_url,content")
      .in("source_type", [...LOCAL_STATUTE_SOURCE_TYPES])
      .limit(LOCAL_ANCHOR_LIMITS.MAX_ROWS);
    for (const t of tokens.slice(0, 3)) q = q.ilike("title", `%${t}%`);
    const r = await withDbTimeout(q);
    if (!r) {
      tel.failure_reason = "local_lookup_timeout";
      return { telemetry: tel, section: null, doc: null, usable: false };
    }
    // deno-lint-ignore no-explicit-any
    const res = r as any;
    if (res.error) {
      tel.failure_reason = `local_lookup_error:${String(res.error.message ?? res.error).slice(0, 120)}`;
      return { telemetry: tel, section: null, doc: null, usable: false };
    }
    rows = (res.data ?? []) as Array<Record<string, unknown>>;
  } catch (e) {
    tel.failure_reason = `local_lookup_error:${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;
    return { telemetry: tel, section: null, doc: null, usable: false };
  }

  tel.local_matches = rows.length;
  if (rows.length === 0) {
    tel.failure_reason = "no_local_match";
    return { telemetry: tel, section: null, doc: null, usable: false };
  }

  const scored = rows
    .map((r) => ({
      row: r,
      score: scoreLocalStatuteMatch(String(r.title ?? ""), normalized_title),
      len: String(r.content ?? "").length,
    }))
    .sort((a, b) => b.score - a.score || b.len - a.len);
  const best = scored[0];
  if (!best || best.score < STRONG_MATCH) {
    tel.failure_reason = `weak_title_match:${best ? best.score.toFixed(2) : "0"}`;
    return { telemetry: tel, section: null, doc: null, usable: false };
  }

  const row = best.row;
  const doc: LocalDoc = {
    id: String(row.id),
    title: String(row.title ?? ""),
    citation: row.citation ? String(row.citation) : null,
    source_type: String(row.source_type ?? ""),
    source_url: row.source_url ? String(row.source_url) : null,
    content: String(row.content ?? ""),
    authority_tier: tierFor({
      title: String(row.title ?? ""),
      source_url: row.source_url ? String(row.source_url) : null,
      source_type: String(row.source_type ?? ""),
    }),
  };
  tel.selected_doc_id = doc.id;
  tel.selected_title = doc.title;
  tel.source_type = doc.source_type;
  tel.authority_tier = doc.authority_tier;
  tel.body_chars = doc.content.length;

  if (!PRIMARY_TIERS.has(doc.authority_tier)) {
    tel.failure_reason = `authority_tier_not_primary:${doc.authority_tier}`;
    return { telemetry: tel, section: null, doc, usable: false };
  }
  if (doc.content.trim().length < LOCAL_ANCHOR_LIMITS.MIN_BODY_CHARS) {
    tel.failure_reason = "local_body_below_substantive_floor";
    return { telemetry: tel, section: null, doc, usable: false };
  }

  const section = locateStatuteSection(doc.content, requested_section, {
    doc_id: doc.id,
    statute_title: doc.title,
    exact_title_match: best.score >= 0.9,
  });
  tel.section_located = section.section_located;

  const usable = section.allowed_claim_scope !== "none" && section.text.length >= LOCAL_ANCHOR_LIMITS.MIN_BODY_CHARS;
  tel.usable_primary_anchor = usable;
  tel.fallback_to_external = !usable;
  if (!usable) tel.failure_reason ??= "section_not_located_and_no_framework_fallback";
  return { telemetry: tel, section, doc, usable };
}

// ── Judgments ──────────────────────────────────────────────────────────────

/** `בג"ץ 848/95` → `848/95`; tolerant of quote/geresh spellings. */
export function normalizeDocketForLocal(raw: string | null | undefined): string | null {
  const m = String(raw ?? "").match(/(\d{1,6})\s*\/\s*(\d{2,4})/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export interface LocalJudgmentResolveResult {
  telemetry: LocalJudgmentAnchorResolution;
  docs: LocalDoc[];
}

/**
 * Fetch local caselaw rows for a nominated docket / case name. Identity is NOT
 * decided here — the caller runs the same strict validator used for external
 * bodies, so local judgments can never bypass identity validation.
 */
export async function resolveLocalJudgmentAnchor(
  admin: Admin,
  input: { label: string; docket_display: string | null },
): Promise<LocalJudgmentResolveResult> {
  const docket = normalizeDocketForLocal(input.docket_display ?? input.label);
  const tel: LocalJudgmentAnchorResolution = {
    nominated_target: input.label,
    docket,
    local_lookup_attempted: false,
    tables_or_rpcs_used: [],
    local_matches: 0,
    selected_doc_id: null,
    selected_title: null,
    body_chars: 0,
    identity_check_started: false,
    identity_passed: null,
    usable_primary_anchor: false,
    fallback_to_court_egress: true,
    failure_reason: null,
  };

  const nameTokens = String(input.label ?? "")
    .replace(/["'`׳״]/g, "")
    .split(/[^\p{L}]+/u)
    .filter((t) => t.length >= 3 && !/^(נגד|נ|בעניין|פסק|דין|בית|המשפט|העליון)$/.test(t))
    .slice(0, 3);

  if (!docket && nameTokens.length < 2) {
    tel.failure_reason = "no_docket_and_no_distinctive_name";
    return { telemetry: tel, docs: [] };
  }

  tel.local_lookup_attempted = true;
  tel.tables_or_rpcs_used = ["legal_documents"];

  let rows: Array<Record<string, unknown>> = [];
  try {
    // deno-lint-ignore no-explicit-any
    let q: any = admin
      .from("legal_documents")
      .select("id,title,citation,source_type,source_url,content,case_number")
      .in("source_type", [...LOCAL_JUDGMENT_SOURCE_TYPES])
      .limit(LOCAL_ANCHOR_LIMITS.MAX_ROWS);
    if (docket) {
      const pat = `%${docket}%`;
      q = q.or(`case_number.ilike.${pat},title.ilike.${pat},citation.ilike.${pat}`);
    } else {
      for (const t of nameTokens.slice(0, 2)) q = q.ilike("title", `%${t}%`);
    }
    const r = await withDbTimeout(q);
    if (!r) {
      tel.failure_reason = "local_lookup_timeout";
      return { telemetry: tel, docs: [] };
    }
    // deno-lint-ignore no-explicit-any
    const res = r as any;
    if (res.error) {
      tel.failure_reason = `local_lookup_error:${String(res.error.message ?? res.error).slice(0, 120)}`;
      return { telemetry: tel, docs: [] };
    }
    rows = (res.data ?? []) as Array<Record<string, unknown>>;
  } catch (e) {
    tel.failure_reason = `local_lookup_error:${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;
    return { telemetry: tel, docs: [] };
  }

  tel.local_matches = rows.length;
  const docs: LocalDoc[] = rows
    .map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      citation: r.citation ? String(r.citation) : null,
      source_type: String(r.source_type ?? ""),
      source_url: r.source_url ? String(r.source_url) : null,
      content: String(r.content ?? ""),
      authority_tier: tierFor({
        title: String(r.title ?? ""),
        source_url: r.source_url ? String(r.source_url) : null,
        source_type: String(r.source_type ?? ""),
      }),
    }))
    .filter((d) => d.content.trim().length >= LOCAL_ANCHOR_LIMITS.MIN_BODY_CHARS)
    .sort((a, b) => b.content.length - a.content.length);

  if (docs.length === 0) {
    tel.failure_reason = rows.length === 0 ? "no_local_match" : "local_bodies_below_substantive_floor";
    return { telemetry: tel, docs: [] };
  }
  return { telemetry: tel, docs };
}
