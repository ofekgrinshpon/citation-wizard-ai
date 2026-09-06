/**
 * fix_topicality_and_role_labelling_v1 — role recomputation after body acquisition.
 *
 * A candidate inherits its `role` from the retrieval slot that found it (the
 * claim's required role). When a journal article is discovered through a
 * statute or case-law query it keeps `primary_statute` / `binding_case_law`,
 * and `canSatisfyRole` then reports `false` — so a 16k-char direct scholarship
 * body is excluded although nothing is wrong with the source.
 *
 * This module recomputes the role from the *document itself* (title, host,
 * metadata, body shape) once a body exists. The retrieval slot is preserved as
 * `origin_slot` for telemetry, but it no longer decides usability.
 *
 * No retrieval, no model call, no source is added or cited by this module.
 */

export const BODY_DERIVED_ROLE_VERSION = "fix_topicality_and_role_labelling_v1";

export type BodyDerivedRole =
  | "direct_scholarship"
  | "adjacent_scholarship"
  | "journal_article"
  | "book_or_chapter"
  | "institutional_research"
  | "binding_case_law"
  | "primary_statute"
  | "regulation_or_guideline"
  | "legal_news_or_commentary"
  | "listing_or_catalog"
  | "unknown";

const SCHOLARSHIP_ROLES = new Set<BodyDerivedRole>([
  "direct_scholarship",
  "adjacent_scholarship",
  "journal_article",
  "book_or_chapter",
  "institutional_research",
]);

export function isScholarshipRole(r: BodyDerivedRole): boolean {
  return SCHOLARSHIP_ROLES.has(r);
}

// ── document-shape signals (body-derived, never query-derived) ─────────────

