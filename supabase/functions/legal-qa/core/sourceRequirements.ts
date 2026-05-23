// Research Core v1 — Source Requirements Planner + (flagged) injector.
//
// Phase 1/2: regex + classifier-driven detection of mandatory source roles.
// Phase 3 (this file): when SR_INJECT_RETRIEVAL=1 the runCore orchestrator
// calls `injectMandatoryRoleCandidates(...)` to RUN targeted retrieval per
// role and append a tiny number of candidates to existing per-claim packs.
// Verifier remains the gate — no forced citations.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { TIER_A_DOMAIN_FILTER, citationTier } from "../approvedDomains.ts";
import type {
  CandidateSource,
  ClaimId,
  PlanV1,
  Support,
} from "./types.ts";
import type { ClaimRetrievalPack } from "./retrieval.ts";

export type SourceRoleKind =
  | "statute"
  | "regulation"
  | "caselaw"
  | "scholarship"
  | "factual_report";

export interface MandatorySourceRole {
  /** Stable id for telemetry, e.g. "extortion:s428a". */
  role_id: string;
  doctrine_id: string;
  kind: SourceRoleKind;
  /** Short Hebrew label shown in telemetry. */
  label: string;
  /**
   * Canonical Hebrew query fragments. Used both for candidate matching
   * (substring check) AND as queries for targeted retrieval injection.
   */
  canonical_queries: string[];
  /**
   * Soft hint: factual_report roles support background/enforcement claims
   * only, not black-letter rules. Verifier still decides per claim.
   */
  supports_only?: "factual" | "any";
}

interface DoctrineEntry {
  doctrine_id: string;
  trigger: RegExp;
  roles: MandatorySourceRole[];
}

// ─── Doctrine dictionary ──────────────────────────────────────────────────

const DOCTRINES: DoctrineEntry[] = [
  {
    doctrine_id: "protection_money_extortion",
    trigger: /(דמי\s*חסות|סחיטה\s*באיומים|סחיטה\s*בכוח|extortion|protection\s*money|חוק\s*העונשין.*42[78])/i,
    roles: [
      {
        role_id: "extortion:s427",
        doctrine_id: "protection_money_extortion",
        kind: "statute",
        label: "ס׳ 427 לחוק העונשין — סחיטה בכוח",
        canonical_queries: ["סעיף 427 לחוק העונשין", "ס׳ 427 לחוק העונשין", "427 לחוק העונשין", "סחיטה בכוח"],
      },
      {
        role_id: "extortion:s428",
        doctrine_id: "protection_money_extortion",
        kind: "statute",
        label: "ס׳ 428 לחוק העונשין — סחיטה באיומים",
        canonical_queries: ["סעיף 428 לחוק העונשין", "ס׳ 428 לחוק העונשין", "428 לחוק העונשין", "סחיטה באיומים"],
      },
      {
        role_id: "extortion:s428a",
        doctrine_id: "protection_money_extortion",
        kind: "statute",
        label: "ס׳ 428א לחוק העונשין — גביית דמי חסות",
        canonical_queries: ["סעיף 428א לחוק העונשין", "ס׳ 428א לחוק העונשין", "428א לחוק העונשין", "גביית דמי חסות"],
      },
      {
        role_id: "extortion:factual_gov_report",
        doctrine_id: "protection_money_extortion",
        kind: "factual_report",
        label: "מרכז המחקר והמידע / הכנסת — דמי חסות (רקע ואכיפה)",
        canonical_queries: [
          "מרכז המחקר והמידע דמי חסות",
          "הכנסת דמי חסות",
          "פרוטקשן מרכז המחקר והמידע",
          "גביית דמי חסות נתונים",
          "אכיפת דמי חסות",
        ],
        supports_only: "factual",
      },
    ],
  },
  {
    doctrine_id: "legislative_omission_duty_to_legislate",
    trigger: /(מחדל\s*חקיקתי(?:\s*חלקי)?|מחדל\s*חקיקה|(?:סעד\s*ה)?חובה\s*לחוקק|החובה\s*לחוקק|חסר\s*נורמטיבי|לקונה\s*חקיקתית|(?:אי|היעדר)[- ]?הסדרה|חקיקה\s*לוקה\s*בחסר|אי[- ]?חקיקה|legislative\s*omission|duty\s*to\s*legislate)/i,
    roles: [
      {
        role_id: "duty_legislate:bagatz_canon",
        doctrine_id: "legislative_omission_duty_to_legislate",
        kind: "caselaw",
        label: "פסיקת בג״ץ בעניין מחדלי חקיקה",
        canonical_queries: [
          "מחדל חקיקה",
          "החובה לחוקק",
          "סעד החובה לחוקק",
          "בג\"ץ רסלר",
        ],
      },
      {
        role_id: "duty_legislate:scholarship",
        doctrine_id: "legislative_omission_duty_to_legislate",
        kind: "scholarship",
        label: "ספרות אקדמית — סעד החובה לחוקק",
        canonical_queries: ["סעד החובה לחוקק", "מחדל חקיקתי", "אקטיביזם שיפוטי מחדל חקיקה"],
      },
    ],
  },
  {
    doctrine_id: "temporary_injunction",
    trigger: /(צו\s*מניעה\s*זמני|סעד\s*זמני|תקנה\s*95)/i,
    roles: [
      {
        role_id: "temp_inj:reg95",
        doctrine_id: "temporary_injunction",
        kind: "regulation",
        label: "תקנה 95 לתקנות סדר הדין האזרחי",
        canonical_queries: ["תקנה 95", "תקנות סדר הדין האזרחי"],
      },
      {
        role_id: "temp_inj:caselaw",
        doctrine_id: "temporary_injunction",
        kind: "caselaw",
        label: "פסיקה — מאזן הנוחות וסיכויי ההליך",
        canonical_queries: ["מאזן הנוחות", "סיכויי ההליך", "ראיות לכאורה", "נזק בלתי הפיך"],
      },
    ],
  },
  {
    doctrine_id: "stay_of_execution",
    trigger: /(עיכוב\s*ביצוע|stay\s*of\s*execution|תקנה\s*46[67])/i,
    roles: [
      {
        role_id: "stay:regulations",
        doctrine_id: "stay_of_execution",
        kind: "regulation",
        label: "תקנות סדר הדין האזרחי — עיכוב ביצוע",
        canonical_queries: ["תקנה 466", "תקנה 467", "עיכוב ביצוע"],
      },
      {
        role_id: "stay:caselaw",
        doctrine_id: "stay_of_execution",
        kind: "caselaw",
        label: "פסיקה — מבחני עיכוב ביצוע פסק דין כספי",
        canonical_queries: ["עיכוב ביצוע פסק דין", "סיכויי הערעור", "מאזן הנוחות", "השבת המצב לקדמותו"],
      },
    ],
  },
  {
    doctrine_id: "pre_contractual_good_faith",
    trigger: /(תום\s*לב\s*במשא\s*ומתן|סעיף\s*12\s*לחוק\s*החוזים|פיצויי\s*קיום|pre[- ]?contractual)/i,
    roles: [
      {
        role_id: "precontract:s12",
        doctrine_id: "pre_contractual_good_faith",
        kind: "statute",
        label: "ס׳ 12 לחוק החוזים (חלק כללי)",
        canonical_queries: ["סעיף 12 לחוק החוזים", "ס׳ 12 לחוק החוזים", "תום לב במשא ומתן"],
      },
      {
        role_id: "precontract:caselaw",
        doctrine_id: "pre_contractual_good_faith",
        kind: "caselaw",
        label: "פסיקה — פיצויי קיום בהפרת תום הלב",
        canonical_queries: ["פיצויי קיום", "קל בנין", "שיכון עובדים", "תום לב במשא ומתן"],
      },
    ],
  },
  {
    doctrine_id: "relative_voidness",
    trigger: /(בטלות\s*יחסית|relative\s*voidness|תוצאת\s*בטלות)/i,
    roles: [
      {
        role_id: "rel_void:caselaw",
        doctrine_id: "relative_voidness",
        kind: "caselaw",
        label: "פסיקה — בטלות יחסית במשפט המנהלי",
        canonical_queries: ["בטלות יחסית", "בג\"ץ בטלות יחסית", "תוצאת הבטלות"],
      },
      {
        role_id: "rel_void:scholarship",
        doctrine_id: "relative_voidness",
        kind: "scholarship",
        label: "ספרות — בטלות יחסית (זמיר)",
        canonical_queries: ["בטלות יחסית זמיר", "הסמכות המנהלית"],
      },
    ],
  },
  {
    doctrine_id: "contract_interpretation",
    trigger: /(פרשנות\s*חוזה|אומד\s*דעת\s*הצדדים|סעיף\s*25\s*לחוק\s*החוזים|אפרופים)/i,
    roles: [
      {
        role_id: "contract_interp:s25",
        doctrine_id: "contract_interpretation",
        kind: "statute",
        label: "ס׳ 25 לחוק החוזים (חלק כללי)",
        canonical_queries: ["סעיף 25 לחוק החוזים", "ס׳ 25 לחוק החוזים", "אומד דעת הצדדים"],
      },
      {
        role_id: "contract_interp:caselaw",
        doctrine_id: "contract_interpretation",
        kind: "caselaw",
        label: "פסיקה — הלכת אפרופים / מגדלי הירקות",
        canonical_queries: ["אפרופים", "מגדלי הירקות", "פרשנות חוזה"],
      },
    ],
  },
];

