/**
 * web_source_usability_and_authority_selection_v1 — fix 1.
 *
 * A GENERAL (never doctrine-specific) classifier for web results that the
 * legacy Israeli-domain table cannot place. Its only job is to decide whether
 * an otherwise `unknown` web page is a credible legal source and, if so, what
 * kind: foreign/official case law, official legislation / government legal
 * material, or academic legal scholarship.
 *
 * Guarantees:
 *   - Wikipedia, blogs, SEO/marketing pages, mirrors, listings and generic
 *     summaries are never promoted.
 *   - Foreign material is marked `jurisdiction: "foreign"` and may only ever
 *     satisfy a comparative / persuasive role — never binding Israeli law and
 *     never an Israeli statutory anchor.
 *   - Low confidence stays `unknown` → non-citable unless another gate
 *     validates it.
 *
 * Pure. No network, no model calls, no doctrine lists.
 */

export const WEB_SOURCE_CLASSIFIER_VERSION = "web_source_usability_and_authority_selection_v1";

export type WebSemanticClass =
  | "official_judgment"
  | "foreign_case_law"
  | "comparative_authority"
  | "official_statute"
  | "foreign_statute"
  | "government_legal_material"
  | "policy_or_institutional_context"
  | "legal_scholarship"
  | "comparative_scholarship"
  | "unknown";

export type WebJurisdiction = "israeli" | "foreign" | "international" | "unknown";

/** Pipeline source class (mirrors perplexityRetrieval's SourceClass values). */
export type PipelineSourceClass =
  | "official_primary"
  | "court_case"
  | "legislation"
  | "government_report"
  | "academic"
  | "publisher"
  | "discovery_only"
  | "commercial_secondary"
  | "news"
  | "unknown"
  | "bad";

export interface WebSourceClassification {
  url: string;
  title: string;
  host: string;
  semantic_class: WebSemanticClass;
  jurisdiction: WebJurisdiction;
  /** Role this source may serve (never binding for foreign material). */
  source_role:
    | "persuasive_case_law"
    | "binding_case_law"
    | "primary_statute"
    | "government_report"
    | "scholarship"
    | null;
  pipeline_class: PipelineSourceClass;
  citable_as: "judgment" | "statute" | "commentary" | "scholarship" | "none";
  confidence: number;
  positive_signals: string[];
  negative_signals: string[];
  reason: string;
}

export interface WebSourceClassificationRow extends WebSourceClassification {
  source_id: string | null;
  previous_class: string;
  new_class: string;
}