/** Judgment shape: bench, parties, docket line, disposition language. */
const JUDGMENT_BODY_RE =
  /(בבית\s+המשפט\s+העליון|בבית\s+המשפט\s+המחוזי|לפני:?\s+כב'|כבוד\s+השופט|השופטת\s+[א-ת]|פסק[\s-]דין|החלטה\s*$|העותר(?:ים|ת)?\s+נגד|המשיב(?:ים|ה)?\s*:|ניתן\s+היום|בשם\s+המערער)/m;
const DOCKET_RE = /(בג["״']?ץ|בג"ץ|ע"א|עע"מ|בש"פ|רע"א|ע"פ|עה"ס|ע"מ|בר"מ|דנ"א)\s*\d{1,5}\s*\/\s*\d{2,4}/;

/** Statute shape: chapter/section skeleton and legislative formulas. */
const STATUTE_BODY_RE =
  /(חוק\s+[^\n]{3,60}(?:,\s*התש[א-ת"״]{2,6}[-–—]\d{4})|פרק\s+[א-ת]['׳]?\s*:|תיקון\s+מס['׳]\s*\d+|תחילתו\s+של\s+חוק\s+זה|בחוק\s+זה\s*[-–—])/;
const REGULATION_RE = /(תקנות\s+[^\n]{3,60}|צו\s+[^\n]{3,60},\s*התש|נוהל\s+מספר|הנחיות\s+היועץ)/;

/** Academic article shape. */
const ARTICLE_BODY_RE =
  /(תקציר|מבוא\s*$|ראו\s+לעיל,?\s*ה"ש|הערות\s+שוליים|כתב\s+העת|כרך\s+[א-תIVXL]+|abstract|introduction\s*$|references\s*$|bibliography|doi:)/mi;
const FOOTNOTE_DENSITY_RE = /(ה"ש|לעיל,\s*ה|ibid|supra|op\.\s?cit)/g;
const BOOK_RE = /(הוצאת|מהדורה\s+(?:שנייה|שלישית|רביעית)|ספר\s+[א-ת]{3,}\s+\(|in\s+.{3,40}\(ed[s]?\.\)|chapter\s+\d)/i;
const INSTITUTIONAL_RE =
  /(המכון\s+הישראלי\s+לדמוקרטיה|מרכז\s+המחקר\s+והמידע|מחקר\s+מדיניות|נייר\s+מדיניות|נייר\s+עמדה|policy\s+paper|working\s+paper|israel\s+democracy\s+institute)/i;
const NEWS_RE = /(כתבה|מערכת\s+האתר|עודכן\s+לאחרונה|פורסם\s+ב[־-]?\s*\d|ynet|walla|globes|calcalist)/i;
const LISTING_RE =
  /(תוצאות\s+חיפוש|לא\s+נמצאו\s+תוצאות|רשימת\s+פסקי\s+דין|search\s+results|browse\s+by)/i;

const JOURNAL_RE =
  /(משפטים\s+על\s+אתר|פורום\s+עיוני\s+משפט|עיוני\s+משפט|מחקרי\s+משפט|הפרקליט|משפט\s+וממשל|מאזני\s+משפט|דין\s+ודברים|מעשי\s+משפט|משפט\s+ועסקים|עלי\s+משפט|חוקים|כתב[\s-]?עת|law\s+review|law\s+journal)/i;

const ACADEMIC_HOST_RE =
  /(\.ac\.il|\.edu|idi\.org\.il|ssrn\.com|jstor\.org|heinonline\.org|cambridge\.org|oup\.com|springer\.com|tandfonline\.com|academia\.edu|researchgate\.net|vanleer\.org\.il|kohelet\.org\.il|hashiloach\.org\.il)/i;
const COURT_HOST_RE = /(supreme\.court\.gov\.il|court\.gov\.il|elyon\d?\.court)/i;
const LEGISLATION_HOST_RE = /(knesset\.gov\.il|nevo\.co\.il\/law|main\.knesset|justice\.gov\.il\/.*חקיקה)/i;

function host(url?: string | null): string {
  try {
    return new URL(String(url ?? "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export interface BodyRoleEvidence {
  signals: string[];
  /** "strong" only when the document shape itself is unambiguous. */
  strength: "strong" | "weak" | "none";
}

export interface BodyRoleInput {
  candidate_id: string;
  title: string;
  url?: string | null;
  source_type?: string | null;
  /** Retrieval-slot role the candidate currently carries. */
  role?: string | null;
  citable_as?: string | null;
  body?: string | null;
  body_chars?: number;
  /** direct / adjacent / off_topic from post-body topicality, when known. */
  body_topicality?: "direct" | "adjacent" | "off_topic" | null;
}

export interface BodyRoleResult {
  candidate_id: string;
  title: string;
  body_derived_role: BodyDerivedRole;
  evidence: BodyRoleEvidence;
}

/**
 * Derive the role from the document. Judgment/statute shape wins over
 * scholarly hosting (a judgment mirrored on a faculty site is still a
 * judgment), and article shape wins over the query that found the document.
 */
export function deriveRoleFromBody(input: BodyRoleInput): BodyRoleResult {
  const h = host(input.url);
  const title = String(input.title ?? "");
  const body = String(input.body ?? "").slice(0, 40_000);
  const hay = `${title}\n${body}`;
  const signals: string[] = [];
  let role: BodyDerivedRole = "unknown";
  let strength: BodyRoleEvidence["strength"] = "none";

  const judgmentShape = JUDGMENT_BODY_RE.test(hay) || (DOCKET_RE.test(title) && body.length > 0);
  const statuteShape = STATUTE_BODY_RE.test(hay);
  const regulationShape = REGULATION_RE.test(hay);
  const articleShape = ARTICLE_BODY_RE.test(hay);
  const footnoteHits = (body.match(FOOTNOTE_DENSITY_RE) ?? []).length;
  const journal = JOURNAL_RE.test(hay);
  const institutional = INSTITUTIONAL_RE.test(hay);
  const bookish = BOOK_RE.test(hay);

  if (LISTING_RE.test(hay) && body.length < 4_000) {
    signals.push("listing_shape");
    return {
      candidate_id: input.candidate_id,
      title,
      body_derived_role: "listing_or_catalog",
      evidence: { signals, strength: "strong" },
    };
  }

  // A scholarly document quotes judgments and statutes at length, so document
  // *identity* (journal / research institute, no docket or statute title of its
  // own) takes precedence over quoted primary-law shape.
  const docketTitle = DOCKET_RE.test(title);
  const statuteTitle = /^\s*(חוק|חוק[-\s]?יסוד|פקודת|תקנות)\b/.test(title.trim());
  const scholarlyIdentity = (journal || institutional) && !docketTitle && !statuteTitle;

  if (scholarlyIdentity) {
    if (journal) signals.push("journal_identity");
    if (institutional) signals.push("institutional_research_identity");
    if (articleShape) signals.push("article_body_shape");
    if (footnoteHits >= 3) signals.push(`academic_footnote_density:${footnoteHits}`);
    if (ACADEMIC_HOST_RE.test(h)) signals.push("academic_host");
    role = bookish ? "book_or_chapter" : journal ? "journal_article" : "institutional_research";
    strength = body.length >= 2_000 ? "strong" : "weak";
  } else if (judgmentShape) {
    signals.push("judgment_body_shape");
    if (COURT_HOST_RE.test(h)) signals.push("court_host");
    role = "binding_case_law";
    strength = body.length >= 2_000 ? "strong" : "weak";
  } else if (statuteTitle || (statuteShape && !articleShape)) {
    if (statuteTitle) signals.push("statute_title");
    if (statuteShape) signals.push("statute_body_shape");
    if (LEGISLATION_HOST_RE.test(String(input.url ?? ""))) signals.push("legislation_host");
    role = /^\s*תקנות\b/.test(title.trim()) ? "regulation_or_guideline" : "primary_statute";
    strength = "strong";
  } else if (regulationShape && !articleShape) {
    signals.push("regulation_body_shape");
    role = "regulation_or_guideline";
    strength = "weak";
  } else if (journal || (articleShape && footnoteHits >= 3)) {
    if (journal) signals.push("journal_identity");
    if (articleShape) signals.push("article_body_shape");
    if (footnoteHits >= 3) signals.push(`academic_footnote_density:${footnoteHits}`);
    if (ACADEMIC_HOST_RE.test(h)) signals.push("academic_host");
    role = bookish ? "book_or_chapter" : "journal_article";
    strength = body.length >= 2_000 && (journal || footnoteHits >= 3) ? "strong" : "weak";
  } else if (institutional) {
    signals.push("institutional_research_identity");
    role = "institutional_research";
    strength = body.length >= 2_000 ? "strong" : "weak";
  } else if (bookish) {
    signals.push("book_shape");
    role = "book_or_chapter";
    strength = "weak";
  } else if (NEWS_RE.test(hay)) {
    signals.push("news_or_commentary_shape");
    role = "legal_news_or_commentary";
    strength = "weak";
  } else if (ACADEMIC_HOST_RE.test(h) && articleShape) {
    signals.push("academic_host_with_article_shape");
    role = "journal_article";
    strength = "weak";
  }

  // Topicality refines scholarship into direct vs adjacent, never into a
  // primary-authority role.
  if (isScholarshipRole(role) && input.body_topicality) {
    if (input.body_topicality === "direct") {
      signals.push("body_topicality_direct");
      role = "direct_scholarship";
    } else if (input.body_topicality === "adjacent") {
      role = "adjacent_scholarship";
    }
  }

  return {
    candidate_id: input.candidate_id,
    title,
    body_derived_role: role,
    evidence: { signals, strength },
  };
}

// ── relabelling decision ───────────────────────────────────────────────────

/** Retrieval-slot roles used by the planner. */
const PRIMARY_SLOTS = new Set([
  "binding_case_law",
  "persuasive_case_law",
  "primary_statute",
  "regulation",
]);

export interface RoleRelabelRow {
  run_id: string | null;
  source_id: string;
  title: string;
  original_role: string;
  retrieval_slot: string;
  body_derived_role: BodyDerivedRole;
  role_changed: boolean;
  reason: string;
  can_satisfy_role_before: boolean;
  can_satisfy_role_after: boolean;
}

export interface RelabelInput extends BodyRoleInput {
  /** canSatisfyRole(integrity, slot_role) as computed before this pass. */
  can_satisfy_role_before: boolean;
}

export interface RelabelOutcome {
  row: RoleRelabelRow;
  /** New planner-facing role, or null to keep the existing slot role. */
  new_role: string | null;
  /** Usability under the body-derived role. */
  can_satisfy_role_after: boolean;
}

/**
 * Decide whether the stale retrieval-slot role must be replaced. Only strong,
 * body-backed evidence overrides a slot, and a source is never promoted into a
 * primary-authority slot it did not earn from its own document shape.
 */
export function relabelRoleAfterBody(
  input: RelabelInput,
  run_id?: string | null,
): RelabelOutcome {
  const slot = String(input.role ?? "unknown");
  const derived = deriveRoleFromBody(input);
  const r = derived.body_derived_role;
  let new_role: string | null = null;
  let reason = "slot_role_consistent_with_body";

  const scholarship = isScholarshipRole(r);
  const bodyPresent = (input.body_chars ?? String(input.body ?? "").length) >= 800;

  if (!bodyPresent || derived.evidence.strength !== "strong") {
    reason = bodyPresent
      ? "body_evidence_too_weak_to_override_slot"
      : "no_body_acquired_slot_role_kept";
  } else if (scholarship && PRIMARY_SLOTS.has(slot)) {
    new_role = "scholarship";
    reason = `journal_or_research_document_found_via_${slot}_slot`;
  } else if (r === "binding_case_law" && slot === "scholarship") {
    new_role = "binding_case_law";
    reason = "judgment_document_found_via_scholarship_slot";
  } else if (r === "primary_statute" && slot === "scholarship") {
    new_role = "primary_statute";
    reason = "statute_document_found_via_scholarship_slot";
  } else if (r === "binding_case_law" && slot === "primary_statute") {
    new_role = "binding_case_law";
    reason = "judgment_document_found_via_statute_slot";
  } else if (r === "primary_statute" && PRIMARY_SLOTS.has(slot) && slot !== "primary_statute") {
    new_role = "primary_statute";
    reason = "statute_document_found_via_case_law_slot";
  }

  // Usability under the corrected role: scholarship needs a citable body,
  // primary authority still goes through the existing integrity gates.
  const can_satisfy_role_after = new_role === "scholarship"
    ? bodyPresent && r !== "listing_or_catalog"
    : input.can_satisfy_role_before;

  return {
    row: {
      run_id: run_id ?? null,
      source_id: input.candidate_id,
      title: String(input.title ?? ""),
      original_role: slot,
      retrieval_slot: slot,
      body_derived_role: r,
      role_changed: new_role !== null && new_role !== slot,
      reason,
      can_satisfy_role_before: input.can_satisfy_role_before,
      can_satisfy_role_after,
    },
    new_role,
    can_satisfy_role_after,
  };
}