// ─── API ──────────────────────────────────────────────────────────────────

export interface ClaimRoleAssignment {
  claim_id: ClaimId;
  matched_doctrines: string[];
  role_ids: string[];
}

export interface SourceRequirementsPlan {
  triggered_doctrines: string[];
  mandatory_roles: MandatorySourceRole[];
  per_claim: ClaimRoleAssignment[];
}

export interface BuildSourceRequirementsArgs {
  question: string;
  plan: PlanV1;
  forcedDoctrineIds?: string[];
}

export function buildSourceRequirements(
  args: BuildSourceRequirementsArgs,
): SourceRequirementsPlan {
  const { question, plan, forcedDoctrineIds } = args;
  const globalHaystack = [
    question || "",
    plan.thesis || "",
    plan.doctrinal_frame || "",
  ].join(" \n ");

  const forcedSet = new Set<string>(forcedDoctrineIds || []);
  const triggered: DoctrineEntry[] = [];
  const triggeredIds = new Set<string>();
  for (const d of DOCTRINES) {
    if (d.trigger.test(globalHaystack) || forcedSet.has(d.doctrine_id)) {
      triggered.push(d);
      triggeredIds.add(d.doctrine_id);
    }
  }

  const per_claim: ClaimRoleAssignment[] = plan.claims.map((c) => {
    const matched = new Set<string>();
    const claimText = c.text || "";
    for (const d of triggered) {
      if (d.trigger.test(claimText)) {
        matched.add(d.doctrine_id);
        continue;
      }
      for (const role of d.roles) {
        if (role.canonical_queries.some((q) => claimText.includes(q))) {
          matched.add(d.doctrine_id);
          break;
        }
      }
    }
    if (matched.size === 0 && triggered.length > 0) {
      for (const d of triggered) matched.add(d.doctrine_id);
    }
    const roleIds: string[] = [];
    for (const d of triggered) {
      if (!matched.has(d.doctrine_id)) continue;
      for (const r of d.roles) roleIds.push(r.role_id);
    }
    return {
      claim_id: c.id,
      matched_doctrines: [...matched],
      role_ids: roleIds,
    };
  });

  const mandatory_roles: MandatorySourceRole[] = [];
  for (const d of triggered) for (const r of d.roles) mandatory_roles.push(r);

  return {
    triggered_doctrines: [...triggeredIds],
    mandatory_roles,
    per_claim,
  };
}

// ─── Targeted Retrieval Injection (behavioral, flag-gated) ────────────────

