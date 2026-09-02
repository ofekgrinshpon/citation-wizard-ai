// P3.1 — Perplexity retrieval. Broad discovery, classification, strict admission.
// Discovery-only results are kept in telemetry, never admitted to the pool.
// For useful clues in discovery-only items (docket, statute+section), one
// follow-up search is run to surface the canonical/official source.

import type { RetrievalGovernor } from "./retrievalGovernor.ts";
import {
  Candidate,
  CAPS,
  DroppedSource,
  Query,
  SourceRole,
  StageRun,
} from "../lib/types.ts";
import {
  accumulateHygieneCounts,
  emptyHygieneCounts,
  evaluatePerplexityHygiene,
  isReportOnlyMode,
  normalizePerplexitySourceType,
  type PplxHygiene,
  type PplxHygieneCounts,
} from "./perplexityHygiene.ts";
import {
  detectPrimaryAuthorityShape,
  type PrimaryShapeRescue,
} from "./primaryShapeRescue.ts";
import {
  evaluateScholarshipAdmission,
  hasTopicalFit,
  resolveAcademicRoleSlot,
  type RoleSlottingDecision,
  type ScholarshipAdmissionDecision,
} from "./academicCandidateAdmission.ts";

const PPLX_TIMEOUT_MS = 25_000;

// ─── Domain → source class ──────────────────────────────────────────────────

type SourceClass =
  | "official_primary"        // Supreme Court / court.gov.il / justice / supremedecisions
  | "court_case"              // recognized case-law databases
  | "legislation"             // nevo law page, knesset law page
  | "government_report"       // gov.il / mevaker / official committee
  | "academic"                // .ac.il, university domains
  | "publisher"               // SSRN paper/abstract page, jstor, journal articles
  | "discovery_only"          // law firm blog, kol-zchut, news, scholar, generic publisher
  | "commercial_secondary"    // commercial DBs without direct cite-able URL
  | "news"
  | "unknown"
  | "bad";                    // wikipedia, broken

const OFFICIAL_COURT_DOMAINS = new Set([
  "supremedecisions.court.gov.il",
  "supreme.court.gov.il",
  "court.gov.il",
  "elyon1.court.gov.il",
]);
const COURT_DB_DOMAINS = new Set([
  "nevo.co.il", "takdin.co.il", "lite.takdin.co.il", "psakdin.co.il", "din.org.il",
]);
const KNESSET_DOMAINS = new Set([
  "main.knesset.gov.il", "knesset.gov.il", "fs.knesset.gov.il",
]);
const GOV_REPORT_DOMAINS_SUFFIX = ["gov.il", "mevaker.gov.il", "boi.org.il", "cbs.gov.il", "btl.gov.il"];
const ACADEMIC_SUFFIX = [
  ".ac.il", "academia.edu", "hebrewu.ac.il", "law.bgu.ac.il", "mishpat.ac.il",
];
const PUBLISHER_DOMAINS = new Set([
  "ssrn.com", "papers.ssrn.com", "jstor.org",
]);
const BAD_DOMAINS = new Set([
  "wikipedia.org", "he.wikipedia.org", "en.wikipedia.org",
]);
const DISCOVERY_ONLY_HINTS = [
  "kolzchut", "kol-zchut", "din-online", "law-info", "lawguide",
  "lawyer", "advocate", "calcalist", "themarker", "ynet", "haaretz",
  "globes", "n12", "kan.org.il", "mako.co.il", "walla.co.il",
  "blog", "scholar.google",
];