// ── host helpers ────────────────────────────────────────────────────────────

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function path(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

const ISRAELI_HOST_RE = /(^|\.)(gov\.il|org\.il|ac\.il|co\.il|muni\.il|net\.il|idf\.il)$/;

/** Generic official-court host shapes across jurisdictions. */
const COURT_HOST_RE = new RegExp(
  [
    "(^|\\.)courts?\\.",
    "(^|\\.)court-",
    "(^|\\.)judiciary\\.",
    "(^|\\.)judgments?\\.",
    "(^|\\.)decisions\\.",
    "(^|\\.)supremecourt\\.",
    "(^|\\.)scc-csc\\.",
    "(^|\\.)bundesverfassungsgericht\\.",
    "(^|\\.)bverfg\\.",
    "(^|\\.)conseil-constitutionnel\\.",
    "(^|\\.)hudoc\\.",
    "(^|\\.)echr\\.coe\\.int$",
    "(^|\\.)curia\\.europa\\.eu$",
    "(^|\\.)icj-cij\\.org$",
    "(^|\\.)tribunal",
    "(^|\\.)canlii\\.org$",
    "(^|\\.)bailii\\.org$",
    "(^|\\.)austlii\\.edu\\.au$",
    "(^|\\.)worldlii\\.org$",
    "(^|\\.)legalinformationinstitute",
    "(^|\\.)law\\.cornell\\.edu$",
    "(^|\\.)supreme\\.justia\\.com$",
  ].join("|"),
);

const OFFICIAL_GOV_HOST_RE = /(^|\.)(gov|gouv|govt|gc\.ca|europa\.eu|coe\.int|un\.org)(\.[a-z]{2,3})?$|(^|\.)gov\.[a-z]{2}$|(^|\.)legislation\.gov\.uk$|(^|\.)laws-lois\.justice\.gc\.ca$|(^|\.)gesetze-im-internet\.de$|(^|\.)legifrance\.gouv\.fr$/;

const ACADEMIC_HOST_RE =
  /(^|\.)(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$|(^|\.)(ssrn|papers\.ssrn|jstor|cambridge\.org|oup\.com|academic\.oup\.com|link\.springer\.com|springer\.com|tandfonline\.com|sciencedirect\.com|heinonline\.org|doi\.org|repository\.|scholarship\.|lawreview)/;

const BAD_HOST_RE =
  /wikipedia\.org$|wikiwand|fandom\.com|medium\.com|blogspot|wordpress\.com|substack\.com|quora\.com|reddit\.com|facebook\.com|linkedin\.com|youtube\.com|pinterest|slideshare/;

const MARKETING_RE =
  /(עורך[- ]דין|משרד\s+עורכי|צור\s+קשר|ייעוץ\s+משפטי\s+חינם|law\s*firm|attorneys?\s+at\s+law|free\s+consultation|our\s+services|contact\s+us|hire\s+a\s+lawyer)/i;

const LISTING_RE =
  /(search\s+results|תוצאות\s+חיפוש|index\s+of|browse|category|tag\/|\/search|\/tags?\/|\/category\/|archive\b|רשימת\s+פסקי)/i;

const JUDGMENT_TEXT_RE =
  /(judgment|judgement|reasons\s+for\s+judgment|opinion\s+of\s+the\s+court|decision\s+of\s+the\s+court|per\s+curiam|appellant|respondent|\bv\.\s|\bvs\.\s|\bR\.\s+v\.|case\s+no|neutral\s+citation|\[\d{4}\]\s+[A-Z]{2,6}|\d+\s+S\.C\.R\.|\bECLI:|application\s+no)/i;

const STATUTE_TEXT_RE =
  /(act\b|statute|code\b|constitution|charter|regulation|ordinance|gesetz|loi\b|legislation|section\s+\d|article\s+\d|חוק|תקנות|פקודת)/i;

const SCHOLARSHIP_TEXT_RE =
  /(law\s+review|law\s+journal|journal\s+of\s+law|working\s+paper|abstract|doi:|volume\s+\d+|issue\s+\d+|university|faculty\s+of\s+law|כתב[- ]עת|רבעון|מאמר|עיוני\s+משפט|משפטים)/i;

export interface WebClassifyInput {
  url: string;
  title?: string;
  snippet?: string;
  /** Class assigned by the legacy domain table (usually "unknown"). */
  previous_class?: string;
  source_id?: string | null;
}

/**
 * Classify a web result. Returns `unknown` (non-citable) whenever signals are
 * insufficient. Never returns a binding role for foreign material.
 */
export function classifyWebLegalSource(input: WebClassifyInput): WebSourceClassification {
  const url = String(input.url ?? "");
  const title = String(input.title ?? "");
  const snippet = String(input.snippet ?? "");
  const h = host(url);
  const p = path(url);
  const hay = `${title}\n${snippet}`;
  const pos: string[] = [];
  const neg: string[] = [];

  const base = (over: Partial<WebSourceClassification>): WebSourceClassification => ({
    url,
    title,
    host: h,
    semantic_class: "unknown",
    jurisdiction: "unknown",
    source_role: null,
    pipeline_class: "unknown",
    citable_as: "none",
    confidence: 0,
    positive_signals: pos,
    negative_signals: neg,
    reason: "insufficient_signals",
    ...over,
  });

  if (!h) return base({ reason: "no_host" });

  // ── hard negatives ────────────────────────────────────────────────────────
  if (BAD_HOST_RE.test(h)) {
    neg.push("non_authoritative_host");
    return base({ pipeline_class: "bad", reason: "rejected_non_authoritative_host" });
  }
  if (MARKETING_RE.test(hay) && !COURT_HOST_RE.test(h) && !ACADEMIC_HOST_RE.test(h)) {
    neg.push("marketing_or_law_firm_page");
    return base({ reason: "rejected_marketing_page" });
  }
  if (LISTING_RE.test(`${title} ${p}`) && !/\.pdf($|\?)/i.test(p)) {
    neg.push("listing_or_search_page");
    return base({ reason: "rejected_listing_page" });
  }

  const israeli = ISRAELI_HOST_RE.test(h);
  const jurisdiction: WebJurisdiction = israeli
    ? "israeli"
    : /echr\.coe\.int|hudoc|curia\.europa\.eu|icj-cij|un\.org|coe\.int/.test(h)
    ? "international"
    : "foreign";

  const isPdf = /\.pdf($|\?)/i.test(p);
  if (isPdf) pos.push("pdf_document");

  // ── A. official court / tribunal ──────────────────────────────────────────
  if (COURT_HOST_RE.test(h)) {
    pos.push("official_court_host");
    const textual = JUDGMENT_TEXT_RE.test(hay);
    if (textual) pos.push("judgment_text_signals");
    const confidence = 0.6 + (textual ? 0.25 : 0) + (isPdf ? 0.05 : 0);
    if (confidence < 0.65) {
      neg.push("court_host_without_judgment_signals");
      return base({
        jurisdiction,
        confidence,
        reason: "court_host_but_no_document_signals",
      });
    }
    if (israeli) {
      return base({
        semantic_class: "official_judgment",
        jurisdiction: "israeli",
        source_role: "binding_case_law",
        pipeline_class: "official_primary",
        citable_as: "judgment",
        confidence,
        reason: "israeli_official_court_document",
      });
    }
    return base({
      semantic_class: jurisdiction === "international" ? "comparative_authority" : "foreign_case_law",
      jurisdiction,
      // Foreign / international judgments are persuasive-comparative only.
      source_role: "persuasive_case_law",
      pipeline_class: "court_case",
      citable_as: "judgment",
      confidence,
      reason: "foreign_official_court_document_comparative_only",
    });
  }

  // ── B. official legislation / government legal material ───────────────────
  if (OFFICIAL_GOV_HOST_RE.test(h) || /legislation|laws?-lois|gesetze|legifrance/.test(h)) {
    pos.push("official_government_host");
    const statutory = STATUTE_TEXT_RE.test(hay);
    if (statutory) pos.push("statutory_text_signals");
    const confidence = 0.55 + (statutory ? 0.25 : 0);
    if (!statutory) {
      return base({
        semantic_class: "policy_or_institutional_context",
        jurisdiction,
        source_role: "government_report",
        pipeline_class: "government_report",
        citable_as: "commentary",
        confidence,
        reason: "official_government_material_without_statutory_text",
      });
    }
    if (israeli) {
      return base({
        semantic_class: "official_statute",
        jurisdiction: "israeli",
        source_role: "primary_statute",
        pipeline_class: "legislation",
        citable_as: "statute",
        confidence,
        reason: "israeli_official_legislation",
      });
    }
    // A foreign statute is NEVER an Israeli primary anchor: it enters as
    // comparative/institutional material only.
    return base({
      semantic_class: "foreign_statute",
      jurisdiction,
      source_role: "government_report",
      pipeline_class: "government_report",
      citable_as: "commentary",
      confidence,
      reason: "foreign_statute_comparative_context_only",
    });
  }

  // ── C. academic / scholarly ───────────────────────────────────────────────
  if (ACADEMIC_HOST_RE.test(h) || /\/(law-?review|journal|article|papers?|publications?)\//.test(p)) {
    pos.push("academic_or_repository_host");
    const scholarly = SCHOLARSHIP_TEXT_RE.test(hay);
    if (scholarly) pos.push("scholarship_metadata_signals");
    const confidence = 0.5 + (scholarly ? 0.25 : 0) + (isPdf ? 0.1 : 0);
    if (confidence < 0.6) {
      neg.push("academic_host_without_article_signals");
      return base({ jurisdiction, confidence, reason: "academic_host_but_no_article_signals" });
    }
    return base({
      semantic_class: israeli ? "legal_scholarship" : "comparative_scholarship",
      jurisdiction,
      source_role: "scholarship",
      pipeline_class: "academic",
      citable_as: "scholarship",
      confidence,
      reason: "academic_legal_scholarship",
    });
  }

  // ── D. legal information institutes already covered by COURT_HOST_RE ──────
  neg.push("no_recognized_legal_source_signals");
  return base({ jurisdiction, reason: "insufficient_signals" });
}

/** True when the classification may enter the candidate pool. */
export function isUsableWebClass(c: WebSourceClassification): boolean {
  return c.pipeline_class !== "unknown" && c.pipeline_class !== "bad" &&
    c.pipeline_class !== "discovery_only" && c.confidence >= 0.6;
}

/** Per-run collector for `web_source_classification` telemetry. */
export function makeWebClassificationLedger() {
  const rows: WebSourceClassificationRow[] = [];
  return {
    record(c: WebSourceClassification, previous_class: string, source_id: string | null = null) {
      rows.push({
        ...c,
        source_id,
        previous_class,
        new_class: c.pipeline_class,
      });
    },
    rows: () => rows,
    summary: () => ({
      version: WEB_SOURCE_CLASSIFIER_VERSION,
      evaluated: rows.length,
      promoted: rows.filter((r) => r.new_class !== "unknown" && r.new_class !== "bad").length,
      rejected: rows.filter((r) => r.new_class === "unknown" || r.new_class === "bad").length,
      by_semantic_class: rows.reduce((acc, r) => {
        acc[r.semantic_class] = (acc[r.semantic_class] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      foreign_promoted: rows.filter((r) =>
        r.jurisdiction !== "israeli" && r.new_class !== "unknown" && r.new_class !== "bad"
      ).length,
    }),
  };
}

export type WebClassificationLedger = ReturnType<typeof makeWebClassificationLedger>;