const ROLE_LOCAL_TEXT_K = 4;
const ROLE_LOCAL_VECTOR_K = 4;
const ROLE_EXACT_K = 3;
const ROLE_WEB_K = 2;
const ROLE_MAX_INJECTED = 2;            // hard cap of injected candidates per role
const PER_CLAIM_SR_CAP = 2;             // unprotected SR overflow per claim
const PER_CLAIM_SR_PROTECTED_CAP = 4;   // protected SR slots per claim
const VECTOR_THRESHOLD = 0.55;

export type RoleMissingReason =
  | "no_hits"
  | "capped"
  | "filtered"
  | "exact_failed"
  | "web_failed"
  | "other";

export type ProtectionSkipReason =
  | "no_hits"
  | "duplicate"
  | "malformed"
  | "cap_exceeded"
  | "disabled"
  | "other";

export interface RoleInjectionRecord {
  role_id: string;
  doctrine_id: string;
  kind: SourceRoleKind;
  label: string;
  canonical_queries: string[];
  tried_local: boolean;
  tried_vector: boolean;
  tried_exact_authority: boolean;
  tried_web: boolean;
  local_hit_count: number;
  vector_hit_count: number;
  exact_hit_count: number;
  web_hit_count: number;
  injected_candidate_ids: string[];
  assigned_claim_ids: string[];

  // ── Phase 3.1 protected-slot telemetry ──
  protected_candidate_id?: string;
  protected_slot_used?: boolean;
  capped_before_protection?: boolean;
  reached_verifier_after_protection?: boolean;
  duplicate_of_candidate_id?: string;
  protection_skip_reason?: ProtectionSkipReason;

  /** Filled by post-verifier reconciliation. */
  reached_verifier?: boolean;
  /** Filled by post-verifier reconciliation. */
  verifier_verdicts?: Array<{ candidate_id: string; support: Support }>;
  /** True if role produced no candidate that made it into a pack. */
  missing_before_verifier?: boolean;
  missing_reason?: RoleMissingReason;
  errors: string[];
}

export interface ClaimSRSummary {
  claim_id: string;
  sr_protected_count: number;
  sr_protected_roles: string[];
  sr_candidates_reached_verifier_count: number;
  normal_candidates_displaced_count: number;
}

export interface InjectMandatoryArgs {
  adminClient: SupabaseClient;
  requirements: SourceRequirementsPlan;
  packs: ClaimRetrievalPack[];
  plan: PlanV1;
  embed?: (text: string) => Promise<number[] | null>;
  perplexityKey?: string;
  signal?: AbortSignal;
  /** Phase 3.1 protected-slot flag. Defaults to true when injection runs. */
  protectCandidates?: boolean;
}

export interface InjectMandatoryResult {
  records: RoleInjectionRecord[];
  /** packs is mutated in place; returned for convenience. */
  packs: ClaimRetrievalPack[];
  per_claim: ClaimSRSummary[];
  totals: {
    roles: number;
    roles_with_injection: number;
    candidates_injected: number;
    roles_protected: number;
    protected_candidates: number;
    protected_duplicates: number;
  };
}

// Small helpers — duplicated locally to avoid editing retrieval.ts.
function pickLongest(qs: string[]): string {
  return [...qs].sort((a, b) => b.length - a.length)[0] || "";
}

function escIlike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
}

interface ChunkHit {
  chunk_id?: string;
  document_id: string;
  chunk_content?: string;
  document_title?: string;
  document_citation?: string;
  source_type?: string;
  source_url?: string;
  similarity?: number;
}

function chunkToCandidate(
  h: ChunkHit,
  origin: "local_text" | "local_vector",
  role: MandatorySourceRole,
  query: string,
  idx: number,
): CandidateSource | null {
  if (!h?.document_id) return null;
  const title = (h.document_title || "").trim();
  const citation = (h.document_citation || "").trim();
  if (!title && !citation) return null;
  return {
    candidate_id: `SR-${role.role_id}-${origin}-${idx}`,
    claim_id: "C0" as ClaimId, // re-tagged on assignment
    origin,
    document_id: h.document_id,
    source_type: h.source_type || "",
    title,
    citation,
    url: h.source_url || undefined,
    snippet: (h.chunk_content || "").slice(0, 600),
    metadata: {
      chunk_id: h.chunk_id,
      similarity: h.similarity ?? null,
      source_requirement_role: role.role_id,
      source_requirement_query: query,
      source_requirement_doctrine: role.doctrine_id,
      sr_injected: true,
    },
  };
}

async function roleLocalText(
  client: SupabaseClient,
  role: MandatorySourceRole,
): Promise<{ hits: CandidateSource[]; tried: boolean; error?: string }> {
  const q = pickLongest(role.canonical_queries);
  if (!q) return { hits: [], tried: false };
  try {
    const { data, error } = await client.rpc("search_legal_chunks_text", {
      search_query: q,
      match_count: ROLE_LOCAL_TEXT_K,
    });
    if (error) return { hits: [], tried: true, error: error.message };
    const rows = Array.isArray(data) ? (data as ChunkHit[]) : [];
    const cands = rows
      .map((r, i) => chunkToCandidate(r, "local_text", role, q, i))
      .filter((c): c is CandidateSource => !!c);
    return { hits: cands, tried: true };
  } catch (e) {
    return { hits: [], tried: true, error: (e as Error).message };
  }
}

async function roleLocalVector(
  client: SupabaseClient,
  role: MandatorySourceRole,
  embed: (t: string) => Promise<number[] | null>,
): Promise<{ hits: CandidateSource[]; tried: boolean; error?: string }> {
  const q = role.canonical_queries.join(" • ").slice(0, 200);
  if (!q) return { hits: [], tried: false };
  try {
    const emb = await embed(q);
    if (!emb) return { hits: [], tried: true, error: "no_embedding" };
    const { data, error } = await client.rpc("match_legal_chunks", {
      query_embedding: JSON.stringify(emb),
      match_threshold: VECTOR_THRESHOLD,
      match_count: ROLE_LOCAL_VECTOR_K,
    });
    if (error) return { hits: [], tried: true, error: error.message };
    const rows = Array.isArray(data) ? (data as ChunkHit[]) : [];
    const cands = rows
      .map((r, i) => chunkToCandidate(r, "local_vector", role, q, i))
      .filter((c): c is CandidateSource => !!c);
    return { hits: cands, tried: true };
  } catch (e) {
    return { hits: [], tried: true, error: (e as Error).message };
  }
}