const CASE_TITLE_RE = /(?:בג["״]?ץ|דנג["״]?ץ|עע["״]?מ|ע["״]?מ|ע["״]?א|ע["״]?פ|רע["״]?א|רע["״]?פ|דנ["״]?א|דנ["״]?פ|בש["״]?פ|בש["״]?א|תפ["״]?ח|תמ["״]?ש|רמ["״]?ש|בר["״]?ם|בר["״]?ע|ה["״]?פ)\s*(?:\([^)]{1,40}\)\s*)?\d{1,6}(?:[\/\-]\d{1,4}){1,2}|פסק\s*דין|פס["״]?ד/;

function getDomain(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function getPath(url: string | undefined): string {
  if (!url) return "";
  try { return new URL(url).pathname.toLowerCase(); } catch { return ""; }
}

function classify(url: string, title: string): SourceClass {
  const domain = getDomain(url);
  const path = getPath(url);
  const titleL = (title || "").toLowerCase();
  if (!domain) return "unknown";
  if (BAD_DOMAINS.has(domain) || domain.endsWith(".wikipedia.org")) return "bad";

  if (OFFICIAL_COURT_DOMAINS.has(domain)) return "official_primary";
  if (KNESSET_DOMAINS.has(domain)) {
    // P3.2 #4: explicit חוק / statute markers in URL or title → legislation
    const looksLaw = /\.pdf$/i.test(path) ||
      /law|legislation|bill/.test(path) ||
      /חוק|הצעת\s+חוק/.test(title);
    if (looksLaw) return "legislation";
    return "government_report";
  }
  if (domain === "justice.gov.il") return "official_primary";

  if (COURT_DB_DOMAINS.has(domain)) {
    if (domain === "nevo.co.il") {
      // P3.2 #4: nevo law_word/*.doc is NOT auto-legislation — could be a case or DB doc.
      if (/\/law_word\//i.test(path)) {
        // Decide by title hints
        if (/חוק\s|תקנות\s|פקודת\s/.test(title)) return "legislation";
        if (/ע"?א|בג"?ץ|רע"?א|ע"?פ|פס"?ד|פסק\s*דין/.test(title)) return "court_case";
        return "court_case"; // default lean
      }
      if (/\/product\/book/i.test(path)) return "publisher";
      if (/\/law/i.test(path)) return "legislation";
      return "court_case";
    }
    return "court_case";
  }

  // scholar.google never final
  if (/scholar\.google\./.test(domain)) return "discovery_only";

  if (PUBLISHER_DOMAINS.has(domain)) {
    if (domain.endsWith("ssrn.com") && !/abstract|papers\.cfm/.test(path)) return "discovery_only";
    return "publisher";
  }

  if (ACADEMIC_SUFFIX.some((s) => domain.endsWith(s))) return "academic";

  // gov.il (non-knesset, non-court): some official legalinfo PDFs are court
  // judgments/decision summaries hosted on a ministry domain. If the title is
  // a docket/case title, classify it as case law before the generic law-path
  // rule below; otherwise Q02-like exact judgments become "legislation" and
  // lead_ref refuses while the drafter still sees the substantive snippet.
  if (GOV_REPORT_DOMAINS_SUFFIX.some((s) => domain.endsWith(s))) {
    if (CASE_TITLE_RE.test(title)) return "court_case";
    if (/חוק|תקנות|פקודה/.test(titleL) || /law|statute/.test(path)) return "legislation";
    return "government_report";
  }

  if (DISCOVERY_ONLY_HINTS.some((s) => domain.includes(s) || titleL.includes(s))) {
    return "discovery_only";
  }

  if (/law|mishpat|din|advocate|lawyer/i.test(domain)) return "discovery_only";

  return "unknown";
}

// Admission policy: class × role
function admitFor(role: SourceRole, cls: SourceClass): boolean {
  switch (role) {
    case "primary_statute":
    case "regulation":
      return cls === "legislation" || cls === "official_primary" || cls === "government_report";
    case "binding_case_law":
    case "persuasive_case_law":
      return cls === "official_primary" || cls === "court_case";
    case "scholarship":
      return cls === "academic" || cls === "publisher";
    case "factual_report":
    case "government_report":
      return cls === "government_report" || cls === "official_primary";
  }
}

// P3.2 #4: source-class override — if the source is clearly official legislation
// or an official court case, correct the planner's role rather than dropping.
function correctRoleForClass(
  role: SourceRole,
  cls: SourceClass,
  academicMode = false,
): { role: SourceRole; corrected_from?: SourceRole } {
  // academic_citation_authority_alignment_v1 — in academic_writing runs an
  // academic/publisher source found under a case-law or statute query is
  // remapped to the scholarship lane instead of being dropped as
  // role-mismatched. Integrity, hygiene and the verifier still apply.
  if (
    academicMode && (cls === "academic" || cls === "publisher") &&
    role !== "scholarship"
  ) {
    return { role: "scholarship", corrected_from: role };
  }
  // Knesset/gov-il legislation: always admit as primary_statute regardless of original role.
  if (cls === "legislation" && role !== "primary_statute" && role !== "regulation") {
    return { role: "primary_statute", corrected_from: role };
  }
  // Official Supreme Court / court.gov.il: always case law.
  if (cls === "official_primary" && role !== "binding_case_law" && role !== "persuasive_case_law") {
    return { role: "binding_case_law", corrected_from: role };
  }
  if (cls === "court_case" && role !== "binding_case_law" && role !== "persuasive_case_law") {
    return { role: "persuasive_case_law", corrected_from: role };
  }
  return { role };
}

// ─── Role prompts ───────────────────────────────────────────────────────────

const ROLE_PROMPT: Record<SourceRole, { focus: string; hint: string }> = {
  primary_statute: {
    focus: "חקיקה ראשית ישראלית: חוקים וסעיפי חוק רלוונטיים",
    hint: "החזר כותרת מלאה של החוק, סעיף, וקישור ל־nevo.co.il, fs.knesset.gov.il, knesset.gov.il, justice.gov.il, gov.il",
  },
  regulation: {
    focus: "תקנות וצווים ישראליים",
    hint: "החזר את שם התקנה והסעיף, וקישור ל־nevo.co.il / knesset.gov.il / gov.il",
  },
  binding_case_law: {
    focus: "פסיקה מחייבת — בית המשפט העליון ובג\"ץ",
    hint: "החזר שם הצדדים, מספר תיק, וקישור ל־supremedecisions.court.gov.il / court.gov.il / nevo.co.il / takdin / psakdin",
  },
  persuasive_case_law: {
    focus: "פסיקה מנחה — מחוזי, שלום, בתי דין מיוחדים",
    hint: "החזר שם הצדדים, מספר תיק, וקישור למאגר פסיקה מוכר",
  },
  scholarship: {
    focus: "ספרות אקדמית משפטית: מאמרים, ספרים, פרקים",
    hint: "החזר מחבר, כותרת, כתב עת/הוצאה ושנה. עדיף קישור אקדמי או דף מאמר ישיר ב־SSRN/JSTOR",
  },
  factual_report: {
    focus: "דו\"חות עובדתיים, נתונים סטטיסטיים",
    hint: "מקור רשמי או מכון מחקר; קישור ישיר למסמך",
  },
  government_report: {
    focus: "דו\"חות ממשלתיים, מבקר המדינה, ועדות חקירה",
    hint: "קישור ל־gov.il, mevaker.gov.il, knesset.gov.il",
  },
};

interface PplxSource {
  title: string;
  source_type?: string;
  url?: string;
  snippet?: string;
  /** Untruncated snippet text, reserved for the synthesis snippet budget. */
  snippet_full?: string;
}

async function callPerplexity(
  query: Query,
  queryOverride?: string,
  budget?: RetrievalGovernor | null,
): Promise<{
  raw: PplxSource[];
  ms: number;
  ok: boolean;
  http?: number;
}> {
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  if (!key) return { raw: [], ms: 0, ok: false };
  const role = ROLE_PROMPT[query.role];
  const sys =
    `אתה מאתר מקורות משפטיים ישראליים. עבור התפקיד: ${role.focus}. ${role.hint}. ` +
    `החזר עד ${CAPS.PERPLEXITY_PER_QUERY} מקורות עם כתובת URL ישירה. אל תמציא קישורים.`;
  const t0 = Date.now();
  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: queryOverride || query.query_he },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "sources",
            schema: {
              type: "object",
              properties: {
                sources: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      source_type: { type: "string" },
                      url: { type: "string" },
                      snippet: { type: "string" },
                    },
                    required: ["title"],
                  },
                },
              },
              required: ["sources"],
            },
          },
        },
      }),
      signal: budget ? budget.callSignal(PPLX_TIMEOUT_MS) : AbortSignal.timeout(PPLX_TIMEOUT_MS),
    });
    const ms = Date.now() - t0;
    if (!r.ok) return { raw: [], ms, ok: false, http: r.status };
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content ?? "";
    const citations: string[] = Array.isArray(j?.citations) ? j.citations : [];
    let parsed: { sources?: PplxSource[] } = {};
    try { parsed = JSON.parse(content); } catch { /* tolerate */ }
    const raw = Array.isArray(parsed.sources)
      ? parsed.sources.slice(0, CAPS.PERPLEXITY_PER_QUERY).map((s, i) => ({
          title: String(s.title ?? "").trim(),
          source_type: String(s.source_type ?? "").trim(),
          url: (s.url && String(s.url).trim()) || citations[i] || "",
          snippet: s.snippet ? String(s.snippet).slice(0, 400) : undefined,
          snippet_full: s.snippet ? String(s.snippet).slice(0, 1600) : undefined,
        }))
      : [];
    return { raw, ms, ok: true, http: r.status };
  } catch {
    return { raw: [], ms: Date.now() - t0, ok: false, http: 0 };
  }
}