async function roleExactAuthority(
  client: SupabaseClient,
  role: MandatorySourceRole,
): Promise<{ hits: CandidateSource[]; tried: boolean; error?: string }> {
  // Phase 3.2 Fix B: allow factual_report roles to use exact_authority too
  // (scoped to their own source_type whitelist below).
  if (role.kind !== "statute" && role.kind !== "regulation" && role.kind !== "factual_report") {
    return { hits: [], tried: false };
  }
  // Phase 3.2 Fix A: respect role kind — never let e.g. a statute role
  // swallow a knesset_research / scholarship document via title ilike.
  const allowedTypes = (ROLE_KIND_TO_SOURCE_TYPES[role.kind] || []).map((t) => t.toLowerCase());
  const out: CandidateSource[] = [];
  const seen = new Set<string>();
  let idx = 0;
  try {
    for (const q of role.canonical_queries) {
      if (out.length >= ROLE_EXACT_K) break;
      const pat = `%${escIlike(q)}%`;
      for (const col of ["title", "citation"] as const) {
        const { data, error } = await client
          .from("legal_documents")
          .select("id, title, citation, source_type, source_url, content")
          .ilike(col, pat)
          .limit(ROLE_EXACT_K);
        if (error) continue;
        for (const row of (data || []) as Array<Record<string, unknown>>) {
          const id = String(row.id);
          if (seen.has(id)) continue;
          const st = String(row.source_type || "").toLowerCase();
          // Kind-scoped admission: row source_type must match the role's whitelist.
          if (allowedTypes.length > 0 && !allowedTypes.some((k) => st.includes(k))) {
            continue;
          }
          seen.add(id);
          out.push({
            candidate_id: `SR-${role.role_id}-exact-${++idx}`,
            claim_id: "C0" as ClaimId,
            origin: "exact_authority",
            document_id: id,
            source_type: (row.source_type as string) || "",
            title: (row.title as string) || "",
            citation: (row.citation as string) || "",
            url: (row.source_url as string) || undefined,
            snippet: ((row.content as string) || "").slice(0, 600),
            metadata: {
              source_requirement_role: role.role_id,
              source_requirement_query: q,
              source_requirement_doctrine: role.doctrine_id,
              sr_injected: true,
              matched_by: col,
              kind_scoped: true,
            },
          });
          if (out.length >= ROLE_EXACT_K) break;
        }
        if (out.length >= ROLE_EXACT_K) break;
      }
    }
    return { hits: out, tried: true };
  } catch (e) {
    return { hits: out, tried: true, error: (e as Error).message };
  }
}

async function roleApprovedWeb(
  perplexityKey: string,
  role: MandatorySourceRole,
  signal?: AbortSignal,
): Promise<{ hits: CandidateSource[]; tried: boolean; error?: string }> {
  const queries = role.canonical_queries.slice(0, 4).join(" ; ");
  const sys = `אתה מחזיר אך ורק מקורות משפטיים/ממשלתיים ישראליים סמכותיים מתוך התחומים המאושרים. החזר JSON-array בלבד, עד ${ROLE_WEB_K} פריטים. כל איבר: {"title":"","citation":"","url":"","source_type":"","snippet":""}.`;
  const usr = `תפקיד מקור נדרש: ${role.label}\nשאילתות קנוניות: ${queries}\nהחזר עד ${ROLE_WEB_K} מקורות סמכותיים שמכסים את התפקיד.`;
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${perplexityKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr },
        ],
        temperature: 0.1,
        max_tokens: 700,
        search_domain_filter: TIER_A_DOMAIN_FILTER,
        return_citations: true,
        return_search_results: true,
      }),
    });
    if (!res.ok) {
      return { hits: [], tried: true, error: `http_${res.status}` };
    }
    const data: Record<string, unknown> = await res.json();
    type Hit = { url: string; title: string; citation: string; snippet: string; source_type: string };
    const byUrl = new Map<string, Hit>();

    // JSON-array in content
    try {
      const raw = (data?.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message?.content ?? "";
      const cleaned = String(raw).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
      const s = cleaned.indexOf("[");
      const e = cleaned.lastIndexOf("]");
      if (s >= 0 && e > s) {
        const parsed = JSON.parse(cleaned.slice(s, e + 1));
        if (Array.isArray(parsed)) {
          for (const h of parsed) {
            if (h?.url && typeof h.url === "string") {
              byUrl.set(h.url, {
                url: h.url,
                title: (h.title || "").trim(),
                citation: (h.citation || "").trim(),
                snippet: (h.snippet || "").slice(0, 600),
                source_type: h.source_type || "",
              });
            }
          }
        }
      }
    } catch (_e) { /* ignore */ }

    // search_results
    const sr = Array.isArray((data as { search_results?: unknown }).search_results)
      ? (data as { search_results: Array<{ title?: string; url?: string; snippet?: string }> }).search_results
      : [];
    for (const r of sr) {
      if (!r?.url || byUrl.has(r.url)) continue;
      byUrl.set(r.url, {
        url: r.url,
        title: (r.title || "").trim(),
        citation: "",
        snippet: (r.snippet || "").slice(0, 600),
        source_type: "",
      });
    }
    // citations
    const cits = Array.isArray((data as { citations?: unknown }).citations)
      ? ((data as { citations: unknown[] }).citations as unknown[]).filter((u) => typeof u === "string") as string[]
      : [];
    for (const url of cits) {
      if (!byUrl.has(url)) byUrl.set(url, { url, title: "", citation: "", snippet: "", source_type: "" });
    }

    const out: CandidateSource[] = [];
    let i = 0;
    for (const h of byUrl.values()) {
      if (citationTier(h.url) !== "A") continue;
      out.push({
        candidate_id: `SR-${role.role_id}-web-${++i}`,
        claim_id: "C0" as ClaimId,
        origin: "approved_web",
        source_type: h.source_type,
        title: h.title,
        citation: h.citation,
        url: h.url,
        snippet: h.snippet,
        metadata: {
          tier: "A",
          source_requirement_role: role.role_id,
          source_requirement_query: queries,
          source_requirement_doctrine: role.doctrine_id,
          sr_injected: true,
        },
      });
      if (out.length >= ROLE_WEB_K) break;
    }
    return { hits: out, tried: true };
  } catch (e) {
    return { hits: [], tried: true, error: (e as Error).message };
  }
}