// ─── Follow-up term extraction from discovery_only ──────────────────────────

const DOCKET_RE = /\b(?:בג"?ץ|בג״ץ|ע"?א|ע״א|רע"?א|רע״א|ע"?פ|ע״פ|דנ"?א|דנ״א|בש"?פ|בש״פ)\s*\d{1,5}\/\d{2,4}\b/g;
const STATUTE_SECTION_RE = /סעיף\s+\d+[א-ת]?\s+ל?חוק[^,?.\n]{0,60}/g;

function extractFollowupTerms(title: string, snippet?: string): string[] {
  const hay = `${title} ${snippet || ""}`;
  const terms = new Set<string>();
  for (const m of hay.matchAll(DOCKET_RE)) terms.add(m[0]);
  for (const m of hay.matchAll(STATUTE_SECTION_RE)) terms.add(m[0]);
  return [...terms].slice(0, 3);
}

// ─── Per-result row in telemetry ────────────────────────────────────────────

interface PplxResultRow {
  title: string;
  url: string;
  domain: string;
  classified_source_class: SourceClass;
  admitted_to_candidate_pool: boolean;
  drop_reason?: string;
  extracted_followup_terms?: string[];
  role_corrected_from?: SourceRole;
  role_corrected_to?: SourceRole;
  hygiene?: PplxHygiene;
  hygiene_enforced?: boolean;          // true when action was applied (default mode)
  raw_pplx_source_type?: string;
  normalized_source_type?: string;
  // class_unknown_primary_shape_rescue_v1 telemetry
  original_classification?: string;
  rescue_reason?: string;
  rescued_as?: string;
  original_query_role?: SourceRole;
  rescue_matched_docket?: string;
  rescue_matched_in?: string;
  // academic_candidate_admission_and_slotting_v1 telemetry
  academic_admission_decision?: string;
  academic_admission_signals?: string[];
  academic_rejection_reasons?: string[];
  academic_role_slot_final?: string;
}