// ─── Phase 3.1 helpers ────────────────────────────────────────────────────


function normUrl(u?: string): string {
  if (!u) return "";
  return u.trim().toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "");
}
function normText(s?: string): string {
  return (s || "").toLowerCase().replace(/[\s"'״׳`׳'"()[\]{}.,;:\-־]+/g, " ").trim();
}
function candidateDedupKeys(c: { document_id?: string; url?: string; title?: string; citation?: string }): string[] {
  const keys: string[] = [];
  if (c.document_id) keys.push(`doc:${c.document_id}`);
  const u = normUrl(c.url);
  if (u) keys.push(`url:${u}`);
  const t = normText(c.title || c.citation);
  if (t && t.length >= 6) keys.push(`title:${t}`);
  return keys;
}
function isMalformed(c: CandidateSource): boolean {
  const title = (c.title || "").trim();
  const citation = (c.citation || "").trim();
  if (!title && !citation) return true;
  return false;
}

const ROLE_KIND_TO_SOURCE_TYPES: Record<SourceRoleKind, string[]> = {
  statute: ["statute", "legislation", "law", "basic_law"],
  regulation: ["regulation", "regulations"],
  caselaw: ["case", "caselaw", "case_law", "case_law_database", "judgment", "published"],
  scholarship: ["scholarship", "article", "book", "journal"],
  factual_report: ["report", "knesset_research", "mmm", "government_report", "factual_report"],
};

function scoreCandidateForRole(c: CandidateSource, role: MandatorySourceRole): number {
  let s = 0;
  // (1) exact title/query phrase match
  const hay = `${c.title || ""} \n ${c.citation || ""} \n ${c.snippet || ""}`;
  const hayL = hay.toLowerCase();
  let bestPhrase = 0;
  for (const q of role.canonical_queries) {
    const ql = q.toLowerCase();
    if (!ql) continue;
    if ((c.title || "").toLowerCase().includes(ql)) bestPhrase = Math.max(bestPhrase, 100);
    else if ((c.citation || "").toLowerCase().includes(ql)) bestPhrase = Math.max(bestPhrase, 80);
    else if (hayL.includes(ql)) bestPhrase = Math.max(bestPhrase, 40);
  }
  s += bestPhrase;
  // (2) source_type fit
  const st = (c.source_type || "").toLowerCase();
  const fit = ROLE_KIND_TO_SOURCE_TYPES[role.kind] || [];
  if (st && fit.some((k) => st.includes(k))) s += 25;
  // (3) local DB over approved_web
  if (c.origin === "exact_authority") s += 20;
  else if (c.origin === "local_text") s += 15;
  else if (c.origin === "local_vector") s += 12;
  else if (c.origin === "approved_web") s += 5;
  // (4) similarity / rank tiebreak
  const sim = (c.metadata as Record<string, unknown> | undefined)?.similarity;
  if (typeof sim === "number") s += Math.max(0, Math.min(10, sim * 10));
  return s;
}

function pickBestForRole(pool: CandidateSource[], role: MandatorySourceRole): CandidateSource | null {
  if (pool.length === 0) return null;
  const ranked = [...pool]
    .map((c) => ({ c, s: scoreCandidateForRole(c, role) }))
    .sort((a, b) => b.s - a.s);
  return ranked[0]?.c ?? null;
}

/**
 * Run targeted retrieval for each mandatory role and append a tiny number
 * of candidates to existing per-claim packs. Caller decides whether to call
 * this (flag-gated). Mutates `packs` in place.
 *
 * Phase 3.1: when `protectCandidates` is true (default), reserve up to 1
 * protected slot per role on the assigned claim, bounded by
 * PER_CLAIM_SR_PROTECTED_CAP per claim. Protected candidates bypass the
 * PER_CLAIM_SR_CAP overflow budget. Verifier remains the gate.
 */
export async function injectMandatoryRoleCandidates(
  args: InjectMandatoryArgs,
): Promise<InjectMandatoryResult> {
  const { adminClient, requirements, packs, embed, perplexityKey, signal } = args;
  const protectCandidates = args.protectCandidates !== false;
  const records: RoleInjectionRecord[] = [];

  const perClaimProtected = new Map<string, number>();
  const perClaimOverflow = new Map<string, number>();
  const perClaimProtectedRoles = new Map<string, string[]>();
  for (const p of packs) {
    perClaimProtected.set(p.claim_id, 0);
    perClaimOverflow.set(p.claim_id, 0);
    perClaimProtectedRoles.set(p.claim_id, []);
  }
  const packByClaim = new Map<string, ClaimRetrievalPack>();
  for (const p of packs) packByClaim.set(p.claim_id, p);

  // Build existing dedup index per claim: key → candidate_id of existing.
  const dedupByClaim = new Map<string, Map<string, string>>();
  for (const p of packs) {
    const m = new Map<string, string>();
    for (const c of p.candidates) {
      for (const k of candidateDedupKeys(c)) {
        if (!m.has(k)) m.set(k, c.candidate_id);
      }
    }
    dedupByClaim.set(p.claim_id, m);
  }

  let totalInjected = 0;
  let rolesWithInjection = 0;
  let rolesProtected = 0;
  let protectedCandidates = 0;
  let protectedDuplicates = 0;

  for (const role of requirements.mandatory_roles) {
    const rec: RoleInjectionRecord = {
      role_id: role.role_id,
      doctrine_id: role.doctrine_id,
      kind: role.kind,
      label: role.label,
      canonical_queries: role.canonical_queries,
      tried_local: false,
      tried_vector: false,
      tried_exact_authority: false,
      tried_web: false,
      local_hit_count: 0,
      vector_hit_count: 0,
      exact_hit_count: 0,
      web_hit_count: 0,
      injected_candidate_ids: [],
      assigned_claim_ids: [],
      errors: [],
      protected_slot_used: false,
      capped_before_protection: false,
    };

    const [localRes, vecRes, exactRes] = await Promise.all([
      roleLocalText(adminClient, role),
      embed ? roleLocalVector(adminClient, role, embed) : Promise.resolve({ hits: [] as CandidateSource[], tried: false }),
      roleExactAuthority(adminClient, role),
    ]);
    rec.tried_local = localRes.tried;
    if (localRes.error) rec.errors.push(`local:${localRes.error}`);
    rec.local_hit_count = localRes.hits.length;
    rec.tried_vector = vecRes.tried;
    if (vecRes.error) rec.errors.push(`vector:${vecRes.error}`);
    rec.vector_hit_count = vecRes.hits.length;
    rec.tried_exact_authority = exactRes.tried;
    if (exactRes.error) rec.errors.push(`exact:${exactRes.error}`);
    rec.exact_hit_count = exactRes.hits.length;

    const localTotal = rec.local_hit_count + rec.vector_hit_count + rec.exact_hit_count;
    let webRes: { hits: CandidateSource[]; tried: boolean; error?: string } = { hits: [], tried: false };
    if (localTotal < 1 && perplexityKey) {
      webRes = await roleApprovedWeb(perplexityKey, role, signal);
      rec.tried_web = webRes.tried;
      if (webRes.error) rec.errors.push(`web:${webRes.error}`);
      rec.web_hit_count = webRes.hits.length;
    }

    // Pool (all sources) — used for both phases.
    const pool: CandidateSource[] = [
      ...exactRes.hits,
      ...localRes.hits,
      ...vecRes.hits,
      ...webRes.hits,
    ].filter((c) => !isMalformed(c));

    // Determine assignable claims (intersected with packs).
    const assignClaimOrder = requirements.per_claim
      .filter((a) => a.role_ids.includes(role.role_id))
      .map((a) => a.claim_id as string)
      .filter((cid) => packByClaim.has(cid));
    const fallbackClaims = packs.map((p) => p.claim_id as string);
    const targetClaims = assignClaimOrder.length > 0 ? assignClaimOrder : fallbackClaims;

    // ─── Phase A: protected slot (best candidate) ───
    let protectedAssignedClaim: string | null = null;
    let injectedForRole = 0;
    if (pool.length === 0) {
      rec.protection_skip_reason = "no_hits";
    } else if (!protectCandidates) {
      rec.protection_skip_reason = "disabled";
    } else {
      const best = pickBestForRole(pool, role);
      if (!best) {
        rec.protection_skip_reason = "no_hits";
      } else {
        const keys = candidateDedupKeys(best);
        // Try each target claim in order; if a duplicate exists, mark covered.
        let duplicateOf: { cid: string; existing: string } | null = null;
        let placed = false;
        for (const cid of targetClaims) {
          const dedup = dedupByClaim.get(cid)!;
          const hitKey = keys.find((k) => dedup.has(k));
          if (hitKey) {
            duplicateOf = { cid, existing: dedup.get(hitKey)! };
            continue; // try next claim before giving up
          }
          const usedProt = perClaimProtected.get(cid) || 0;
          if (usedProt >= PER_CLAIM_SR_PROTECTED_CAP) {
            // counts as displacing pressure on this claim, but try others.
            continue;
          }
          // Place protected.
          const pack = packByClaim.get(cid)!;
          const reTagged: CandidateSource = {
            ...best,
            candidate_id: `${cid}-${best.candidate_id}-prot`,
            claim_id: cid as ClaimId,
            metadata: {
              ...(best.metadata || {}),
              sr_protected: true,
            },
          };
          pack.candidates.push(reTagged);
          if (reTagged.origin === "local_text") pack.local_text_count++;
          else if (reTagged.origin === "local_vector") pack.local_vector_count++;
          else if (reTagged.origin === "exact_authority") pack.exact_authority_count++;
          else if (reTagged.origin === "approved_web") pack.approved_web_count++;

          perClaimProtected.set(cid, usedProt + 1);
          perClaimProtectedRoles.get(cid)!.push(role.role_id);
          for (const k of candidateDedupKeys(reTagged)) {
            if (!dedup.has(k)) dedup.set(k, reTagged.candidate_id);
          }
          rec.protected_candidate_id = reTagged.candidate_id;
          rec.protected_slot_used = true;
          rec.reached_verifier_after_protection = true;
          rec.injected_candidate_ids.push(reTagged.candidate_id);
          if (!rec.assigned_claim_ids.includes(cid)) rec.assigned_claim_ids.push(cid);
          protectedAssignedClaim = cid;
          injectedForRole++;
          totalInjected++;
          rolesProtected++;
          protectedCandidates++;
          placed = true;
          break;
        }
        if (!placed) {
          if (duplicateOf) {
            // Existing pack candidate already covered this role.
            rec.duplicate_of_candidate_id = duplicateOf.existing;
            rec.protection_skip_reason = "duplicate";
            rec.reached_verifier_after_protection = true;
            rec.assigned_claim_ids.push(duplicateOf.cid);
            protectedDuplicates++;
          } else {
            rec.protection_skip_reason = "cap_exceeded";
            rec.capped_before_protection = true;
          }
        }
      }
    }

    // ─── Phase B: overflow up to ROLE_MAX_INJECTED (unprotected SR cap) ───
    for (const cand of pool) {
      if (injectedForRole >= ROLE_MAX_INJECTED) break;
      const keys = candidateDedupKeys(cand);
      // Skip the one we already placed as protected (by identity).
      if (rec.protected_candidate_id && keys.some((k) => {
        // best candidate's keys are now present in some pack's dedup — but we
        // explicitly skip the same object instance via candidate_id pattern.
        return false;
      })) {
        // no-op; identity check below
      }
      let assigned: string | null = null;
      let isDup = false;
      for (const cid of targetClaims) {
        const dedup = dedupByClaim.get(cid)!;
        if (keys.some((k) => dedup.has(k))) { isDup = true; continue; }
        const usedOver = perClaimOverflow.get(cid) || 0;
        if (usedOver >= PER_CLAIM_SR_CAP) continue;
        assigned = cid;
        break;
      }
      if (!assigned) {
        if (isDup) continue;
        if (!rec.missing_reason && rec.injected_candidate_ids.length === 0) {
          rec.missing_reason = "capped";
        }
        continue;
      }
      const pack = packByClaim.get(assigned)!;
      const reTagged: CandidateSource = {
        ...cand,
        candidate_id: `${assigned}-${cand.candidate_id}`,
        claim_id: assigned as ClaimId,
      };
      pack.candidates.push(reTagged);
      if (reTagged.origin === "local_text") pack.local_text_count++;
      else if (reTagged.origin === "local_vector") pack.local_vector_count++;
      else if (reTagged.origin === "exact_authority") pack.exact_authority_count++;
      else if (reTagged.origin === "approved_web") pack.approved_web_count++;
      perClaimOverflow.set(assigned, (perClaimOverflow.get(assigned) || 0) + 1);
      for (const k of candidateDedupKeys(reTagged)) {
        const m = dedupByClaim.get(assigned)!;
        if (!m.has(k)) m.set(k, reTagged.candidate_id);
      }
      rec.injected_candidate_ids.push(reTagged.candidate_id);
      if (!rec.assigned_claim_ids.includes(assigned)) rec.assigned_claim_ids.push(assigned);
      injectedForRole++;
      totalInjected++;
    }

    if (injectedForRole > 0) rolesWithInjection++;

    if (rec.injected_candidate_ids.length === 0 && !rec.duplicate_of_candidate_id) {
      rec.missing_before_verifier = true;
      if (!rec.missing_reason) {
        if (!rec.tried_local && !rec.tried_vector && !rec.tried_exact_authority && !rec.tried_web) {
          rec.missing_reason = "other";
        } else if (rec.local_hit_count + rec.vector_hit_count + rec.exact_hit_count + rec.web_hit_count === 0) {
          rec.missing_reason = rec.tried_web && webRes.error ? "web_failed"
            : rec.tried_exact_authority && exactRes.error ? "exact_failed"
            : "no_hits";
        } else {
          rec.missing_reason = "filtered";
        }
      }
    } else {
      rec.missing_before_verifier = false;
    }

    // For protection telemetry consistency when a duplicate satisfied us.
    if (!rec.protected_slot_used && rec.duplicate_of_candidate_id) {
      // already set protection_skip_reason="duplicate"
    }
    if (protectedAssignedClaim) {
      // noop — claim already recorded
    }

    records.push(rec);
  }

  // Build per-claim SR summary (verifier-reach count filled post-verify).
  const per_claim: ClaimSRSummary[] = packs.map((p) => ({
    claim_id: p.claim_id as string,
    sr_protected_count: perClaimProtected.get(p.claim_id) || 0,
    sr_protected_roles: perClaimProtectedRoles.get(p.claim_id) || [],
    sr_candidates_reached_verifier_count: 0, // filled by reconciliation
    normal_candidates_displaced_count: 0,    // append-only injection, no displacement
  }));

  return {
    records,
    packs,
    per_claim,
    totals: {
      roles: requirements.mandatory_roles.length,
      roles_with_injection: rolesWithInjection,
      candidates_injected: totalInjected,
      roles_protected: rolesProtected,
      protected_candidates: protectedCandidates,
      protected_duplicates: protectedDuplicates,
    },
  };
}