function processRaw(
  query: Query,
  raw: PplxSource[],
  hygieneCounts: PplxHygieneCounts,
  academicMode = false,
  topicTerms: string[] = [],
  admissionTrace?: {
    admissions: ScholarshipAdmissionDecision[];
    slotting: RoleSlottingDecision[];
  },
): {
  admitted: Candidate[];
  rows: PplxResultRow[];
  followupTerms: string[];
} {
  const admitted: Candidate[] = [];
  const rows: PplxResultRow[] = [];
  const followupTerms = new Set<string>();
  const reportOnly = hygieneCounts.report_only_mode;
  for (const s of raw) {
    const title = (s.title || "").trim();
    const url = (s.url || "").trim();
    const domain = getDomain(url);
    if (!url) {
      rows.push({ title, url, domain, classified_source_class: "unknown",
        admitted_to_candidate_pool: false, drop_reason: "no_url" });
      continue;
    }
    let cls = classify(url, title);
    if (cls === "bad") {
      rows.push({ title, url, domain, classified_source_class: cls,
        admitted_to_candidate_pool: false, drop_reason: "bad_source" });
      continue;
    }

    // class_unknown_primary_shape_rescue_v1 — an `unknown` source whose title
    // or URL carries an unambiguous Israeli judgment shape is routed to the
    // case-law lane instead of being dropped. Admission only: verifier,
    // source-integrity and the metadata-only holding gate still apply.
    let rescue: PrimaryShapeRescue | null = null;
    if (cls === "unknown") {
      rescue = detectPrimaryAuthorityShape({ url, title, snippet: s.snippet });
      if (rescue) cls = "court_case";
    }
    const originalQueryRole = query.role;

    // academic_candidate_admission_and_slotting_v1 — an `unknown` candidate in
    // an academic run is REVIEWED by scholarship signals at this original gate
    // (never auto-admitted). Substantive-body, verifier and integrity gates
    // downstream are untouched.
    let admission: ScholarshipAdmissionDecision | null = null;
    if (academicMode && cls === "unknown") {
      admission = evaluateScholarshipAdmission({
        title,
        url,
        snippet: s.snippet,
        original_class: cls,
        topic_terms: topicTerms,
      });
      admissionTrace?.admissions.push(admission);
      if (admission.admission_decision === "admitted_as_scholarship") cls = "academic";
    }

    // P3.2 #4: role correction before admission
    const { role: correctedRole, corrected_from } = correctRoleForClass(
      query.role,
      cls,
      academicMode,
    );
    let effectiveRole = correctedRole;
    let admit = admitFor(effectiveRole, cls);

    // academic_candidate_admission_and_slotting_v1 — role-slot correction
    // BEFORE rejection: a topical secondary source that landed in a slot it
    // cannot satisfy is moved to a safe secondary academic slot. Never into a
    // primary slot, never for off-topic material.
    let slotting: RoleSlottingDecision | null = null;
    if (!admit && academicMode && cls !== "discovery_only") {
      slotting = resolveAcademicRoleSlot({
        title,
        url,
        snippet: s.snippet,
        original_slot: effectiveRole,
        source_class: cls,
        topical_fit: admission
          ? admission.topical_fit
          : hasTopicalFit(`${title} ${s.snippet ?? ""}`, topicTerms),
        admission_signals: admission?.admission_signals,
      });
      admissionTrace?.slotting.push(slotting);
      if (slotting.final_slot && admitFor(slotting.final_slot, cls)) {
        effectiveRole = slotting.final_slot;
        admit = true;
      }
    }

    if (!admit) {
      const followup = cls === "discovery_only" ? extractFollowupTerms(title, s.snippet) : [];
      followup.forEach((t) => followupTerms.add(t));
      rows.push({
        title, url, domain,
        classified_source_class: cls,
        admitted_to_candidate_pool: false,
        drop_reason: cls === "discovery_only" ? "discovery_only" : `class_${cls}_not_admitted_for_${effectiveRole}`,
        extracted_followup_terms: followup.length ? followup : undefined,
        role_corrected_from: corrected_from,
        role_corrected_to: corrected_from ? effectiveRole : undefined,
        academic_admission_decision: admission?.admission_decision,
        academic_admission_signals: admission?.admission_signals,
        academic_rejection_reasons: admission?.rejection_reasons ??
          (slotting?.rejected_reason ? [slotting.rejected_reason] : undefined),
        academic_role_slot_final: slotting?.final_slot ?? undefined,
      });
      continue;
    }

    // ── Phase-1 hygiene gate ────────────────────────────────────────────────
    const hygiene = evaluatePerplexityHygiene({ url, title, snippet: s.snippet });
    accumulateHygieneCounts(hygieneCounts, hygiene);
    const wouldExclude = hygiene.hygiene_action === "exclude";
    if (wouldExclude) hygieneCounts.would_exclude_in_report_only += reportOnly ? 1 : 0;

    if (!reportOnly && hygiene.hygiene_action === "exclude") {
      rows.push({
        title, url, domain, classified_source_class: cls,
        admitted_to_candidate_pool: false,
        drop_reason: `hygiene:${hygiene.hygiene_reasons.join(",") || "exclude"}`,
        hygiene, hygiene_enforced: true,
      });
      continue;
    }

    // Source-type normalization (conservative — preserve raw).
    const rawSt = String(s.source_type ?? "").trim();
    const st = normalizePerplexitySourceType(rawSt, cls);

    // Use normalized URL when hygiene fixed an obvious typo (hhttps://…).
    const effectiveUrl = hygiene.url_normalized && hygiene.url_status === "fixed"
      ? hygiene.url_normalized
      : url;

    let baseScore = cls === "official_primary" || cls === "legislation" ? 0.95 : 0.75;
    // Bad hygiene caps the score at 0.5 (per approved plan).
    const downgrade = !reportOnly && hygiene.hygiene_action === "downgrade";
    if (downgrade && baseScore > 0.5) baseScore = 0.5;

    // Docket-anchor: mark docket_match ONLY when the docket string appears in
    // the TITLE or URL (not the snippet). A later case whose analysis merely
    // cites the target docket in its snippet is not the target ruling; letting
    // such rows satisfy `docket:*` anchors caused the B2 Ka'adan regression
    // (lead_ref bound to an unrelated case that name-dropped 6698/95).
    const qMeta = (query.metadata ?? {}) as Record<string, unknown>;
    const isDocketAnchor = qMeta.is_docket_anchor === true;
    const docketVariants: string[] = Array.isArray(qMeta.docket_variants)
      ? (qMeta.docket_variants as string[]) : [];
    let docket_match = false;
    if (isDocketAnchor) {
      const hay = `${title}\n${effectiveUrl}`;
      const hayLower = hay.toLowerCase();
      for (const v of docketVariants) {
        if (v.length < 4) continue;
        if (/^[A-Za-z]/.test(v)) {
          if (hayLower.includes(v.toLowerCase())) { docket_match = true; break; }
        } else if (hay.includes(v)) { docket_match = true; break; }
      }
    }

    if (docket_match) baseScore = Math.min(1, baseScore + 0.05);

    rows.push({
      title, url, domain, classified_source_class: cls,
      admitted_to_candidate_pool: true,
      role_corrected_from: corrected_from,
      role_corrected_to: corrected_from ? effectiveRole : undefined,
      hygiene,
      hygiene_enforced: !reportOnly && hygiene.hygiene_action !== "keep",
      raw_pplx_source_type: rawSt,
      normalized_source_type: st.normalized,
      ...(rescue ? {
        original_classification: rescue.original_classification,
        rescue_reason: rescue.rescue_reason,
        rescued_as: rescue.rescued_as,
        original_query_role: originalQueryRole,
        rescue_matched_docket: rescue.matched_docket,
        rescue_matched_in: rescue.matched_in,
      } : {}),
      ...(admission ? {
        academic_admission_decision: admission.admission_decision,
        academic_admission_signals: admission.admission_signals,
      } : {}),
      ...(slotting?.final_slot ? { academic_role_slot_final: slotting.final_slot } : {}),
    });
    admitted.push({
      candidate_id: crypto.randomUUID(),
      claim_id: query.claim_id,
      role: effectiveRole,
      origin: "perplexity",
      retrieval_method: "perplexity",
      title,
      // Conservative: never pass through raw PPLX strings as Candidate.source_type;
      // use normalized value. Raw is preserved in metadata.
      source_type: st.normalized,
      source_url: effectiveUrl,
      snippet: s.snippet ?? null,
      query_he: query.query_he,
      score: baseScore,
      expected_source_type: query.expected_source_type,
      metadata: {
        domain, classified_source_class: cls,
        // Reserved text for the synthesis snippet budget (display cap unchanged).
        ...(s.snippet_full && s.snippet_full.length > (s.snippet?.length ?? 0)
          ? { extended_text: s.snippet_full }
          : {}),
        role_corrected_from: corrected_from,
        pplx_hygiene: hygiene,
        raw_pplx_source_type: rawSt,
        source_type_normalized: st.was_normalized,
        ...(docket_match ? { docket_match: true } : {}),
        ...(rescue ? {
          original_classification: rescue.original_classification,
          rescue_reason: rescue.rescue_reason,
          rescued_as: rescue.rescued_as,
          original_query_role: originalQueryRole,
          rescue_matched_docket: rescue.matched_docket,
          rescue_matched_in: rescue.matched_in,
        } : {}),
        ...(query.metadata?.required_anchor_id
          ? { required_anchor_id: query.metadata.required_anchor_id }
          : {}),
        ...(admission?.admission_decision === "admitted_as_scholarship"
          ? {
            academic_scholarship_admitted: true,
            academic_admission_signals: admission.admission_signals,
            academic_assigned_source_type: admission.assigned_source_type,
          }
          : {}),
        ...(slotting?.final_slot
          ? {
            academic_role_slot_original: slotting.original_slot,
            academic_role_slot_final: slotting.final_slot,
            academic_assigned_roles: slotting.assigned_academic_roles,
          }
          : {}),
      },
    });
  }
  return { admitted, rows, followupTerms: [...followupTerms].slice(0, 2) };
}