// ─── Reconciliation (richer) ──────────────────────────────────────────────

export interface RoleRecallStatus {
  role_id: string;
  doctrine_id: string;
  kind: SourceRoleKind;
  label: string;
  canonical_queries: string[];

  // Targeted-retrieval attempts (only meaningful when injection ran).
  tried_local: boolean;
  tried_vector: boolean;
  tried_exact_authority: boolean;
  tried_web: boolean;
  local_hit_count: number;
  vector_hit_count: number;
  exact_hit_count: number;
  web_hit_count: number;
  injected_candidate_ids: string[];

  // Substring match against final pack candidates (covers both organic
  // retrieval hits and SR-injected hits).
  matched_candidate_ids: string[];
  matched_origins: string[];

  reached_verifier: boolean;
  missing_before_verifier: boolean;
  missing_reason?: RoleMissingReason;

  // Verifier outcome for matched candidates (if verification provided).
  verifier_verdicts: Array<{ candidate_id: string; support: Support }>;
  verifier_kept_direct: number;
  verifier_kept_partial: number;
  verifier_rejected: number;

  errors: string[];
}

export interface SourceRequirementsReconciliation {
  per_role: RoleRecallStatus[];
  totals: {
    roles: number;
    roles_tried_local: number;
    roles_tried_web: number;
    roles_reached_verifier: number;
    roles_missing_entirely: number;
    roles_injected: number;
    candidates_injected: number;
    candidates_injected_kept: number;
  };
}

export interface VerifierVerdictLike {
  candidate_id: string;
  support: Support;
}

export interface ReconcileArgs {
  requirements: SourceRequirementsPlan;
  packs: ClaimRetrievalPack[];
  /** Per-role injection records from the injector, if it ran. */
  injectionRecords?: RoleInjectionRecord[];
  /** Per-claim SR summary built by the injector (will be enriched in place). */
  injectionPerClaim?: ClaimSRSummary[];
  /** All verifier verdicts flattened across claims, if verifier ran. */
  verdicts?: VerifierVerdictLike[];
}

function candidateMatchesRole(
  c: CandidateSource,
  role: MandatorySourceRole,
): boolean {
  // SR-injected candidates carry the role id explicitly.
  const meta = (c.metadata || {}) as Record<string, unknown>;
  if (meta.source_requirement_role === role.role_id) return true;
  const hay = [c.title || "", c.citation || "", c.snippet || ""]
    .join(" \n ")
    .toLowerCase();
  for (const q of role.canonical_queries) {
    if (hay.includes(q.toLowerCase())) return true;
  }
  return false;
}

export function reconcileSourceRequirements(
  args: ReconcileArgs,
): SourceRequirementsReconciliation {
  const { requirements, packs, injectionRecords, injectionPerClaim, verdicts } = args;
  const allCandidates: CandidateSource[] = [];
  for (const p of packs) for (const c of p.candidates) allCandidates.push(c);

  const verdictByCid = new Map<string, Support>();
  for (const v of verdicts || []) verdictByCid.set(v.candidate_id, v.support);
  const recById = new Map<string, RoleInjectionRecord>();
  for (const r of injectionRecords || []) recById.set(r.role_id, r);

  // Enrich per-role records with verifier-reach info (for protected slots).
  for (const r of injectionRecords || []) {
    if (r.protected_candidate_id) {
      const s = verdictByCid.get(r.protected_candidate_id);
      // reached_verifier_after_protection already true if pushed; refine to
      // "verifier actually emitted a verdict" when we have verdict data.
      if (verdicts && verdicts.length > 0) {
        r.reached_verifier_after_protection = s !== undefined;
      }
    }
  }

  // Enrich per-claim summary with verifier-reach counts.
  if (injectionPerClaim && verdicts) {
    const cidByClaim = new Map<string, string[]>();
    for (const r of injectionRecords || []) {
      for (const cid of r.injected_candidate_ids) {
        // claim id is the prefix up to first '-' in our re-tagged ids.
        const m = cid.match(/^(C\d+)-/);
        if (!m) continue;
        const claim = m[1];
        if (!cidByClaim.has(claim)) cidByClaim.set(claim, []);
        cidByClaim.get(claim)!.push(cid);
      }
    }
    for (const row of injectionPerClaim) {
      const ids = cidByClaim.get(row.claim_id) || [];
      row.sr_candidates_reached_verifier_count = ids.filter((cid) => verdictByCid.has(cid)).length;
    }
  }


  const per_role: RoleRecallStatus[] = requirements.mandatory_roles.map((role) => {
    const rec = recById.get(role.role_id);
    const matchedIds: string[] = [];
    const origins = new Set<string>();
    let organic_tried_local = false;
    let organic_tried_web = false;
    for (const c of allCandidates) {
      if (!candidateMatchesRole(c, role)) continue;
      matchedIds.push(c.candidate_id);
      origins.add(c.origin);
      if (c.origin === "approved_web") organic_tried_web = true;
      else organic_tried_local = true;
    }
    const verds: Array<{ candidate_id: string; support: Support }> = [];
    let kept_direct = 0, kept_partial = 0, rejected = 0;
    for (const cid of matchedIds) {
      const s = verdictByCid.get(cid);
      if (!s) continue;
      verds.push({ candidate_id: cid, support: s });
      if (s === "direct") kept_direct++;
      else if (s === "partial") kept_partial++;
      else rejected++;
    }

    const reached_verifier = matchedIds.length > 0;
    const missing_before_verifier = !reached_verifier;

    return {
      role_id: role.role_id,
      doctrine_id: role.doctrine_id,
      kind: role.kind,
      label: role.label,
      canonical_queries: role.canonical_queries,
      tried_local: rec ? rec.tried_local : organic_tried_local,
      tried_vector: rec ? rec.tried_vector : false,
      tried_exact_authority: rec ? rec.tried_exact_authority : false,
      tried_web: rec ? rec.tried_web : organic_tried_web,
      local_hit_count: rec?.local_hit_count ?? 0,
      vector_hit_count: rec?.vector_hit_count ?? 0,
      exact_hit_count: rec?.exact_hit_count ?? 0,
      web_hit_count: rec?.web_hit_count ?? 0,
      injected_candidate_ids: rec?.injected_candidate_ids ?? [],
      matched_candidate_ids: matchedIds.slice(0, 30),
      matched_origins: [...origins],
      reached_verifier,
      missing_before_verifier,
      missing_reason: rec?.missing_reason,
      verifier_verdicts: verds,
      verifier_kept_direct: kept_direct,
      verifier_kept_partial: kept_partial,
      verifier_rejected: rejected,
      errors: rec?.errors ?? [],
    };
  });

  const candidates_injected = (injectionRecords || []).reduce(
    (n, r) => n + r.injected_candidate_ids.length, 0,
  );
  const candidates_injected_kept = per_role.reduce(
    (n, r) => n + r.injected_candidate_ids.filter((cid) => {
      const s = verdictByCid.get(cid);
      return s === "direct" || s === "partial";
    }).length, 0,
  );

  const totals = {
    roles: per_role.length,
    roles_tried_local: per_role.filter((r) => r.tried_local).length,
    roles_tried_web: per_role.filter((r) => r.tried_web).length,
    roles_reached_verifier: per_role.filter((r) => r.reached_verifier).length,
    roles_missing_entirely: per_role.filter((r) => !r.reached_verifier).length,
    roles_injected: per_role.filter((r) => r.injected_candidate_ids.length > 0).length,
    candidates_injected,
    candidates_injected_kept,
  };

  return { per_role, totals };
}

export function summarizeRequirements(
  reqs: SourceRequirementsPlan,
): {
  triggered: string[];
  role_count: number;
  per_claim_role_counts: Record<string, number>;
} {
  const per_claim_role_counts: Record<string, number> = {};
  for (const a of reqs.per_claim) per_claim_role_counts[a.claim_id] = a.role_ids.length;
  return {
    triggered: reqs.triggered_doctrines,
    role_count: reqs.mandatory_roles.length,
    per_claim_role_counts,
  };
}