export interface PerplexityRetrievalResult {
  candidates: Candidate[];
  dropped: DroppedSource[];
  per_query: Array<{
    claim_id: string;
    role: string;
    query_he: string;
    http?: number;
    raw_count: number;
    discovery_only: number;
    admitted: number;
    followup_terms: string[];
    followup_admitted: number;
    ms: number;
    results: PplxResultRow[];
  }>;
  stage_runs: StageRun[];
  ms: number;
  parallel: boolean;
  concurrency_limit: number;
  query_count: number;
  query_ms: number[];
  total_wall_ms: number;
  total_sum_ms: number;
  rate_limit_count: number;
  retry_count: number;
  fallback_to_sequential: boolean;
  merge_order_preserved: boolean;
  hygiene_counts: PplxHygieneCounts;
  /** academic_candidate_admission_and_slotting_v1 — original-gate decisions. */
  academic_scholarship_admission_gate: ScholarshipAdmissionDecision[];
  academic_role_slotting_decision: RoleSlottingDecision[];
}

interface PerQueryWorkResult {
  index: number;
  candidates: Candidate[];
  dropped: DroppedSource[];
  per_query: PerplexityRetrievalResult["per_query"][number];
  rate_limited: boolean;
}

async function runOneQuery(
  q: Query,
  index: number,
  hygieneCounts: PplxHygieneCounts,
  budget?: RetrievalGovernor | null,
  academicMode = false,
  topicTerms: string[] = [],
  admissionTrace?: {
    admissions: ScholarshipAdmissionDecision[];
    slotting: RoleSlottingDecision[];
  },
): Promise<PerQueryWorkResult> {
  const first = await callPerplexity(q, undefined, budget);
  const { admitted, rows, followupTerms } = processRaw(
    q,
    first.raw,
    hygieneCounts,
    academicMode,
    topicTerms,
    admissionTrace,
  );
  const allCandidates: Candidate[] = [...admitted];
  let totalMs = first.ms;
  let followupAdmitted = 0;
  let rate_limited = first.http === 429;

  // One follow-up using the most promising extracted term, if any.
  if (followupTerms.length > 0 && (!budget || budget.canLaunch())) {
    const term = followupTerms[0];
    const second = await callPerplexity(q, `${term} ${q.query_he}`.slice(0, 200), budget);
    totalMs += second.ms;
    if (second.http === 429) rate_limited = true;
    const second_p = processRaw(
      q,
      second.raw,
      hygieneCounts,
      academicMode,
      topicTerms,
      admissionTrace,
    );
    allCandidates.push(...second_p.admitted);
    followupAdmitted = second_p.admitted.length;
    for (const r of second_p.rows) {
      rows.push({ ...r, drop_reason: r.drop_reason ? `followup:${r.drop_reason}` : r.drop_reason });
    }
  }

  const droppedRows: DroppedSource[] = [];
  for (const r of rows) {
    if (!r.admitted_to_candidate_pool) {
      droppedRows.push({
        query_he: q.query_he, claim_id: q.claim_id, role: q.role,
        origin: "perplexity", title: r.title, url: r.url,
        drop_reason: r.drop_reason || "unknown",
      });
    }
  }

  return {
    index,
    candidates: allCandidates,
    dropped: droppedRows,
    per_query: {
      claim_id: q.claim_id,
      role: q.role,
      query_he: q.query_he,
      http: first.http,
      raw_count: first.raw.length,
      discovery_only: rows.filter((r) => r.classified_source_class === "discovery_only").length,
      admitted: admitted.length + followupAdmitted,
      followup_terms: followupTerms,
      followup_admitted: followupAdmitted,
      ms: totalMs,
      results: rows,
    },
    rate_limited,
  };
}

export async function runPerplexityRetrieval(
  queries: Query[],
  opts: {
    budget?: RetrievalGovernor | null;
    academicMode?: boolean;
    /** Question/topic terms used for topical-fit checks at the academic gate. */
    topicTerms?: string[];
  } = {},
): Promise<PerplexityRetrievalResult> {
  const budget = opts.budget ?? null;
  const t0 = Date.now();
  const key = Deno.env.get("PERPLEXITY_API_KEY");
  const concEnv = Number(Deno.env.get("PERPLEXITY_CONCURRENCY") ?? "4");
  const concurrency_limit = Number.isFinite(concEnv) && concEnv > 0 ? Math.min(8, Math.floor(concEnv)) : 4;
  const admissionTrace = {
    admissions: [] as ScholarshipAdmissionDecision[],
    slotting: [] as RoleSlottingDecision[],
  };

  if (!key) {
    return {
      candidates: [], dropped: [], per_query: [],
      stage_runs: [{ stage: "perplexity_retrieval.skipped", ms: 0, ok: false }],
      ms: 0,
      parallel: false, concurrency_limit, query_count: 0,
      query_ms: [], total_wall_ms: 0, total_sum_ms: 0,
      rate_limit_count: 0, retry_count: 0,
      fallback_to_sequential: false, merge_order_preserved: true,
      hygiene_counts: emptyHygieneCounts(isReportOnlyMode()),
      academic_scholarship_admission_gate: [],
      academic_role_slotting_decision: [],
    };
  }
  const targets = queries.filter((q) => q.targets.includes("perplexity"));
  const hygieneCounts = emptyHygieneCounts(isReportOnlyMode());

  // Bounded-concurrency worker pool. Preserves original order in results
  // by indexing the input array; merge below walks indices in order.
  const results: (PerQueryWorkResult | undefined)[] = new Array(targets.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= targets.length) return;
      // retrieval_budget_enforcement_v1: never START a new web query once the
      // launch window has closed — the remaining ones are abandoned, counted.
      if (budget && !budget.canLaunch()) {
        budget.noteAborted();
        continue;
      }
      results[i] = await runOneQuery(
        targets[i],
        i,
        hygieneCounts,
        budget,
        opts.academicMode === true,
        opts.topicTerms ?? [],
        admissionTrace,
      );
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency_limit, targets.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // Deterministic merge in original input order.
  const candidates: Candidate[] = [];
  const dropped: DroppedSource[] = [];
  const per_query: PerplexityRetrievalResult["per_query"] = [];
  const query_ms: number[] = [];
  let rate_limit_count = 0;
  let merge_order_preserved = true;
  let lastIndex = -1;
  for (let i = 0; i < targets.length; i++) {
    const r = results[i];
    if (!r) continue;
    if (r.index !== i || r.index <= lastIndex) merge_order_preserved = false;
    lastIndex = r.index;
    candidates.push(...r.candidates);
    dropped.push(...r.dropped);
    per_query.push(r.per_query);
    query_ms.push(r.per_query.ms);
    if (r.rate_limited) rate_limit_count++;
  }

  const total_wall_ms = Date.now() - t0;
  const total_sum_ms = query_ms.reduce((a, b) => a + b, 0);

  return {
    candidates,
    dropped,
    per_query,
    stage_runs: [{ stage: "perplexity_retrieval", ms: total_wall_ms, ok: true }],
    ms: total_wall_ms,
    parallel: workerCount > 1,
    concurrency_limit,
    query_count: targets.length,
    query_ms,
    total_wall_ms,
    total_sum_ms,
    rate_limit_count,
    retry_count: 0,
    fallback_to_sequential: false,
    merge_order_preserved,
    hygiene_counts: hygieneCounts,
    academic_scholarship_admission_gate: admissionTrace.admissions,
    academic_role_slotting_decision: admissionTrace.slotting,
  };
}
